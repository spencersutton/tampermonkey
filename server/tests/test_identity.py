import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from unittest.mock import Mock, patch

from tlx_server.history import History, ItemIndex
from tlx_server.identity import brand_model_key
from tlx_server.itemtypes import Labeller
from tlx_server.server import Api, make_handler
from tlx_server.store import Store


def lot(lot_id: int, title: str = "Cordless drill", **fields: object) -> dict[str, Any]:
    return {
        "id": lot_id,
        "title": title,
        "brand": "Acme",
        "model": "D-100",
        "auctionPeriod": "test",
        "endsAt": 1000,
        "currentPrice": 20,
        "condition": None,
        "status": "sold",
        "bidCount": 1,
        "category": {"value": "tools", "label": "Tools"},
        **fields,
    }


class IdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "catalog.db"
        self.store = Store(self.path)
        self.addCleanup(self.store._db.close)
        self.history = History(self.store)

    def add_open(self, *items: dict[str, Any]) -> None:
        for item in items:
            self.store.save_lot_detail(item)
        self.store.replace_all(items)

    def add_closed(self, *items: dict[str, Any]) -> None:
        for item in items:
            self.store.save_lot_detail(item)
            self.store.finish_close(item["id"], item)

    def get_lot(self, lot_id: int, store: Store | None = None) -> dict[str, Any]:
        item = (store if store is not None else self.store).lot(lot_id)
        assert item is not None, f"Expected stored lot {lot_id}"
        return item

    def test_identity_normalization_preserves_model_punctuation_and_requires_both_fields(self) -> None:
        self.assertEqual(brand_model_key(lot(1, brand=" ACME   Tools ", model=" D  100 ")), ("acme tools", "d 100"))
        self.assertNotEqual(brand_model_key(lot(1)), brand_model_key(lot(1, model="D100")))
        for item in (lot(1, brand=None), lot(1, model="  "), lot(1, model=None)):
            self.assertIsNone(brand_model_key(item))

    def test_history_prefers_identity_with_title_fallback_in_either_direction(self) -> None:
        self.add_closed(
            lot(1, "Entirely different title", endsAt=100),
            lot(2, model="D-200", endsAt=200),
            lot(3, brand=None, endsAt=300),
            lot(4, brand=" ACME ", model=" d-100 ", endsAt=400),
        )
        self.assertEqual([r["id"] for r in self.history.closes_for(lot(10))], [4, 3, 1])
        self.assertEqual([r["id"] for r in self.history.closes_for(lot(10, model=None))], [4, 3, 2])
        self.assertEqual([r["id"] for r in self.history.closes_for(lot(4))], [3, 1], "the same lot is never its own history")
        self.assertEqual(self.history.closes_for(lot(10, "Unrelated title", model=None)), [])

    def test_incomplete_title_fallback_keeps_numeric_and_fuzzy_rules(self) -> None:
        rows = [lot(1, "Cordless drill Qty 2", brand=None), lot(2, "drill Cordless", brand=None)]
        index = ItemIndex(rows, 90)
        self.assertEqual([r["id"] for r in index.matches(lot(3))], [2])
        self.assertEqual(index.matches(lot(3, "Cordless drill Qty 3")), [])

    def test_saved_identity_changes_invalidate_history_index_and_publish_updated_past_closes(self) -> None:
        self.add_open(lot(10, "Open tool"))
        self.add_closed(lot(1, "Old listing", model="D-200"))
        self.history.refresh()
        self.assertNotIn("pastCloses", self.get_lot(10))
        before = self.store.seq()
        self.store.save_lot_detail(lot(1, "Old listing"))
        self.history.refresh()
        changed = self.store.changes(before).lots
        self.assertEqual([r["id"] for r in changed], [10])
        self.assertEqual(changed[0]["pastCloses"]["n"], 1)
        self.store.save_lot_detail(lot(10, "Open tool", model="D-300"))
        self.history.refresh()
        self.assertNotIn("pastCloses", self.get_lot(10))
        reopened = Store(self.path)
        self.addCleanup(reopened._db.close)
        self.assertEqual(History(reopened).closes_for(lot(11)), self.history.closes_for(lot(11)))

    def test_type_corrections_share_known_identity_not_identical_titles_of_other_models(self) -> None:
        self.add_open(lot(1), lot(2, "Another title"), lot(3, model="D-200"), lot(4, model=None))
        before = self.store.seq()
        self.store.save_lot_types([(self.get_lot(1), "driver")], manual=True)
        self.assertEqual({r["id"] for r in self.store.changes(before).lots}, {1, 2, 4})
        self.assertNotIn("itemType", self.get_lot(3))
        self.store.save_lot_types([(self.get_lot(3), "hammer drill")], manual=True)
        self.assertEqual(self.get_lot(1)["itemType"], "driver")
        self.assertEqual(self.get_lot(3)["itemType"], "hammer drill")
        before = self.store.seq()
        self.store.save_lot_types([(self.get_lot(2), "battery")])
        self.assertEqual(self.get_lot(2)["itemType"], "driver")
        self.assertEqual(self.store.seq(), before)

    def test_identity_labels_survive_restart_and_relisting_and_reset_clears_them(self) -> None:
        self.add_open(lot(1))
        self.store.save_lot_types([(self.get_lot(1), "driver")], manual=True)
        self.store.replace_all([])
        reopened = Store(self.path)
        self.addCleanup(reopened._db.close)
        fresh = lot(5, "New description")
        reopened.save_lot_detail(fresh)
        reopened.replace_all([fresh])
        self.assertEqual(self.get_lot(5, reopened)["itemType"], "driver")
        self.assertEqual(reopened.untyped_items(), [])
        before = reopened.seq()
        self.assertEqual(reopened.reset_item_types(), 1)
        self.assertNotIn("itemType", self.get_lot(5, reopened))
        self.assertEqual([r["id"] for r in reopened.changes(before).lots], [5])

    def test_identity_labels_beat_title_only_automatic_labels_but_not_manual_corrections(self) -> None:
        self.add_open(lot(1))
        self.store.save_lot_types([(self.get_lot(1), "driver")])
        self.store.save_item_types({"Cordless drill": ("battery", "tools")})
        self.assertEqual(self.get_lot(1)["itemType"], "driver")
        self.store.save_item_types({"Cordless drill": ("hammer drill", "tools")}, manual=True)
        self.assertEqual(self.get_lot(1)["itemType"], "hammer drill")
        self.store.save_lot_types([(self.get_lot(1), "driver")])
        self.assertEqual(self.get_lot(1)["itemType"], "hammer drill")

    def test_latest_manual_correction_wins_when_either_identity_is_missing(self) -> None:
        self.add_open(lot(1), lot(2, model=None))
        self.store.save_item_types({"Cordless drill": ("battery", "tools")}, manual=True)
        self.store.save_lot_types([(self.get_lot(1), "driver")], manual=True)
        self.assertEqual(self.get_lot(2)["itemType"], "driver")
        self.store.save_lot_types([(self.get_lot(2), "hammer drill")], manual=True)
        self.assertEqual(self.get_lot(1)["itemType"], "hammer drill")
        self.store.save_lot_detail(lot(2, model="D-200"))
        self.store.save_lot_types([(self.get_lot(1), "drill")], manual=True)
        self.assertEqual(self.get_lot(2)["itemType"], "hammer drill", "different complete identities no longer share corrections")

    def test_late_details_reassign_types_and_publish_deltas_without_spurious_refresh_changes(self) -> None:
        self.add_open(lot(1), lot(2, "Other title", model=None))
        self.store.save_lot_types([(self.get_lot(1), "driver")], manual=True)
        before = self.store.seq()
        self.store.save_lot_detail(lot(2, "Other title"))
        self.assertEqual(self.get_lot(2)["itemType"], "driver")
        self.assertIn(2, [r["id"] for r in self.store.changes(before).lots])
        before = self.store.seq()
        pulled = [
            {key: value for key, value in item.items() if key not in {"brand", "model", "itemType"}}
            for item in self.store.all_lots().values()
        ]
        self.store.replace_all(pulled)
        self.assertEqual(self.store.seq(), before)
        self.store.save_lot_detail(lot(2, "Other title", model="Different"))
        self.assertNotIn("itemType", self.get_lot(2))

    def test_labeller_requests_one_label_per_known_identity_and_retains_manual_race_protection(self) -> None:
        self.add_open(lot(1), lot(2, "Different title"), lot(3, "Saw", model="S-1"))
        labeller = Labeller(self.store, "")

        def reply(category: str, titles: list[str], vocab: list[str]) -> dict[int, str]:
            self.assertEqual(titles, ["Cordless drill", "Saw"])
            self.store.save_lot_types([(self.get_lot(2), "driver")], manual=True)
            return {1: "battery", 2: "saw"}

        with patch.object(labeller, "ask", side_effect=reply):
            labeller.label_all()
        self.assertEqual(self.get_lot(1)["itemType"], "driver")
        self.assertEqual(self.get_lot(2)["itemType"], "driver")
        self.assertEqual(self.get_lot(3)["itemType"], "saw")

    def test_api_corrections_and_closed_page_proxy_carry_cached_identity(self) -> None:
        self.add_open(lot(1), lot(2, "Different title"), lot(3, model="D-200"))
        catalog = Mock()
        session = Mock()
        session.token.return_value = None
        api = Api(self.store, catalog, session, None, set(), False)
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(api))
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(method: str, path: str, body: object = None) -> tuple[int, dict[str, Any]]:
            conn = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                conn.request(
                    method,
                    path,
                    body=None if body is None else json.dumps(body),
                    headers={"X-TLX-Client": "1", "Content-Type": "application/json"},
                )
                response = conn.getresponse()
                return response.status, json.loads(response.read())
            finally:
                conn.close()

        try:
            status, result = request("PUT", "/api/item-type", {"lotId": 1, "itemType": "driver"})
            self.assertEqual(status, 200)
            self.assertEqual((result["brand"], result["model"]), ("Acme", "D-100"))
            self.assertEqual(self.get_lot(2)["itemType"], "driver")
            self.assertNotIn("itemType", self.get_lot(3))
            with patch("tlx_server.server._opener.open") as upstream:
                response = upstream.return_value
                response.status = 200
                response.headers = {"Content-Type": "application/json"}
                response.read.return_value = json.dumps({
                    "count": 1,
                    "results": [{"lot_id": 1, "title": "Closed title", "auction_period": "test"}],
                }).encode()
                status, result = request("GET", "/backend/v1/auctions/control-panel/closed/lost/?page=1")
                self.assertEqual(status, 200)
                self.assertEqual(result["results"][0]["brand"], "Acme")
                self.assertEqual(result["results"][0]["model"], "D-100")
                response.read.return_value = json.dumps({
                    "id": 1,
                    "title": "Cordless drill",
                    "brand": "Acme",
                    "model": "D-300",
                    "auction_period": "test",
                }).encode()
                status, _ = request("GET", "/backend/v1/auctions/lots/test/1/")
                self.assertEqual(status, 200)
                catalog.history.wake.assert_called_once()
        finally:
            server.shutdown()
            thread.join()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
