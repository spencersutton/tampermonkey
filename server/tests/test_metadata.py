import json
import sqlite3
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from tlx_server.server import Api, make_handler
from tlx_server.site import normalize_detail, normalize_lot
from tlx_server.store import Store


class MetadataTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "catalog.db"
        self.store = Store(self.path)
        self.addCleanup(self.store._db.close)
        self.raw = {
            "id": 1,
            "auction_period": "test",
            "title": "Drill",
            "description": "Saved description",
            "brand": "Acme",
            "model": "D1",
            "lot_fee": 2,
            "current_price": 17,
            "bid_count": 3,
            "status": "open",
            "version": 5,
            "ends_at": "2030-01-01T00:00:00Z",
            "your_standing": {"is_leading": True, "your_max_bid": 20},
            "is_watchlisted": True,
            "bid_history": [{"bidder_label": "Private bidder", "amount": 17, "is_you": True}],
            "images": [{"position": 1, "image_thumb": "thumb.jpg", "image_card": "card.jpg", "image_large": "large.jpg"}],
        }
        self.expected = {
            "description": "Saved description",
            "brand": "Acme",
            "model": "D1",
            "lotFee": 2,
            "images": [{"thumb": "thumb.jpg", "card": "card.jpg", "large": "large.jpg"}],
        }
        self.store.replace_all([normalize_lot(self.raw)])
        self.store.save_lot_detail(normalize_detail(self.raw))

    def test_metadata_survives_restart_and_lot_removal_without_auction_or_account_fields(self) -> None:
        self.store.replace_all([])
        reopened = Store(self.path)
        self.addCleanup(reopened._db.close)
        self.assertEqual(reopened.lot_metadata(1, "test"), self.expected)
        self.assertIsNone(reopened.lot_metadata(1, "different-period"))
        self.assertIsNone(reopened.lot_metadata(2, "test"))
        reopened.save_lot_detail(normalize_detail({**self.raw, "description": "Corrected", "images": []}))
        self.assertEqual(reopened.lot_metadata(1, "test"), {**self.expected, "description": "Corrected", "images": []})

    def test_legacy_details_migrate_without_losing_description_or_inventing_images(self) -> None:
        legacy_path = self.path.with_name("legacy.db")
        with sqlite3.connect(legacy_path) as db:
            db.execute(
                """CREATE TABLE lot_details (
                    lot_id INTEGER PRIMARY KEY, auction_period TEXT, title TEXT NOT NULL, status TEXT,
                    current_price NUMERIC, description TEXT, brand TEXT, model TEXT, lot_fee NUMERIC,
                    bid_history TEXT NOT NULL, fetched_at INTEGER NOT NULL
                )"""
            )
            db.execute(
                "INSERT INTO lot_details VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (1, "test", "Drill", "open", 17, "Legacy description", "Acme", "D1", 2, "[]", 1),
            )
        migrated = Store(legacy_path)
        self.addCleanup(migrated._db.close)
        self.assertEqual(
            migrated.lot_metadata(1, "test"), {"description": "Legacy description", "brand": "Acme", "model": "D1", "lotFee": 2}
        )
        migrated.save_lot_detail(normalize_detail(self.raw))
        self.assertEqual(migrated.lot_metadata(1, "test"), self.expected)

    def test_metadata_endpoint_is_cache_only_and_obeys_app_guards(self) -> None:
        api = Api(self.store, Mock(), Mock(), None, set(), False)
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(api))
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def request(query: str, *, client: bool = True, cookie: str | None = None, host: str | None = None) -> tuple[int, object]:
            headers = {"X-TLX-Client": "1"} if client else {}
            if host:
                headers["Host"] = host
            if cookie:
                headers["Cookie"] = cookie
            conn = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                conn.request("GET", f"/api/lot-metadata?{query}", headers=headers)
                response = conn.getresponse()
                return response.status, json.loads(response.read())
            finally:
                conn.close()

        try:
            with patch("tlx_server.server._opener.open") as upstream:
                self.assertEqual(request("id=1&auctionPeriod=test"), (200, {"metadata": self.expected}))
                self.assertEqual(request("id=99&auctionPeriod=test"), (200, {"metadata": None}))
                self.assertEqual(request("id=1&auctionPeriod=other"), (200, {"metadata": None}))
                for query in ("", "id=1", "id=0&auctionPeriod=test", "id=bad&auctionPeriod=test"):
                    self.assertEqual(request(query)[0], 400)
                self.assertEqual(request("id=1&auctionPeriod=test", client=False)[0], 200, "read-only GETs do not need a CSRF header")
                self.assertEqual(request("id=1&auctionPeriod=test", host="untrusted.example")[0], 403)
                api.password = "fixture-password"
                self.assertEqual(request("id=1&auctionPeriod=test")[0], 401)
                self.store.add_session("fixture-session")
                self.assertEqual(request("id=1&auctionPeriod=test", cookie="tlx_session=fixture-session")[0], 200)
                upstream.assert_not_called()
        finally:
            server.shutdown()
            thread.join()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
