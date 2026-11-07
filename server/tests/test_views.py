import unittest
from datetime import datetime
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from tlx_server.views import (
    DEFAULT_VIEW,
    ENDING,
    MINE,
    SORTS,
    _sort_key,
    category_tree,
    compute_facets,
    compute_view,
    has_bid,
    is_leading,
    make_row,
    min_max_bid,
    money,
    normalize_view,
    quick_bid,
    same_filters,
    saved_search_stats,
    total_cost,
    view_from_query,
    view_url,
)

NOW = 1_800_000_000_000


def lot(id: int = 1, **values: object) -> dict[str, Any]:
    return {
        "id": id,
        "title": f"Tool {id}",
        "lotNumber": f"A{id}",
        "endsAt": NOW + 100_000,
        "firstSeenAt": NOW - 1000,
        "currentPrice": 10,
        "nextMinIncrement": 11,
        "bidCount": 1,
        "estimatedRetailPrice": 100,
        "status": "live",
        "category": {"value": "tools", "label": "Tools"},
        "condition": {"value": 1, "label": "New"},
        "location": {"name": "Raleigh"},
        "isTransferable": True,
        "transferFee": 5,
        **values,
    }


def result(
    lots: list[dict[str, Any]], view: dict[str, Any] | None = None, settings: dict[str, Any] | None = None, now: int = NOW
) -> dict[str, Any]:
    return compute_view(iter(lots), view or {}, "Raleigh", settings or {}, now)


def ids(view_result: dict[str, Any]) -> list[int]:
    return [row["lot"]["id"] for row in view_result["rows"]]


def ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso).timestamp() * 1000)


class ViewStateTests(unittest.TestCase):
    def test_defaults_are_independent_and_invalid_values_are_normalized(self) -> None:
        self.assertEqual(normalize_view(None), DEFAULT_VIEW)
        first = normalize_view(None)
        first["categories"].append("different")
        self.assertEqual(normalize_view(None)["categories"], [])
        self.assertEqual(
            normalize_view({
                "sort": [],
                "ending": "never",
                "mine": None,
                "search": 7,
                "reachable": "false",
                "searchRegex": 1,
                "categories": "tools",
                "conditions": [True, "2", 1.2, 1, 1, 2.0],
                "locations": ["Raleigh", None, "Raleigh"],
                "priceMin": "12",
                "priceMax": float("inf"),
                "totalMax": float("nan"),
                "newSince": "2026-01-01T00:00:00Z",
                "unknown": 1,
            }),
            {**DEFAULT_VIEW, "conditions": [1, 2], "locations": ["Raleigh"]},
        )

    def test_query_defaults_only_without_an_explicit_view(self) -> None:
        defaults = {"categories": ["tools"], "conditions": [1]}
        self.assertEqual(view_from_query({}, defaults), {**DEFAULT_VIEW, **defaults})
        self.assertEqual(view_from_query({"page": ["2"]}, defaults)["categories"], ["tools"])
        self.assertEqual(view_from_query({"sort": ["ending-soonest"]}, defaults), DEFAULT_VIEW)
        self.assertEqual(view_from_query({"category": [""]}, defaults), DEFAULT_VIEW)

    def test_query_all_fields_and_canonical_round_trip(self) -> None:
        query = {
            "search": ["old", "drill & saw"],
            "regex": ["true"],
            "sort": ["total-desc"],
            "category": ["custom:Tools - Saws", "tools", "tools"],
            "condition": ["2", "1", "invalid"],
            "location": ["Durham", "Raleigh"],
            "reachable": ["on"],
            "priceMin": ["0"],
            "priceMax": ["50.5"],
            "totalMax": ["65"],
            "retailMin": ["100"],
            "ending": ["today"],
            "mine": ["bid"],
            "newSince": [str(NOW)],
        }
        view = view_from_query(query)
        self.assertEqual(view["search"], "drill & saw")
        self.assertTrue(view["searchRegex"])
        self.assertEqual(view["priceMin"], 0)
        self.assertEqual(view["newSince"], NOW)
        url = view_url(view)
        self.assertTrue(url.startswith("/tlx?"))
        parsed = parse_qs(urlsplit(url).query)
        self.assertEqual(parsed["condition"], ["1", "2"])
        self.assertEqual(view_url(view_from_query(parsed)), url)
        self.assertEqual(view_url({"priceMax": 10.0}), view_url({"priceMax": 10}))
        self.assertEqual(view_from_query(parse_qs(urlsplit(view_url(DEFAULT_VIEW)).query), {"categories": ["tools"]}), DEFAULT_VIEW)
        extra = parse_qs(urlsplit(view_url(view, page=2, search="replaced", mine=None)).query)
        self.assertEqual(extra["page"], ["2"])
        self.assertEqual(extra["search"], ["replaced"])
        self.assertNotIn("mine", extra)
        self.assertEqual(view_from_query({"regex": ["false"], "priceMin": ["NaN"], "newSince": ["bad"]}), DEFAULT_VIEW)

    def test_same_filters_ignores_only_sort_and_new_since(self) -> None:
        self.assertTrue(same_filters({}, {"sort": "total-desc", "newSince": NOW}))
        self.assertFalse(same_filters({}, {"searchRegex": True}))
        self.assertFalse(same_filters({"categories": ["a", "b"]}, {"categories": ["b", "a"]}))
        self.assertFalse(same_filters({"priceMin": 0}, {}))
        self.assertEqual(len(SORTS), 10)
        self.assertEqual(len(ENDING), 5)
        self.assertEqual(len(MINE), 5)


