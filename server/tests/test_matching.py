import sqlite3
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from tlx_server.history import History, group_lots, items_match, set_groups
from tlx_server.store import Store

LATER = 4_000_000_000_000  # an endsAt far in the future


def item(lot_id: int, title: str = "Cordless drill", /, **fields: object) -> dict[str, Any]:
    return {"id": lot_id, "title": title, "brand": "Acme", "model": "D-100", "condition": None, "endsAt": LATER, **fields}


class MatchingTests(unittest.TestCase):
    def test_identity_matches_ignore_titles_case_and_whitespace_but_not_model_punctuation_or_order(self) -> None:
        first = item(1)
        self.assertTrue(items_match(first, item(2, "Completely different 99-pack", brand=" ACME ", model=" d-100 "), 100))
        for change in ({"model": "D-101"}, {"brand": "Other"}, {"model": "D100"}, {"model": "100-D"}):
            self.assertFalse(items_match(first, item(2, **change), 50), change)
        for change in ({"brand": None}, {"model": None}, {"brand": "   "}):
            partial = item(2, **change)
            self.assertTrue(items_match(first, partial, 100), change)
            self.assertTrue(items_match(partial, first, 100), change)
        self.assertFalse(items_match(item(1, "Drill Qty 2", brand=None), item(2, "Drill Qty 3", brand=None), 50))

    def test_grouping_keeps_known_models_separate_even_when_an_unknown_title_matches_both(self) -> None:
        items = [item(1), item(2, model=None), item(3, model="D-200"), item(4, "Other wording")]
        for ordering in (items, items[::-1], [items[1], items[2], items[0], items[3]]):
            groups = group_lots(ordering)
            self.assertEqual(groups[1], groups[4])
            self.assertNotEqual(groups[1], groups[3])
            self.assertIn(groups[2], (groups[1], groups[3]))
            self.assertEqual(groups, group_lots(items), "the order lots come in doesn't matter")

    def test_title_fallback_ignores_case_and_order_but_never_differing_numbers(self) -> None:
        titles = ["Cordless drill", "drill CORDLESS", "Cordless drill Qty 2", "Drill 10 oz.", "Drill 29 oz."]
        groups = group_lots(item(i, t, brand=None) for i, t in enumerate(titles))
        self.assertEqual(groups[0], groups[1])
        self.assertEqual(len({groups[0], groups[2], groups[3], groups[4]}), 4)

    def test_title_fallback_uses_a_fixed_90_percent_threshold(self) -> None:
        title = "Cordless drill with battery charger case bits belt clip"
        groups = group_lots([
            item(1, f"{title} manual", brand=None),
            item(2, title, brand=None),
            item(3, "Cordless drill with battery charger", brand=None),
        ])
        self.assertEqual(groups[1], groups[2])
        self.assertNotEqual(groups[1], groups[3])

    def test_groups_stay_within_one_condition_and_only_shared_groups_get_an_id(self) -> None:
        lots = [item(5), item(3), item(4, condition={"value": 1, "label": "New"}), item(9, "Saw", model="S-1")]
        set_groups(lots)
        self.assertEqual([lot.get("groupId") for lot in lots], [3, 3, None, None])

    def test_titles_without_words_group_only_with_the_same_title(self) -> None:
        groups = group_lots([item(1, "!!", brand=None), item(2, "!!", brand=None), item(3, "??", brand=None)])
        self.assertEqual(groups[1], groups[2])
        self.assertNotEqual(groups[1], groups[3])

    def test_duplicate_heavy_catalogs_group_efficiently_without_changing_known_model_boundaries(self) -> None:
        lots = [item(i, model=f"D-{i % 10}") for i in range(20000)]
        start = time.perf_counter()
        groups = group_lots(lots)
        self.assertEqual(len(set(groups.values())), 10)
        self.assertLess(time.perf_counter() - start, 2, "20,000 listings should not need quadratic comparisons")


class StoredMatchingTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "catalog.db"
        self.store = Store(self.path)
        self.addCleanup(self.store._db.close)
        self.history = History(self.store)

    def add_open(self, *items: dict[str, Any]) -> None:
        for i in items:
            self.store.save_lot_detail(i)
        self.store.replace_all(items)

    def group_of(self, lot_id: int) -> int | None:
        lot = self.store.lot(lot_id)
        assert lot is not None
        return lot.get("groupId")

    def test_groups_are_stored_and_late_details_regroup_with_a_catalog_delta(self) -> None:
        self.add_open(item(1), item(2, "Different title"), item(3, "Saw", model="S-1"))
        self.history.refresh()
        self.assertEqual([self.group_of(i) for i in (1, 2, 3)], [1, 1, None])
        before = self.store.seq()
        self.store.save_lot_detail(item(2, "Different title", model="D-200"))
        self.history.refresh()
        self.assertEqual([self.group_of(i) for i in (1, 2)], [None, None])
        self.assertEqual({lot["id"] for lot in self.store.changes(before).lots}, {1, 2})
        before = self.store.seq()
        self.history.refresh()
        self.assertEqual(self.store.seq(), before, "an unchanged catalog publishes nothing")

    def test_a_pull_groups_the_whole_catalog_before_storing_it(self) -> None:
        pulled = [item(1), item(2, "Other wording"), item(3, "Saw", model="S-1")]
        self.history.annotate(pulled)
        self.store.replace_all(pulled)
        self.assertEqual([self.group_of(i) for i in (1, 2, 3)], [1, 1, None])

    def test_closed_lots_list_matching_open_lots_that_have_not_ended(self) -> None:
        self.add_open(item(1), item(2, model=None), item(3, model="D-200"), item(4, endsAt=0), item(5, "Saw", brand=None, model=None))
        closed: list[dict[str, Any]] = [
            {"lot_id": 90, "title": "Something else", "brand": "Acme", "model": "D-100"},
            {"lot_id": 91, "title": "saw"},
            {"lot_id": 1, "title": "Cordless drill", "brand": "Acme", "model": "D-100"},
        ]
        self.history.relisted(closed)
        self.assertEqual([sorted(c["relisted"]) for c in closed], [[1], [5], [2]], "never itself, ended lots or other models")

    def test_databases_from_before_groups_are_upgraded(self) -> None:
        self.add_open(item(1), item(2))
        self.store._db.close()
        db = sqlite3.connect(self.path)
        db.execute("ALTER TABLE lots DROP COLUMN group_id")
        db.commit()
        db.close()
        reopened = Store(self.path)
        self.addCleanup(reopened._db.close)
        History(reopened).refresh()
        self.assertEqual(reopened.lot(2)["groupId"], 1)  # ty: ignore[not-subscriptable]


if __name__ == "__main__":
    unittest.main()
