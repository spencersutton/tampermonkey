import unittest
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock, patch

from tlx_server.catalog import Catalog


class FirstSeenTests(unittest.TestCase):
    def pull(self, previous: dict[int, dict[str, Any]], lots: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
        store = Mock()
        store.all_lots.return_value = previous
        store.item_types.return_value = {}
        store.replace_all.return_value = 1
        session = Mock()
        session.token.return_value = None
        history = Mock()
        catalog = Catalog(store, session, history)
        page = SimpleNamespace(count=len(lots), results=lots)
        with patch("tlx_server.catalog.now_ms", return_value=12345), patch("tlx_server.catalog.fetch_lot_page", return_value=page):
            catalog.pull()
        return {lot["id"]: lot for lot in store.replace_all.call_args.args[0]}

    def test_first_pull_does_not_mark_lots_as_new(self) -> None:
        pulled = self.pull({}, [{"id": 1, "title": "Drill"}])
        self.assertEqual(pulled[1]["firstSeenAt"], 0)

    def test_later_pull_preserves_existing_timestamps_and_marks_new_lots(self) -> None:
        previous = {1: {"id": 1, "firstSeenAt": 99, "hasBid": True}, 2: {"id": 2, "firstSeenAt": None}, 3: {"id": 3}, 4: {}}
        lots = [{"id": i, "title": f"Lot {i}"} for i in range(1, 6)]
        pulled = self.pull(previous, lots)
        self.assertEqual([pulled[i]["firstSeenAt"] for i in range(1, 6)], [99, 0, 0, 12345, 12345])
        self.assertTrue(pulled[1]["hasBid"])


if __name__ == "__main__":
    unittest.main()
