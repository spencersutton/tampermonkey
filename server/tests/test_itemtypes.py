import json
import sqlite3
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from unittest.mock import Mock, patch

from tlx_server.itemtypes import Labeller
from tlx_server.server import Api, make_handler
from tlx_server.store import Store


def lot(lot_id: int, title: str = "Drill", **fields: object) -> dict[str, Any]:
    return {"id": lot_id, "title": title, "category": {"value": "tools", "label": "Tools"}, "version": 1, **fields}


class ItemTypeStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "catalog.db"
        self.store = Store(self.path)
        self.addCleanup(self.store._db.close)
        self.store.replace_all([lot(1), lot(2), lot(3, "Saw")])

    def test_manual_correction_touches_all_exact_title_matches_and_preserves_other_lots(self) -> None:
        self.store.save_item_types({"Drill": ("battery", "tools"), "Saw": ("saw", "tools")})
        before = self.store.seq()
        self.store.save_item_types({"Drill": ("drill driver", "tools")}, manual=True)
        changes = self.store.changes(before)
        self.assertEqual({l["id"] for l in changes.lots}, {1, 2})
        self.assertTrue(all(l["itemType"] == "drill driver" for l in changes.lots))
        self.assertEqual(self.store.item_types(["Drill", "Saw"]), {"Drill": "drill driver", "Saw": "saw"})

    def test_corrections_survive_reopening_catalog_refreshes_and_future_relistings(self) -> None:
        self.store.save_item_types({"Drill": ("drill driver", "tools")}, manual=True)
        reopened = Store(self.path)
        self.addCleanup(reopened._db.close)
        reopened.replace_all([lot(1, currentPrice=20), lot(4)])
        self.assertEqual({l["itemType"] for l in reopened.all_lots().values()}, {"drill driver"})
        self.assertEqual(reopened.untyped_lots(), {})

    def test_automatic_writes_never_replace_corrections_or_bump_their_sequence(self) -> None:
        self.store.save_item_types({"Drill": ("drill driver", "tools")}, manual=True)
        before = self.store.seq()
        self.store.save_item_types({"Drill": ("battery", "tools")})
        self.assertEqual(self.store.seq(), before)
        self.assertEqual(self.store.item_types(["Drill"]), {"Drill": "drill driver"})
        self.store.save_item_types({"Drill": ("battery", "tools"), "Saw": ("saw", "tools")})
        self.assertEqual([l["id"] for l in self.store.changes(before).lots], [3])

    def test_label_in_flight_cannot_undo_a_manual_correction(self) -> None:
        labeller = Labeller(self.store, "")

        def reply(*args: object) -> dict[int, str]:
            self.store.save_item_types({"Drill": ("drill driver", "tools")}, manual=True)
            return {1: "battery", 2: "saw"}

        with patch.object(labeller, "ask", side_effect=reply):
            labeller.label_all()
        self.assertEqual(self.store.item_types(["Drill", "Saw"]), {"Drill": "drill driver", "Saw": "saw"})

    def test_same_type_can_be_marked_manual_and_later_corrected_without_unnecessary_delta(self) -> None:
        self.store.save_item_types({"Drill": ("drill driver", "tools")})
        before = self.store.seq()
        self.store.save_item_types({"Drill": ("drill driver", "tools")}, manual=True)
        self.assertEqual(self.store.seq(), before)
        self.store.save_item_types({"Drill": ("battery", "tools")})
        self.assertEqual(self.store.seq(), before)
        self.store.save_item_types({"Drill": ("hammer drill", "tools")}, manual=True)
        self.assertEqual(self.store.item_types(["Drill"]), {"Drill": "hammer drill"})

    def test_explicit_reset_still_forgets_manual_and_automatic_types(self) -> None:
        self.store.save_item_types({"Drill": ("drill driver", "tools")}, manual=True)
        self.store.save_item_types({"Saw": ("saw", "tools")})
        before = self.store.seq()
        self.assertEqual(self.store.reset_item_types(), 2)
        self.assertEqual(self.store.item_types(["Drill", "Saw"]), {})
        self.assertEqual({l["id"] for l in self.store.changes(before).lots}, {1, 2, 3})

    def test_older_item_type_table_migrates_without_losing_labels(self) -> None:
        path = self.path.with_name("old.db")
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE item_types (title TEXT PRIMARY KEY, type TEXT NOT NULL, category TEXT, at REAL NOT NULL)")
            db.execute("INSERT INTO item_types VALUES (?, ?, ?, ?)", ("Drill", "battery", "tools", 0))
        migrated = Store(path)
        self.addCleanup(migrated._db.close)
        self.assertEqual(migrated.item_types(["Drill"]), {"Drill": "battery"})
        migrated.save_item_types({"Drill": ("drill driver", "tools")}, manual=True)
        migrated.save_item_types({"Drill": ("battery", "tools")})
        self.assertEqual(migrated.item_types(["Drill"]), {"Drill": "drill driver"})


class ItemTypeApiTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.store = Store(Path(folder.name) / "catalog.db")
        self.addCleanup(self.store._db.close)
        self.store.replace_all([lot(1), lot(2)])
        self.api = Api(self.store, Mock(), Mock(), None, set(), False)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.api))
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self) -> None:
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()

    def request(self, body: object, *, client: bool = True, cookie: str | None = None) -> tuple[int, dict[str, Any]]:
        headers = {"Content-Type": "application/json"}
        if client:
            headers["X-TLX-Client"] = "1"
        if cookie:
            headers["Cookie"] = cookie
        conn = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            conn.request("PUT", "/api/item-type", body=json.dumps(body), headers=headers)
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_saves_canonical_type_and_returns_title_and_catalog_sequence(self) -> None:
        before = self.store.seq()
        status, data = self.request({"lotId": 1, "itemType": '  "Drill   Driver."  '})
        self.assertEqual(status, 200)
        self.assertEqual(data, {"title": "Drill", "itemType": "drill driver", "seq": before + 1})
        self.assertEqual({l["itemType"] for l in self.store.all_lots().values()}, {"drill driver"})
        self.store.save_item_types({"Drill": ("battery", "tools")})
        self.assertEqual(self.store.item_types(["Drill"]), {"Drill": "drill driver"})

    def test_missing_lot_returns_an_explicit_not_found_error(self) -> None:
        status, data = self.request({"lotId": 99, "itemType": "drill"})
        self.assertEqual(status, 404)
        self.assertEqual(data["error"], "No such catalog lot")
        self.assertEqual(self.store.item_types(["Drill"]), {})

    def test_invalid_ids_types_and_json_shapes_are_rejected_without_changes(self) -> None:
        invalid = [
            [],
            None,
            {},
            {"lotId": True, "itemType": "drill"},
            {"lotId": "1", "itemType": "drill"},
            {"lotId": 0, "itemType": "drill"},
            {"lotId": -1, "itemType": "drill"},
            {"lotId": 2**64, "itemType": "drill"},
            {"lotId": 1, "itemType": None},
            {"lotId": 1, "itemType": 3},
            {"lotId": 1, "itemType": "   "},
            {"lotId": 1, "itemType": "..."},
            {"lotId": 1, "itemType": "drill\x00"},
            {"lotId": 1, "itemType": "x" * 61},
        ]
        before = self.store.seq()
        for body in invalid:
            with self.subTest(body=body):
                status, data = self.request(body)
                self.assertEqual(status, 400)
                self.assertTrue(data["error"])
        self.assertEqual(self.store.seq(), before)

    def test_csrf_and_app_password_guards_apply_to_corrections(self) -> None:
        body = {"lotId": 1, "itemType": "drill driver"}
        self.assertEqual(self.request(body, client=False)[0], 403)
        self.api.password = "test-only-password"
        self.assertEqual(self.request(body)[0], 401)
        self.assertEqual(self.store.item_types(["Drill"]), {})
        self.store.add_session("test-session")
        self.assertEqual(self.request(body, cookie="tlx_session=test-session")[0], 200)


if __name__ == "__main__":
    unittest.main()
