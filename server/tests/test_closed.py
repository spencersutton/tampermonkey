import http.client
import json
import threading
import unittest
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from typing import Any
from unittest.mock import MagicMock, patch

from tlx_server.catalog import Catalog
from tlx_server.closed import closed_pages, normalize_closed
from tlx_server.server import Api, make_handler
from tlx_server.session import SiteSession
from tlx_server.site import ApiError
from tlx_server.store import Store


class Session(SiteSession):
    def __init__(self) -> None:
        self.active = True
        self.email = "one@example.test"
        self.current_token = "old-token"

    @property
    def logged_in(self) -> bool:
        return self.active

    def status(self) -> dict[str, Any]:
        return {"email": self.email}

    def token(self) -> str | None:
        return self.current_token if self.logged_in else None

    def rejected(self, token: str) -> str:
        self.current_token = "new-token"
        return self.current_token


def row(id: int, **kwargs: object) -> dict[str, Any]:
    return {"id": id, "auction_period": "period", "title": f"Lot {id}", "final_price": "12.5", **kwargs}


class ClosedTests(unittest.TestCase):
    def test_normalization_and_fallbacks(self) -> None:
        self.assertEqual(
            normalize_closed(row(7, lot_number=0, location={"name": "Raleigh"}, closed_at="2025-01-02T03:04:05Z", hero_image="image.jpg")),
            {
                "lotId": 7,
                "auctionPeriod": "period",
                "title": "Lot 7",
                "lotNumber": "0",
                "locationName": "Raleigh",
                "finalPrice": 12.5,
                "heroImage": "image.jpg",
                "endsAt": 1735787045000,
            },
        )
        self.assertIsNone(normalize_closed(row(1, ends_at="not-a-date"))["endsAt"])

    def test_pagination_deduplicates_and_preserves_order(self) -> None:
        responses = [{"count": 3, "results": [row(1), row(2)]}, {"count": 3, "results": [row(2), row(3)]}]
        with patch("tlx_server.closed.get", side_effect=responses) as get:
            pages = list(closed_pages("lost", Session()))
        self.assertEqual([[lot["lotId"] for lot in p["lots"]] for p in pages], [[1, 2], [3]])
        self.assertEqual([p["done"] for p in pages], [False, True])
        self.assertEqual(get.call_args_list[0].args[0], "/v1/auctions/control-panel/closed/lost/")
        self.assertEqual(get.call_args_list[1].args[1]["page"], 2)

    def test_empty_page_stops_when_site_count_is_stale(self) -> None:
        with patch("tlx_server.closed.get", side_effect=[{"count": 3, "results": [row(1)]}, {"count": 3, "results": []}]):
            pages = list(closed_pages("won", Session()))
        self.assertTrue(pages[-1]["done"])

    def test_refreshes_rejected_token_once(self) -> None:
        with patch("tlx_server.closed.get", side_effect=[ApiError("expired", 401), {"count": 1, "results": [row(1)]}]) as get:
            pages = list(closed_pages("won", Session()))
        self.assertTrue(pages[0]["done"])
        self.assertEqual([call.args[2] for call in get.call_args_list], ["old-token", "new-token"])

    def test_login_change_stops_before_next_page(self) -> None:
        session = Session()
        with patch("tlx_server.closed.get", return_value={"count": 2, "results": [row(1)]}) as get:
            pages = closed_pages("won", session)
            next(pages)
            session.email = "two@example.test"
            with self.assertRaisesRegex(ApiError, "login changed"):
                next(pages)
        self.assertEqual(get.call_count, 1)

    def test_login_change_during_fetch_does_not_expose_the_page(self) -> None:
        session = Session()

        def fetch(_path: str, _params: dict[str, int], _token: str) -> dict[str, Any]:
            session.email = "two@example.test"
            return {"count": 1, "results": [row(1)]}

        with patch("tlx_server.closed.get", side_effect=fetch), self.assertRaisesRegex(ApiError, "login changed"):
            list(closed_pages("won", session))

    def test_invalid_upstream_data_is_an_error(self) -> None:
        with (
            patch("tlx_server.closed.get", return_value={"count": 1, "results": [row(1, final_price="NaN")]}),
            self.assertRaisesRegex(ApiError, "Invalid closed-lot response"),
        ):
            list(closed_pages("won", Session()))


class ClosedHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = Session()
        self.api = Api(MagicMock(spec=Store), MagicMock(spec=Catalog), self.session, None, set(), False)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.api))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)

    def tearDown(self) -> None:
        self.conn.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path: str = "/api/closed?section=won") -> http.client.HTTPResponse:
        self.conn.request("GET", path)
        return self.conn.getresponse()

    def test_streams_first_page_before_next_page_is_ready(self) -> None:
        release = threading.Event()
        second_started = threading.Event()

        def fetch(_path: str, params: dict[str, int], _token: str) -> dict[str, Any]:
            if params["page"] == 1:
                return {"count": 2, "results": [row(1)]}
            second_started.set()
            if not release.wait(3):
                raise ApiError("timed out", 0)
            return {"count": 2, "results": [row(2)]}

        with patch("tlx_server.closed.get", side_effect=fetch):
            try:
                response = self.request()
                self.assertEqual(response.status, 200)
                self.assertEqual(response.getheader("Transfer-Encoding"), "chunked")
                first = json.loads(response.readline())
                self.assertEqual(first["lots"][0]["lotId"], 1)
                self.assertFalse(first["done"])
                self.assertTrue(second_started.wait(2))
                release.set()
                second = json.loads(response.readline())
                self.assertEqual(second["lots"][0]["lotId"], 2)
                self.assertTrue(second["done"])
                self.assertEqual(response.read(), b"")
            finally:
                release.set()

    def test_stream_reports_upstream_failure_after_a_page(self) -> None:
        with patch("tlx_server.closed.get", side_effect=[{"count": 2, "results": [row(1)]}, ApiError("site unavailable", 503)]):
            response = self.request()
            records = [json.loads(line) for line in response.read().splitlines()]
        self.assertEqual(records[0]["lots"][0]["lotId"], 1)
        self.assertEqual(records[1], {"error": "site unavailable", "status": 503})

    def test_login_and_app_lock_are_enforced(self) -> None:
        self.session.active = False
        response = self.request()
        self.assertEqual(response.status, HTTPStatus.UNAUTHORIZED)
        response.read()
        self.conn.close()
        self.api.password = "configured"
        response = self.request()
        self.assertEqual(response.status, HTTPStatus.UNAUTHORIZED)
        response.read()

    def test_invalid_section_is_rejected(self) -> None:
        response = self.request("/api/closed?section=other")
        self.assertEqual(response.status, HTTPStatus.BAD_REQUEST)
        response.read()


if __name__ == "__main__":
    unittest.main()