class RowTests(unittest.TestCase):
    def test_cost_money_and_transfer_rules(self) -> None:
        self.assertAlmostEqual(total_cost(10, 5), 18.76875)
        self.assertEqual(money(1234.5), "$1,234.50")
        self.assertEqual(money(1.005), "$1.01")
        self.assertEqual(money(-1.005), "-$1.01")
        local = make_row(lot(), "Raleigh", {})
        self.assertEqual(local["transferFee"], 0)
        self.assertFalse(local["pickupOnly"])
        remote = make_row(lot(location={"name": "Durham"}), "Raleigh", {})
        self.assertEqual(remote["transferFee"], 5)
        self.assertAlmostEqual(remote["total"], 18.76875)
        unavailable = make_row(lot(location={"name": "Durham"}, isTransferable=False), "Raleigh", {})
        self.assertEqual(unavailable["transferFee"], 0)
        self.assertTrue(unavailable["pickupOnly"])
        self.assertFalse(make_row(lot(location=None), "Raleigh", {})["pickupOnly"])
        self.assertEqual(local["retailPct"], 0.1)
        self.assertEqual(make_row(lot(currentPrice=1, estimatedRetailPrice=8), "", {})["retailPct"], 0.13)
        self.assertIsNone(make_row(lot(estimatedRetailPrice=0), "", {})["retailPct"])

    def test_bidding_helpers(self) -> None:
        plain = lot()
        self.assertFalse(has_bid(plain))
        self.assertTrue(has_bid(lot(hasBid=True)))
        self.assertTrue(has_bid(lot(yourStanding={})))
        self.assertFalse(is_leading(plain))
        leading = lot(yourStanding={"isLeading": True, "yourMaxBid": 20})
        self.assertTrue(is_leading(leading))
        self.assertEqual(quick_bid(leading), 11)
        self.assertEqual(min_max_bid(leading), 21)
        self.assertEqual(min_max_bid(lot(yourStanding={"isLeading": False, "yourMaxBid": 20})), 11)
        over_max = lot(currentPrice=21, yourStanding={"isLeading": True, "yourMaxBid": 20})
        self.assertFalse(is_leading(over_max))
        self.assertEqual(min_max_bid(over_max), 21)
        self.assertTrue(is_leading(lot(yourStanding={"isLeading": True})))

    def test_custom_categories_are_alphabetical_not_configuration_order(self) -> None:
        settings = {
            "tlxCustomCategories": [
                {"name": "Z last", "types": ["Saw"]},
                {"name": "Tools 10", "types": ["Saw"]},
                {"name": "Tools 2", "types": ["Saw"]},
            ]
        }
        row = make_row(lot(itemType="Saw"), "Raleigh", settings)
        self.assertEqual(row["category"], {"value": "custom:Tools 2", "label": "Tools 2"})
        self.assertEqual(make_row(lot(itemType="saw"), "Raleigh", settings)["category"]["value"], "tools")
        settings["tlxCustomCategories"] = [{"name": "é", "types": ["Saw"]}, {"name": "e", "types": ["Saw"]}]
        self.assertEqual(make_row(lot(itemType="Saw"), "", settings)["category"]["label"], "e")

    def test_exclusion_word_edges_matching_and_errors(self) -> None:
        settings = {"filterWords": ["gold", r"\(Gold\)", "", "[", "gold"], "hiddenLots": {"1": {}}}
        row = make_row(lot(title="Ring (Gold)"), "Raleigh", settings)
        self.assertEqual(row["matched"], "gold")
        self.assertTrue(row["hidden"])
        self.assertEqual(len(row["errors"]), 1)
        self.assertIsNone(make_row(lot(title="golden ring"), "Raleigh", settings)["matched"])
        self.assertIsNone(make_row(lot(title="gold"), "", {**settings, "filterEnabled": False})["matched"])
        computed = result([lot(title="Ring (Gold)")], settings=settings)
        self.assertEqual(computed["matchCounts"], {"gold": 1, r"\(Gold\)": 1, "": 0, "[": 0})
        self.assertEqual(len(computed["errors"]), 1)


