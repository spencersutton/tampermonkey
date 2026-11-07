import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from test_ui import raw_lot

from tlx_server.gateway import Gateway
from tlx_server.live import Live
from tlx_server.site import normalize_lot
from tlx_server.store import Store


class LiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "test.db")
        self.session = Mock(logged_in=True)
        self.gateway = Gateway(self.store, self.session)
        self.live = Live(self.store, self.gateway)
        self.store.replace_all([normalize_lot(raw_lot())])
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.store._db.close)

    def test_late_catalog_pull_cannot_overwrite_live_prices_or_account_updates(self) -> None:
        started = self.store.seq()
        self.live.publication("lot:1", {"id": 1, "version": 8, "current_price": 42})
        self.live.publication("user:1", {"lot_id": 1, "type": "winning", "relationship": {"is_leading": True, "your_max_bid": 50}})
        stale = normalize_lot(raw_lot())
        stale["firstSeenAt"] = 123
        self.store.replace_all([stale], started_seq=started)
        lot = self.store.lot(1)
        self.assertEqual(lot["currentPrice"], 42)
        self.assertEqual(lot["version"], 8)
        self.assertTrue(lot["yourStanding"]["isLeading"])
        self.assertEqual(lot["firstSeenAt"], 123)

    def test_equal_version_account_changes_survive_inflight_pull(self) -> None:
        started = self.store.seq()
        self.store.merge_lot(1, {"isWatchlisted": True}, account=True)
        self.store.replace_all([normalize_lot(raw_lot())], started_seq=started)
        self.assertTrue(self.store.lot(1)["isWatchlisted"])

    def test_unrelated_price_updates_do_not_discard_fresh_account_data(self) -> None:
        started = self.store.seq()
        self.store.merge_lot(1, {"version": 4, "currentPrice": 20})
        fresh = normalize_lot(raw_lot())
        fresh["yourStanding"] = {"isLeading": False, "yourMaxBid": 15}
        self.store.replace_all([fresh], started_seq=started)
        lot = self.store.lot(1)
        self.assertEqual(lot["currentPrice"], 20)
        self.assertEqual(lot["yourStanding"]["yourMaxBid"], 15)

    def test_late_bid_reply_does_not_overwrite_newer_outbid_event(self) -> None:
        started = self.store.seq()
        self.store.merge_lot(1, {"yourStanding": {"isLeading": False, "yourMaxBid": 20}, "hasBid": True}, account=True)
        self.store.merge_lot(
            1, {"yourStanding": {"isLeading": True, "yourMaxBid": 20}, "version": 2, "currentPrice": 20}, account=True, since=started
        )
        lot = self.store.lot(1)
        self.assertFalse(lot["yourStanding"]["isLeading"])
        self.assertEqual(lot["currentPrice"], 20)

    def test_stale_price_event_cannot_move_price_backwards(self) -> None:
        self.live.publication("lot:1", {"id": 1, "version": 3, "current_price": 30})
        self.live.publication("lot:1", {"id": 1, "version": 2, "current_price": 20})
        self.assertEqual(self.store.lot(1)["currentPrice"], 30)

    def test_cached_detail_does_not_overwrite_newer_account_state(self) -> None:
        with patch.object(self.gateway, "request", return_value=raw_lot()) as request:
            self.gateway.detail(1)
            self.store.merge_lot(1, {"yourStanding": {"isLeading": False, "yourMaxBid": 20}, "hasBid": True}, account=True)
            detail = self.gateway.detail(1)
            self.assertEqual(detail["yourStanding"]["yourMaxBid"], 20)
            self.assertEqual(request.call_count, 1)

    def test_detail_images_survive_newer_live_prices(self) -> None:
        self.store.merge_lot(1, {"version": 5, "currentPrice": 20})
        raw = raw_lot()
        raw["images"] = [{"position": 1, "image_thumb": "small", "image_card": "card", "image_large": "large"}]
        with patch.object(self.gateway, "request", return_value=raw):
            detail = self.gateway.detail(1)
        self.assertEqual(detail["currentPrice"], 20)
        self.assertEqual(detail["images"][0]["large"], "large")

    def test_tabs_share_subscriptions_and_inactive_tabs_are_removed(self) -> None:
        self.live.watch("a", [1, 2], True)
        self.live.watch("b", [2, 3], True)
        self.assertEqual(self.live.wanted(), {1, 2, 3})
        self.live.watch("a", [], False)
        self.assertEqual(self.live.wanted(), {2, 3})
        self.live._tabs["b"] = (-1000, {2, 3})
        self.assertEqual(self.live.wanted(), set())

    def test_account_updates_remain_subscribed_with_an_empty_filtered_grid(self) -> None:
        self.live.watch("a", [], True)
        self.assertEqual(self.live.wanted(), set())
        self.assertTrue(self.live._account_wanted())
        self.live.watch("a", [], False)
        self.assertFalse(self.live._account_wanted())

    def test_upstream_protocol_subscribes_catches_up_and_answers_negotiated_pings(self) -> None:
        self.gateway.session.logged_in = False
        self.live.watch("a", [1], True)
        frames = iter([
            '{"id":1,"connect":{"client":"fixture","ping":25,"pong":true}}',
            '{"id":2,"subscribe":{"offset":5}}\n{"push":{"channel":"lot:1","pub":{"data":{"id":1,"version":6,"current_price":25}}}}',
            "{}",
        ])
        socket = Mock()

        def receive() -> str:
            frame = next(frames, None)
            if frame is None:
                self.live.watch("a", [], False)
                return "{}"
            return frame

        socket.recv.side_effect = receive
        with patch("tlx_server.live.websocket.create_connection", return_value=socket):
            self.live._connect()
        sent = [json.loads(call.args[0]) for call in socket.send.call_args_list]
        self.assertIn({"id": 1, "connect": {}}, sent)
        self.assertIn({"id": 2, "subscribe": {"channel": "lot:1"}}, sent)
        self.assertIn({}, sent)
        self.assertEqual(self.store.lot(1)["currentPrice"], 25)
        self.assertEqual(self.live._catchups.get_nowait(), 1)
        socket.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
