import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tlx_server.site import normalize_lot
from tlx_server.store import Store


class BrandStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "catalog.db"
        self.store = Store(self.path)
        self.addCleanup(self.store._db.close)
        self.lots = [normalize_lot({"id": i, "title": f"Item {i}", "auction_period": "test"}) for i in range(1, 4)]
        self.store.replace_all(self.lots)

    def test_catalog_distinguishes_uncached_details_from_known_missing_brands(self) -> None:
        before = self.store.seq()
        self.store.save_lot_detail({"id": 1, "brand": "  Acme  ", "model": "  D-1  "})
        self.store.save_lot_detail({"id": 2, "brand": None, "model": "   "})
        catalog = {lot["id"]: lot for lot in self.store.changes(0).lots}
        self.assertEqual(catalog[1]["brand"], "Acme")
        self.assertIsNone(catalog[2]["brand"])
        self.assertNotIn("brand", catalog[3])
        self.assertEqual(catalog[1]["model"], "D-1")
        self.assertIsNone(catalog[2]["model"])
        self.assertNotIn("model", catalog[3])
        self.assertEqual({lot["id"] for lot in self.store.changes(before).lots}, {1, 2})

    def test_details_survive_reopening_the_database_and_catalog_refreshes(self) -> None:
        self.store.save_lot_detail({"id": 1, "brand": "Acme", "model": "D-1"})
        self.store.save_lot_detail({"id": 2, "brand": None})
        reopened = Store(self.path)
        self.addCleanup(reopened._db.close)
        before = reopened.seq()
        reopened.replace_all(self.lots)
        self.assertEqual(reopened.seq(), before, "joined brands must not cause spurious catalog changes")
        self.assertEqual(reopened.changes(before).lots, [])
        catalog = {lot["id"]: lot for lot in reopened.changes(0).lots}
        self.assertEqual(catalog[1]["brand"], "Acme")
        self.assertEqual(catalog[1]["model"], "D-1")
        self.assertIsNone(catalog[2]["brand"])
        changed = [{**lot, "currentPrice": 25} for lot in self.lots]
        reopened.replace_all(changed)
        self.assertEqual(reopened.changes(before).lots[0]["brand"], "Acme")
        self.assertEqual(reopened.changes(before).lots[0]["model"], "D-1")

    def test_only_brand_changes_publish_catalog_deltas(self) -> None:
        self.store.save_lot_detail({"id": 1, "brand": "Acme"})
        before = self.store.seq()
        self.store.save_lot_detail({"id": 1, "brand": "Acme", "description": "Updated"})
        self.assertEqual(self.store.seq(), before)
        self.store.save_lot_detail({"id": 1, "brand": "Other"})
        self.assertEqual([(lot["id"], lot["brand"]) for lot in self.store.changes(before).lots], [(1, "Other")])
        before = self.store.seq()
        self.store.save_lot_detail({"id": 1, "brand": ""})
        self.assertEqual([(lot["id"], lot["brand"]) for lot in self.store.changes(before).lots], [(1, None)])

    def test_existing_cached_details_are_available_when_a_lot_enters_the_catalog(self) -> None:
        before = self.store.seq()
        self.store.save_lot_detail({"id": 4, "brand": "Already cached"})
        self.assertEqual(self.store.seq(), before, "closed or unknown lots must not bump the catalog sequence")
        self.store.replace_all([*self.lots, normalize_lot({"id": 4})])
        catalog = {lot["id"]: lot for lot in self.store.changes(0).lots}
        self.assertEqual(catalog[4]["brand"], "Already cached")

    def test_model_only_changes_and_removals_publish_deltas(self) -> None:
        self.store.save_lot_detail({"id": 1, "brand": None, "model": "D-1"})
        before = self.store.seq()
        self.store.save_lot_detail({"id": 1, "brand": None, "model": " D-1 ", "description": "Updated"})
        self.assertEqual(self.store.seq(), before)
        self.store.save_lot_detail({"id": 1, "brand": None, "model": "D-2"})
        self.assertEqual([(lot["id"], lot["model"]) for lot in self.store.changes(before).lots], [(1, "D-2")])
        before = self.store.seq()
        self.store.save_lot_detail({"id": 1, "brand": None, "model": None})
        self.assertEqual([(lot["id"], lot["model"]) for lot in self.store.changes(before).lots], [(1, None)])


if __name__ == "__main__":
    unittest.main()