class FilterTests(unittest.TestCase):
    def test_each_filter(self) -> None:
        lots = [
            lot(1, title="Blue Drill", firstSeenAt=NOW, currentPrice=10, estimatedRetailPrice=100, hasBid=True),
            lot(
                2,
                title="Red Saw",
                firstSeenAt=NOW + 1,
                currentPrice=20,
                estimatedRetailPrice=200,
                category={"value": "home", "label": "Home"},
                condition={"value": 2, "label": "Used"},
                location={"name": "Durham"},
                isTransferable=False,
                yourStanding={"isLeading": True, "yourMaxBid": 1},
            ),
            lot(
                3,
                title="Blue Saw",
                firstSeenAt=None,
                currentPrice=30,
                estimatedRetailPrice=None,
                isWatchlisted=True,
                location={"name": "Durham"},
            ),
        ]
        tests = [
            ({"search": "BLUE  A1"}, [1]),
            ({"search": "saw"}, [2, 3]),
            ({"search": "^red|A3$", "searchRegex": True}, [2, 3]),
            ({"search": "  ", "searchRegex": True}, [1, 2, 3]),
            ({"categories": ["home"]}, [2]),
            ({"conditions": [2]}, [2]),
            ({"locations": ["Durham"]}, [2, 3]),
            ({"reachable": True}, [1, 3]),
            ({"priceMin": 20}, [2, 3]),
            ({"priceMax": 20}, [1, 2]),
            ({"priceMin": 20, "priceMax": 20}, [2]),
            ({"totalMax": total_cost(20)}, [1, 2]),
            ({"retailMin": 150}, [2]),
            ({"newSince": NOW}, [2]),
            ({"mine": "bid"}, [1, 2]),
            ({"mine": "leading"}, [2]),
            ({"mine": "outbid"}, [1]),
            ({"mine": "watch"}, [3]),
            ({"search": "saw", "priceMax": 25, "conditions": [2], "mine": "bid"}, [2]),
        ]
        for filters, expected in tests:
            with self.subTest(filters=filters):
                actual = result(lots, filters)
                self.assertEqual(ids(actual), expected)
                self.assertEqual(actual["filteredOut"], 3 - len(expected))

    def test_unknown_facets_missing_values_and_numeric_zero(self) -> None:
        item = lot(category=None, condition=None, location=None, estimatedRetailPrice=None)
        self.assertEqual(ids(result([item])), [1])
        self.assertEqual(ids(result([item], {"categories": ["missing"]})), [])
        self.assertEqual(ids(result([item], {"conditions": [-1]})), [1])
        self.assertEqual(ids(result([item], {"retailMin": 0})), [1])
        self.assertEqual(ids(result([item], {"retailMin": 1})), [])
        self.assertEqual(ids(result([lot(currentPrice=0)], {"priceMax": 0})), [1])

    def test_removal_counts_and_mine_bypass(self) -> None:
        lots = [lot(1, hasBid=True), lot(2, title="Gold", hasBid=True), lot(3), lot(4, endsAt=NOW)]
        settings = {"hiddenLots": {"1": {}}, "filterWords": ["gold"], "removeFiltered": True}
        got = result(lots, {"priceMax": 0}, settings)
        self.assertEqual((got["open"], got["removed"], got["filteredOut"]), (3, 2, 1))
        self.assertEqual(got["matchCounts"], {"gold": 1})
        mine = result(lots, {"mine": "bid"}, settings)
        self.assertEqual(ids(mine), [1, 2])
        self.assertEqual((mine["removed"], mine["filteredOut"]), (0, 1))
        shown = result(lots, settings={**settings, "showHidden": True, "removeFiltered": False})
        self.assertEqual(ids(shown), [1, 2, 3])
        off = result(lots, settings={**settings, "filterEnabled": False})
        self.assertEqual(ids(off), [2, 3])
        self.assertEqual(off["matchCounts"], {"gold": 1})

    def test_invalid_and_timed_out_searches_are_explicit(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid search regex"):
            result([], {"searchRegex": True, "search": "["})
        with self.assertRaisesRegex(ValueError, "timed out"):
            result([lot(title="a" * 10000 + "!")], {"searchRegex": True, "search": "(a+)+$"})
        with patch("tlx_server.views.REGEX_TIMEOUT", 0):
            with self.assertRaisesRegex(ValueError, "timed out"):
                result([lot(title="a" * 10000 + "!")], {"searchRegex": True, "search": "(a+)+$"})
            with self.assertRaisesRegex(ValueError, "timed out"):
                result([lot(title="a" * 10000 + "!")], settings={"filterWords": ["(a+)+$"]})

    def test_hours_and_open_boundaries(self) -> None:
        lots = [lot(i, endsAt=NOW + delta) for i, delta in enumerate((-1, 0, 1, 3_600_000 - 1, 3_600_000, 10_800_000 - 1, 10_800_000))]
        self.assertEqual(ids(result(lots, {"ending": "1h"})), [2, 3])
        self.assertEqual(ids(result(lots, {"ending": "3h"})), [2, 3, 4, 5])
        self.assertEqual(result(lots)["open"], 5)

    def test_calendar_boundaries_dst_and_timezone(self) -> None:
        for start, end, hours in [
            ("2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00", 23),
            ("2026-11-01T00:00:00-04:00", "2026-11-02T00:00:00-05:00", 25),
        ]:
            with self.subTest(start=start):
                now, midnight = ms(start), ms(end)
                self.assertEqual(midnight - now, hours * 3_600_000)
                lots = [lot(1, endsAt=now + 1), lot(2, endsAt=midnight - 1), lot(3, endsAt=midnight), lot(4, endsAt=midnight + 86_400_000)]
                self.assertEqual(ids(result(lots, {"ending": "today"}, now=now)), [1, 2])
                self.assertEqual(ids(result(lots, {"ending": "tomorrow"}, now=now)), [3])
                previous = now - 1000
                self.assertEqual(ids(result(lots, {"ending": "tomorrow"}, now=previous)), [1, 2])
        now = ms("2026-06-01T23:00:00-04:00")
        lots = [lot(1, endsAt=ms("2026-06-02T00:00:00-04:00"))]
        self.assertEqual(ids(result(lots, {"ending": "today"}, now=now)), [])
        self.assertEqual(ids(compute_view(lots, {"ending": "today"}, "", {}, now, "UTC")), [1])


class DuplicateTests(unittest.TestCase):
    def test_numeric_partitions_preserve_transitivity_in_any_input_order(self) -> None:
        lots = [
            lot(1, title="red blue green 10 Qty 4"),
            lot(2, title="red blue green yellow 10 qty. 4"),
            lot(3, title="blue green yellow 10 Qty 4"),
            lot(4, title="red blue green 29 Qty 4"),
            lot(5, title="red blue green yellow 29 Qty 4"),
            lot(6, title="blue green yellow 29 Qty 4"),
            lot(7, title="red blue green"),
            lot(8, title="red blue green yellow"),
            lot(9, title="blue green yellow"),
        ]
        for ordered in (lots, list(reversed(lots)), lots[4:] + lots[:4]):
            with self.subTest(order=[item["id"] for item in ordered]):
                got = result(ordered, settings={"tlxNameMatch": 70})
                self.assertEqual(ids(got), [1, 4, 7])
                self.assertEqual(got["combined"], 6)
                for start in (1, 4, 7):
                    self.assertEqual([row["lot"]["id"] for row in got["groups"][start]], list(range(start, start + 3)))

    def test_numeric_signature_keeps_quantity_fraction_decimal_and_missing_numbers_distinct(self) -> None:
        suffixes = ["Qty 4", "4", "Qty 6", "1/2", "1.2", "12", ""]
        lots = [lot(i, title="long red blue green steel tool " + suffix) for i, suffix in enumerate(suffixes, 1)]
        got = result(lots, settings={"tlxNameMatch": 50})
        self.assertEqual(ids(got), list(range(1, 8)))
        self.assertEqual(got["combined"], 0)
        self.assertEqual(got["groups"], {})

    def test_numeric_unique_catalog_skips_pairwise_name_index(self) -> None:
        lots = [lot(i, title=f"Professional heavy duty cordless electric power tool kit model {i}") for i in range(5000)]
        for pct in (90, 50):
            with self.subTest(pct=pct), patch("tlx_server.views.NameIndex") as index:
                got = result(lots, settings={"tlxNameMatch": pct})
                index.assert_not_called()
                self.assertEqual(len(got["rows"]), 5000)
                self.assertEqual(got["combined"], 0)
                self.assertEqual(got["groups"], {})

    def test_exact_token_groups_and_standing_keep_their_own_card(self) -> None:
        lots = [
            lot(1, title="Blue steel tool, Qty. 4"),
            lot(2, title="qty4 TOOL STEEL blue"),
            lot(3, title="Blue steel tool Qty 4", yourStanding={}),
            lot(4, title="Blue steel tool Qty 4", condition=None),
            lot(5, title="Blue steel tool Qty 4", condition=None),
        ]
        got = result(lots, settings={"tlxNameMatch": 100})
        self.assertEqual(ids(got), [1, 3, 4])
        self.assertEqual(got["combined"], 2)
        self.assertNotIn(3, got["groups"])
        self.assertEqual([row["lot"]["id"] for row in got["groups"][1]], [1, 2])
        self.assertEqual([row["lot"]["id"] for row in got["groups"][4]], [4, 5])

    def test_transitive_names_include_filtered_out_bridge(self) -> None:
        lots = [
            lot(1, title="red blue green", currentPrice=10),
            lot(2, title="red blue green yellow", currentPrice=50),
            lot(3, title="blue green yellow", currentPrice=20),
        ]
        got = result(lots, {"priceMax": 20}, {"tlxNameMatch": 70})
        self.assertEqual(ids(got), [1])
        self.assertEqual(got["combined"], 1)
        self.assertEqual(got["filteredOut"], 1)
        self.assertEqual([r["lot"]["id"] for r in got["groups"][3]], [1, 3])
        self.assertEqual(got["rows"][0]["others"][0]["lot"]["id"], 3)
        self.assertEqual(ids(result(lots, {"priceMax": 20}, {"tlxNameMatch": 100})), [1, 3])
        lots[1]["endsAt"] = NOW
        self.assertEqual(ids(result(lots, {"priceMax": 20}, {"tlxNameMatch": 70})), [1, 3])

    def test_numbers_quantity_condition_and_special_cards(self) -> None:
        titles = [
            "Long red blue steel bottle 10 oz Qty 4",
            "Long red blue steel bottle 29 oz Qty 4",
            "Long red blue steel bottle 10 oz Qty 6",
        ]
        lots = [lot(i, title=title) for i, title in enumerate(titles, 1)]
        self.assertEqual(len(result(lots, settings={"tlxNameMatch": 50})["rows"]), 3)
        lots = [lot(i, title="Same exact item") for i in range(1, 7)]
        lots[1]["condition"] = {"value": 2, "label": "Used"}
        lots[2]["hasBid"] = True
        lots[4]["title"] = "Exact same item"
        lots[5]["title"] = "same exact item"
        settings = {"hiddenLots": {"4": {}}, "showHidden": True, "filterWords": ["^Exact"], "tlxNameMatch": 100}
        got = result(lots, settings=settings)
        self.assertEqual(ids(got), [1, 2, 3, 4, 5])
        self.assertEqual(got["combined"], 1)
        self.assertEqual(set(got["groups"]), {1, 6})
        self.assertTrue(all(not row["others"] for row in got["rows"][1:]))

    def test_reachable_then_total_then_ending_then_id(self) -> None:
        lots = [
            lot(1, title="Same item", currentPrice=1, isTransferable=False, location={"name": "Durham"}),
            lot(2, title="Same item", currentPrice=1, location={"name": "Durham"}, transferFee=20),
            lot(3, title="Same item", currentPrice=10, endsAt=NOW + 2),
            lot(4, title="Same item", currentPrice=10, endsAt=NOW + 1),
            lot(5, title="Same item", currentPrice=10, endsAt=NOW + 1),
        ]
        got = result(lots)
        self.assertEqual(ids(got), [4])
        self.assertEqual([r["lot"]["id"] for r in got["groups"][1]], [4, 5, 3, 2, 1])

    def test_empty_tokens_and_setting_clamp(self) -> None:
        lots = [lot(1, title="!!!"), lot(2, title=" !!! "), lot(3, title="???")]
        self.assertEqual(result(lots)["combined"], 1)
        for value in (float("nan"), float("inf"), "90", True):
            self.assertEqual(result([lot(1, title="same"), lot(2, title="same")], settings={"tlxNameMatch": value})["combined"], 1)
        self.assertEqual(result([lot(1, title="a b c"), lot(2, title="a b d")], settings={"tlxNameMatch": 0})["combined"], 1)


class SortTests(unittest.TestCase):
    def test_leading_specs_move_and_bare_models_stay(self) -> None:
        cases = {
            "1 in. Copper Tubing Cutter": "Copper Tubing Cutter 1 in.",
            "(2026 Upgraded) 20V Drill": "Drill (2026 Upgraded) 20V",
            "Set of 3 Copper Bowls": "Copper Bowls Set of 3",
            "24 x 36 Picture Frame": "Picture Frame 24 x 36",
            "12 in. x 12 in. Tiles": "Tiles 12 in. x 12 in.",
            "6FTx300FT Fence": "Fence 6FTx300FT",
            "4-Light Fixture": "Fixture 4-Light",
            "2x180W Solar Panel": "Solar Panel 2x180W",
            "1-3/8 in. Cutter": "Cutter 1-3/8 in.",
            "80,000 BTU Heater": "Heater 80,000 BTU",
            "18.5 in 3.2 cu. ft. Refrigerator": "Refrigerator 18.5 in 3.2 cu. ft.",
            "3-in-1 Tool": "3-in-1 Tool",
            "2 in 1 Tool": "2 in 1 Tool",
            "3M Tape": "3M Tape",
            "2026 Model": "2026 Model",
            "X2 Robotic Vacuum": "X2 Robotic Vacuum",
            "!!! Drill": "Drill",
            "20V": "20V",
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(_sort_key(title), expected)
        self.assertEqual(_sort_key("1/3 HP Continuous Feed", "Garbage Disposal"), "Garbage Disposal Continuous Feed 1/3 HP")

    def test_title_numeric_case_accents_types_and_descending_ties(self) -> None:
        lots = [
            lot(1, title="Widget 10"),
            lot(2, title="widget 2"),
            lot(3, title="2 in. Widget"),
            lot(4, title="20V Drill"),
            lot(5, title="éclair 2"),
            lot(6, title="ECLAIR 2", hasBid=True, endsAt=NOW + 1),
        ]
        self.assertEqual(ids(result(lots, {"sort": "title-asc"})), [4, 6, 5, 2, 3, 1])
        self.assertEqual(ids(result(lots, {"sort": "title-desc"})), [1, 3, 2, 6, 5, 4])
        typed = [lot(1, title="Zebra", itemType="A"), lot(2, title="Apple", itemType="Z")]
        self.assertEqual(ids(result(typed, {"sort": "title-asc"})), [1, 2])

    def test_all_other_sorts_and_tie_breaks(self) -> None:
        lots = [
            lot(1, endsAt=NOW + 30, currentPrice=10, bidCount=5, estimatedRetailPrice=100),
            lot(2, endsAt=NOW + 10, currentPrice=20, bidCount=1, estimatedRetailPrice=200),
            lot(3, endsAt=NOW + 10, currentPrice=0, bidCount=1, estimatedRetailPrice=None),
        ]
        expected = {
            "ending-soonest": [2, 3, 1],
            "newly-listed": [3, 2, 1],
            "total-asc": [3, 1, 2],
            "total-desc": [2, 1, 3],
            "retail-pct-asc": [2, 1, 3],
            "retail-desc": [2, 1, 3],
            "bids-most": [1, 2, 3],
            "bids-fewest": [2, 3, 1],
        }
        for sort, order in expected.items():
            with self.subTest(sort=sort):
                self.assertEqual(ids(result(lots, {"sort": sort})), order)
        for sort in SORTS:
            tied = [lot(3), lot(2), lot(1, endsAt=NOW + 1)]
            if not sort.startswith("title") and sort != "newly-listed":
                self.assertEqual(ids(result(tied, {"sort": sort})), [1, 2, 3])


class FacetTests(unittest.TestCase):
    def test_branch_values_select_own_lots_and_all_descendants_only(self) -> None:
        custom = [
            {"name": "Tools - Power", "types": ["Power"]},
            {"name": "Tools - Power - Saws", "types": ["Saw"]},
            {"name": "Tools - Hand", "types": ["Hand"]},
        ]
        lots = [
            lot(1),
            lot(2, itemType="Power"),
            lot(3, itemType="Saw"),
            lot(4, itemType="Hand"),
            lot(5, category={"value": "home", "label": "Home"}),
        ]
        settings = {"tlxCustomCategories": custom}
        roots = category_tree(compute_facets(lots, NOW, custom))
        self.assertEqual([node["label"] for node in roots], ["Home", "Tools"])
        tools = roots[1]
        self.assertEqual((tools["ownCount"], tools["count"]), (1, 4))
        self.assertEqual(ids(result(lots, {"categories": tools["values"]}, settings)), [1, 2, 3, 4])
        self.assertEqual(ids(result(lots, {"categories": [tools["value"]]}, settings)), [1])
        power = tools["children"][1]
        self.assertEqual((power["label"], power["ownCount"], power["count"]), ("Power", 1, 2))
        self.assertEqual(ids(result(lots, {"categories": power["values"]}, settings)), [2, 3])
        child = power["children"][0]
        self.assertEqual((child["label"], child["values"]), ("Saws", ["custom:Tools - Power - Saws"]))
        self.assertEqual(ids(result(lots, {"categories": child["values"]}, settings)), [3])
        self.assertEqual(roots[0]["values"], ["home"])

    def test_empty_custom_root_and_natural_child_order(self) -> None:
        custom = [
            {"name": "Workshop", "types": []},
            {"name": "Workshop - Bin 10", "types": ["Ten"]},
            {"name": "Workshop - Bin 2", "types": ["Two"]},
            {"name": "Tools-Saws", "types": ["Saw"]},
        ]
        lots = [lot(1, itemType="Ten"), lot(2, itemType="Two"), lot(3, itemType="Saw")]
        tree = category_tree(compute_facets(lots, NOW, custom))
        self.assertEqual([node["label"] for node in tree], ["Tools-Saws", "Workshop"])
        workshop = tree[1]
        self.assertEqual((workshop["ownCount"], workshop["count"]), (0, 2))
        self.assertEqual([child["label"] for child in workshop["children"]], ["Bin 2", "Bin 10"])
        self.assertEqual(workshop["values"], ["custom:Workshop", "custom:Workshop - Bin 2", "custom:Workshop - Bin 10"])
        self.assertEqual(ids(result(lots, {"categories": workshop["values"]}, {"tlxCustomCategories": custom})), [1, 2])
        self.assertEqual(tree[0]["children"], [])
        self.assertEqual(category_tree(compute_facets([], NOW, custom)), [])

    def test_open_only_counts_order_and_first_labels(self) -> None:
        lots = [
            lot(1),
            lot(
                2, category={"value": "tools", "label": "Other Label"}, condition={"value": 2, "label": "Used"}, location={"name": "Durham"}
            ),
            lot(3, location={"name": "Durham"}),
            lot(4, endsAt=NOW),
            lot(5, category=None, condition=None, location=None),
        ]
        facets = compute_facets(iter(lots), NOW, [])
        self.assertEqual(facets["categories"], [{"value": "tools", "label": "Tools", "count": 3}])
        self.assertEqual(facets["conditions"], [{"value": 1, "label": "New", "count": 2}, {"value": 2, "label": "Used", "count": 1}])
        self.assertEqual(
            facets["locations"], [{"value": "Durham", "label": "Durham", "count": 2}, {"value": "Raleigh", "label": "Raleigh", "count": 1}]
        )

    def test_nested_categories_longest_parent_and_empty_heading(self) -> None:
        custom = [
            {"name": "Tools - Power", "types": []},
            {"name": "Tools - Power - Saws", "types": ["Saw"]},
            {"name": "Tools - Power - Drills", "types": ["Drill"]},
            {"name": "Tools - Hand", "types": ["Hand"]},
            {"name": "Empty", "types": []},
        ]
        lots = [lot(1, itemType="Saw"), lot(2, itemType="Saw"), lot(3, itemType="Drill"), lot(4, itemType="Hand")]
        tree = category_tree(compute_facets(lots, NOW, custom))
        self.assertEqual(len(tree), 1)
        root = tree[0]
        self.assertEqual((root["value"], root["label"], root["count"], root["ownCount"]), ("tools", "Tools", 4, 0))
        self.assertEqual([child["label"] for child in root["children"]], ["Hand", "Power"])
        power = root["children"][1]
        self.assertEqual((power["count"], power["ownCount"]), (3, 0))
        self.assertEqual([child["label"] for child in power["children"]], ["Drills", "Saws"])
        self.assertEqual(power["values"], ["custom:Tools - Power", "custom:Tools - Power - Drills", "custom:Tools - Power - Saws"])
        self.assertEqual(len(root["values"]), 5)
        self.assertNotIn("custom:Empty", root["values"])
        facets = compute_facets([*lots, lot(5)], NOW, custom)
        self.assertEqual(category_tree(facets)[0]["ownCount"], 1)
        self.assertEqual(category_tree(facets)[0]["count"], 5)


class SavedSearchTests(unittest.TestCase):
    def test_counts_listings_not_cards_and_strict_fresh_boundary(self) -> None:
        lots = [
            lot(1, title="Drill", firstSeenAt=NOW - 1),
            lot(2, title="Drill", firstSeenAt=NOW),
            lot(3, title="Drill", firstSeenAt=NOW + 1),
            lot(4, title="Drill", firstSeenAt=NOW + 1, endsAt=NOW),
            lot(5, title="Saw", firstSeenAt=None),
            lot(6, title="Drill", firstSeenAt=NOW + 1),
            lot(7, title="Gold Drill", firstSeenAt=NOW + 1, hasBid=True),
        ]
        searches = [
            {"id": "drills", "view": {"search": "drill", "newSince": NOW + 10}, "lastViewedAt": NOW},
            {"id": "all", "view": {}, "lastViewedAt": NOW - 1},
            {"id": "bid", "view": {"mine": "bid"}, "lastViewedAt": NOW},
        ]
        settings = {"hiddenLots": {"6": {}}, "showHidden": True, "filterWords": ["gold"], "removeFiltered": False}
        stats = saved_search_stats(iter(lots), searches, "Raleigh", settings, NOW, "America/New_York")
        self.assertEqual(stats, {"drills": {"total": 3, "fresh": 1}, "all": {"total": 4, "fresh": 2}, "bid": {"total": 0, "fresh": 0}})
        self.assertEqual(result(lots, settings=settings)["combined"], 2)
        off = saved_search_stats(lots, searches, "Raleigh", {**settings, "filterEnabled": False}, NOW)
        self.assertEqual(off["bid"], {"total": 1, "fresh": 1})

    def test_saved_filters_and_errors(self) -> None:
        searches = [{"id": "one", "view": {"priceMin": 20, "ending": "1h"}, "lastViewedAt": 0}]
        lots = [lot(1), lot(2, currentPrice=20), lot(3, currentPrice=20, endsAt=NOW + 3_600_000)]
        self.assertEqual(saved_search_stats(lots, searches, "", {}, NOW), {"one": {"total": 1, "fresh": 1}})
        with self.assertRaisesRegex(ValueError, "Invalid exclusion"):
            saved_search_stats([], [], "", {"filterWords": ["["]}, NOW)
        searches[0]["view"] = {"searchRegex": True, "search": "["}
        with self.assertRaisesRegex(ValueError, "Invalid search"):
            saved_search_stats([], searches, "", {}, NOW)


if __name__ == "__main__":
    unittest.main()
