import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

from tlx_server.catalog import Catalog
from tlx_server.history import History
from tlx_server.server import Api, make_handler
from tlx_server.session import SiteSession
from tlx_server.site import ApiError, normalize_lot, now_ms
from tlx_server.store import Store


def raw_lot(lot_id: int = 1, title: str = "Drill") -> dict:
    return {
        "id": lot_id,
        "auction_period": "test",
        "title": title,
        "lot_number": str(lot_id),
        "category": {"value": "tools", "label": "Tools"},
        "condition": {"value": 1, "display_name": "Like New"},
        "location": {"id": 1, "name": "Raleigh"},
        "is_transferable": True,
        "transfer_fee": 5,
        "current_price": 10,
        "estimated_retail_price": 100,
        "ends_at": "2099-01-01T00:00:00Z",
        "status": "live",
        "version": 1,
        "bid_count": 1,
        "next_min_increment": 11,
        "your_standing": None,
        "is_watchlisted": False,
        "has_bid": False,
        "images": [],
        "description": "Useful drill",
        "brand": "Fixture",
        "model": None,
        "bid_history": [],
        "similar": [],
    }


class UITests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name) / "test.db")
        self.session = SiteSession(self.store)
        self.catalog = Catalog(self.store, self.session, History(self.store))
        self.api = Api(self.store, self.catalog, self.session, None, set(), False)
        self.ui = self.api.ui
        self.store.replace_all([normalize_lot(raw_lot())], fetchedAt=now_ms(), count=1)
        self.request = patch.object(self.api.gateway, "request", side_effect=self.site_reply).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.store._db.close)

    @staticmethod
    def site_reply(path: str, *args: object, **kwargs: object) -> dict:
        if "filter-config" in path:
            return {"conditions": [{"value": 1, "label": "Like New", "description": "Open box"}]}
        if path == "/v1/auth/me/":
            return {"pickup_location": {"id": 1, "name": "Raleigh"}}
        if "closed/" in path:
            return {
                "count": 1,
                "results": [
                    {
                        "lot_id": 12,
                        "auction_period": "test",
                        "title": "Drill",
                        "lot_number": "12",
                        "location_name": "Raleigh",
                        "final_price": 7,
                        "hero_image": None,
                    }
                ],
            }
        if path.endswith("/bids"):
            return {"is_leading": True, "current_price": 11, "min_next_bid": 12, "version": 2}
        if "/auctions/lots/test/" in path:
            return raw_lot(int(path.rstrip("/").rsplit("/", 1)[1]))
        if "watchlist" in path:
            return {}
        raise AssertionError(f"Unexpected site request: {path}")

    def context(self, query: str = "", browser: dict | None = None) -> dict:
        context = self.ui.context(parse_qs(query), browser if browser is not None else {})
        return {**context, "oob": False, "message": "", "locked": False}

    def test_title_line_setting_selects_the_unlimited_layout_only_for_zero(self) -> None:
        for lines in (0, 2, 6):
            with self.subTest(lines=lines):
                html = self.ui.render("results.html", self.context(browser={"tlxTitleLines": lines}))
                self.assertEqual('class="grid full-titles"' in html, lines == 0)
                self.assertIn(f"--title-lines:{lines}", html)

    def test_search_toggle_and_card_badges_have_their_layout_containers(self) -> None:
        lot = normalize_lot(raw_lot())
        lot["firstSeenAt"] = 100
        self.store.replace_all([lot])
        html = self.ui.render("app.html", self.context("newSince=0"))
        self.assertIn('class="regex-toggle"', html)
        self.assertIn('aria-label="Use regex search"', html)
        self.assertIn('class="card-badges"', html)
        self.assertIn('class="pill pill-new">New</span>', html)

    def login(self) -> None:
        self.session.user = {"name": "Fixture"}
        self.session._cookies["token"] = "fixture-only"

    def http(self) -> HTTPConnection:
        handler = make_handler(self.api)
        patch.object(handler, "_assets", return_value={"script": "fixture.js", "styles": []}).start()
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        def cleanup() -> None:
            self.api.stopped.set()
            server.shutdown()
            server.server_close()
            thread.join()

        self.addCleanup(cleanup)
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        self.addCleanup(connection.close)
        return connection

    def test_catalog_templates_render_and_escape_untrusted_text(self) -> None:
        self.store.replace_all([normalize_lot(raw_lot(title="<script>alert(1)</script>"))])
        html = self.ui.render("app.html", self.context())
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertNotIn("<script>alert", html)
        self.assertIn('name="category"', html)
        self.assertIn('data-ends="4070908800000"', html)
        self.assertNotIn("Temporal", html)

    def test_details_and_all_editor_templates_render(self) -> None:
        self.store.save_item_types({"Drill": ("drill", "tools")}, manual=True)
        for query in (
            "lot=1",
            "dialog=login",
            "dialog=conditions",
            "dialog=categories",
            "dialog=item-type&id=1",
            "dialog=type-category&id=1",
        ):
            with self.subTest(query=query):
                self.assertIn("<dialog", self.ui.render("app.html", self.context(query)))

    def test_account_pickup_resolves_ids_and_refreshes_daily(self) -> None:
        self.login()
        browser = {"accountPickup": {"id": 1, "name": None}, "accountPickupAt": now_ms()}
        self.assertEqual(self.context("", browser)["pickup"], "Raleigh")
        self.assertFalse(any(call.args[0] == "/v1/auth/me/" for call in self.request.call_args_list))
        browser["accountPickupAt"] = 0
        self.context("", browser)
        self.assertTrue(any(call.args[0] == "/v1/auth/me/" for call in self.request.call_args_list))

    def test_bid_requires_single_use_confirmation_and_revalidates_current_price(self) -> None:
        self.login()
        data = {"return": ["/tlx?sort=ending-soonest"], "id": ["1"], "amount": ["11"]}
        context = self.ui.bid_preview(data, {}, "browser")
        self.assertNotIn("/bids", " ".join(str(call) for call in self.request.call_args_list))
        self.assertIn("Place $11.00 bid", self.ui.render("app.html", {**context, "oob": False, "message": ""}))
        self.store.merge_lot(1, {"version": 2, "currentPrice": 15, "nextMinIncrement": 16})
        with self.assertRaisesRegex(ValueError, "price moved"):
            self.ui.submit_bid({"nonce": [context["nonce"]]}, "browser", context)
        with self.assertRaisesRegex(ValueError, "already submitted"):
            self.ui.submit_bid({"nonce": [context["nonce"]]}, "browser", context)
        data["amount"] = ["20"]
        context = self.ui.bid_preview(data, {}, "browser")
        self.ui.submit_bid({"nonce": [context["nonce"]]}, "browser", context)
        self.assertEqual(self.store.lot(1)["yourStanding"]["yourMaxBid"], 20)
        self.assertEqual(sum(call.args[0].endswith("/bids") for call in self.request.call_args_list), 1)

    def test_failed_or_uncertain_bids_are_never_retried_with_same_confirmation(self) -> None:
        self.login()
        context = self.ui.bid_preview({"return": ["/tlx"], "id": ["1"]}, {}, "browser")
        self.request.side_effect = ApiError("Network error; check the lot", 0)
        with self.assertRaises(ApiError):
            self.ui.submit_bid({"nonce": [context["nonce"]]}, "browser", context)
        with self.assertRaises(ValueError):
            self.ui.submit_bid({"nonce": [context["nonce"]]}, "browser", context)

    def test_hidden_and_filtered_lots_cannot_be_bid_on(self) -> None:
        self.login()
        self.store.put_setting("hiddenLots", {"1": {"title": "Drill"}})
        with self.assertRaisesRegex(ValueError, "hidden"):
            self.ui.bid_preview({"return": ["/tlx"], "id": ["1"]}, {}, "browser")
        self.store.put_setting("hiddenLots", {})
        self.store.put_setting("filterWords", ["drill"])
        with self.assertRaisesRegex(ValueError, "filtered"):
            self.ui.bid_preview({"return": ["/tlx"], "id": ["1"]}, {}, "browser")

    def test_category_rename_updates_default_saved_and_browser_filters(self) -> None:
        self.store.put_setting("tlxCustomCategories", [{"name": "Old", "types": ["drill"]}])
        self.store.put_setting("tlxDefaultFilters", {"categories": ["custom:Old"], "conditions": [1]})
        self.store.put_setting(
            "tlxSavedSearches", [{"id": "one", "name": "Mine", "view": {"categories": ["custom:Old"]}, "lastViewedAt": 5}]
        )
        browser = {"tlxView": {"categories": ["custom:Old"]}, "tlxLastCategory": "Old"}
        self.ui.save_categories([{"name": "New", "types": ["drill"]}], {"Old": "New"}, browser)
        self.assertEqual(browser["tlxView"]["categories"], ["custom:New"])
        self.assertEqual(self.store.setting("tlxDefaultFilters")["categories"], ["custom:New"])
        self.assertEqual(self.store.setting("tlxSavedSearches")[0]["view"]["categories"], ["custom:New"])
        self.assertEqual(browser["tlxLastCategory"], "New")

    def test_saved_search_visits_keep_numeric_timestamps_and_previous_highlight(self) -> None:
        self.store.put_setting("tlxSavedSearches", [{"id": "one", "name": "Drills", "view": {"search": "drill"}, "lastViewedAt": 123}])
        browser = {}
        url, _ = self.ui.action("search-open", {"return": ["/tlx"], "id": ["one"], "newOnly": ["1"]}, browser, "browser")
        self.assertEqual(browser["highlight"], {"id": "one", "since": 123})
        self.assertEqual(parse_qs(urlsplit(url).query)["newSince"], ["123"])
        self.assertIsInstance(self.store.setting("tlxSavedSearches")[0]["lastViewedAt"], int)

    def test_shared_lot_urls_override_saved_filters_but_closed_only_urls_keep_them(self) -> None:
        browser = {"tlxView": {"search": "saw"}}
        self.assertEqual(self.context("lot=1", browser)["view"]["search"], "")
        browser["tlxView"] = {"search": "saw"}
        self.assertEqual(self.context("closed=won", browser)["view"]["search"], "saw")
        self.store.put_setting("tlxDefaultFilters", {"categories": ["tools"], "conditions": [1]})
        self.assertEqual(self.context("", {"tlxView": {}})["view"]["categories"], [])

    def test_closed_lots_render_relistings_and_totals(self) -> None:
        self.login()
        context = self.context("closed=won")
        self.assertEqual(len(context["closed_rows"][0]["relisted"]), 1)
        self.assertIn("listings", self.ui.render("app.html", context).replace("listing", "listings"))

    def test_similar_lots_outside_the_catalog_link_to_the_site(self) -> None:
        detail = raw_lot()
        detail["similar"] = [raw_lot(2, "Other drill")]
        self.request.side_effect = lambda path: detail if "/auctions/lots/test/" in path else self.site_reply(path)
        html = self.ui.render("app.html", self.context("lot=1"))
        self.assertIn('href="https://triangleliquidators.com/lots/test/2" target="_blank" rel="noopener" hx-boost="false"', html)

    def test_live_fragments_do_not_replace_forms_or_dialog_drafts(self) -> None:
        html = self.ui.render("live.html", self.context("lot=1"))
        self.assertIn('id="results"', html)
        self.assertIn('id="lot-live"', html)
        self.assertNotIn('id="max-bid-amount"', html)
        self.assertNotIn('id="filters"', html)

    def test_sse_reconnect_sends_current_snapshot_and_lock_ends_stream(self) -> None:
        self.api.password = "fixture"
        self.store.add_session("test-session")
        connection = self.http()
        connection.request("GET", "/events", headers={"Cookie": "tlx_session=test-session", "Last-Event-ID": "obsolete"})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader("Content-Type"), "text/event-stream")
        self.assertTrue(response.readline().startswith(b"id: "))
        self.assertEqual(response.readline(), b"event: refresh\n")
        self.assertEqual(response.readline(), b"data: {}\n")
        response.readline()
        self.store.drop_session("test-session")
        self.assertEqual(response.readline(), b"event: locked\n")
        self.assertEqual(response.readline(), b"data: {}\n")
        response.close()

    def test_browser_import_preserves_server_settings_and_restores_local_view(self) -> None:
        self.store.put_setting("tlxPickup", "Raleigh")
        connection = self.http()
        connection.request(
            "POST",
            "/api/import",
            json.dumps({
                "timezone": "America/New_York",
                "shared": False,
                "values": {"tlxPickup": "Durham", "tlxView": {"search": "saw"}, "tlxTitleLines": 0},
            }),
            {"X-TLX-Client": "1", "Content-Type": "application/json"},
        )
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        cookie = response.getheader("Set-Cookie").split(";")[0]
        response.read()
        self.assertEqual(self.store.setting("tlxPickup"), "Raleigh")
        connection.request("GET", "/tlx", headers={"Cookie": cookie, "HX-Request": "true"})
        response = connection.getresponse()
        self.assertIn(b'value="saw"', response.read())
        self.assertEqual(response.status, 200)

    def test_search_typing_pushes_once_then_replaces_despite_form_page_defaults(self) -> None:
        connection = self.http()
        connection.request("GET", "/tlx")
        response = connection.getresponse()
        cookie = response.getheader("Set-Cookie").split(";")[0]
        response.read()

        headers = {"Cookie": cookie, "HX-Request": "true", "HX-Current-URL": "http://localhost/tlx?sort=ending-soonest&page=1"}
        connection.request("GET", "/tlx?sort=ending-soonest&search=dr", headers=headers)
        response = connection.getresponse()
        first_url = response.getheader("HX-Push-Url")
        self.assertIsNotNone(first_url)
        response.read()
        headers["HX-Current-URL"] = "http://localhost" + first_url
        connection.request("GET", "/tlx?sort=ending-soonest&search=drill", headers=headers)
        response = connection.getresponse()
        self.assertIn("search=drill", response.getheader("HX-Replace-Url"))
        response.read()

    def test_history_restore_is_not_a_new_visit(self) -> None:
        self.store.put_setting("tlxLastVisit", 123)
        connection = self.http()
        connection.request("GET", "/tlx?sort=ending-soonest", headers={"HX-Request": "true", "HX-History-Restore-Request": "true"})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertIn(b"<!doctype html>", response.read())
        self.assertEqual(self.store.setting("tlxLastVisit"), 123)

    def test_inflight_live_refresh_cannot_overwrite_a_newer_saved_view(self) -> None:
        browser_id = "a" * 32
        self.store.save_browser(browser_id, {"tlxView": {"search": "newer"}})
        connection = self.http()
        connection.request(
            "GET",
            "/tlx?sort=ending-soonest&search=older",
            headers={"Cookie": f"tlx_browser={browser_id}", "HX-Request": "true", "X-TLX-Live": "1"},
        )
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        response.read()
        self.assertEqual(self.store.browser(browser_id)["tlxView"]["search"], "newer")

    def test_clear_and_saved_searches_create_history_entries(self) -> None:
        self.store.put_setting("tlxSavedSearches", [{"id": "one", "name": "Drills", "view": {"search": "drill"}, "lastViewedAt": 0}])
        connection = self.http()
        for action in ("clear", "search-open"):
            connection.request(
                "POST",
                f"/ui/{action}",
                urlencode({"return": "/tlx?sort=ending-soonest&search=older", "id": "one"}),
                {"X-TLX-Client": "1", "HX-Request": "true", "Content-Type": "application/x-www-form-urlencoded"},
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIsNotNone(response.getheader("HX-Push-Url"))
            response.read()

    def test_http_guard_and_authenticated_html(self) -> None:
        handler = make_handler(self.api)
        with patch.object(handler, "_assets", return_value={"script": "fixture.js", "styles": []}):
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            server.daemon_threads = True
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                conn = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                conn.request("GET", "/tlx")
                response = conn.getresponse()
                self.assertEqual(response.status, 200)
                self.assertIn(b"TL Catalog", response.read())
                conn.request("POST", "/ui/clear", urlencode({"return": "/tlx"}))
                response = conn.getresponse()
                self.assertEqual(response.status, 403)
                response.read()
                self.api.password = "fixture"
                conn.request("GET", "/tlx")
                response = conn.getresponse()
                body = response.read()
                self.assertEqual(response.status, 200)
                self.assertIn(b"Unlock", body)
                self.assertNotIn(b"Drill", body)
                conn.request("GET", "/events")
                response = conn.getresponse()
                self.assertEqual(response.status, 401)
                response.read()
                conn.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == "__main__":
    unittest.main()
