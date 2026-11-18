import base64
import json
import threading
import time
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock
from urllib.parse import parse_qs

import httpx

from tlx_server.server import Api, make_handler
from tlx_server.session import COOKIES_KEY, USER_KEY, SiteSession
from tlx_server.store import Store


def jwt(exp: float) -> str:
    """An unsigned JWT whose payload carries `exp` (the session only reads the expiry)."""
    payload = base64.urlsafe_b64encode(json.dumps({"exp": exp}).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


class FakeSite:
    """next-auth's endpoints, as far as SiteSession uses them."""

    def __init__(self) -> None:
        self.token = jwt(time.time() + 3600)
        self.session_cookie: str | None = None
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        cookies = dict(c.split("=", 1) for c in request.headers.get("cookie", "").split("; ") if c)
        match request.url.path:
            case "/api/auth/csrf":
                return httpx.Response(200, json={"csrfToken": "csrf-1"}, headers={"Set-Cookie": "csrf=csrf-1; Path=/api/auth"})
            case "/api/auth/callback/credentials":
                form = parse_qs(request.content.decode())
                if cookies.get("csrf") != "csrf-1" or form["csrfToken"] != ["csrf-1"]:
                    return httpx.Response(403)
                if form["password"] != ["right"]:
                    return httpx.Response(401, json={"url": "https://triangleliquidators.com/login?error=CredentialsSignin"})
                self.session_cookie = "session-1"
                return httpx.Response(
                    200, json={"url": "https://triangleliquidators.com/"}, headers={"Set-Cookie": "session=session-1; Path=/; HttpOnly"}
                )
            case "/api/auth/session":
                if not self.session_cookie or cookies.get("session") != self.session_cookie:
                    return httpx.Response(200, json={})
                return httpx.Response(
                    200,
                    json={"user": {"email": "user@example.test", "name": "Test User"}},
                    headers={"Set-Cookie": f"token={self.token}; Path=/"},
                )
            case "/api/auth/signout":
                self.session_cookie = None
                return httpx.Response(
                    200,
                    json={"url": "https://triangleliquidators.com/"},
                    headers=[("Set-Cookie", "session=; Path=/; Max-Age=0"), ("Set-Cookie", "token=; Path=/; Max-Age=0")],
                )
        return httpx.Response(404)


class SiteSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = TemporaryDirectory()
        self.path = Path(self.tmp.name) / "tlx.db"
        self.store = Store(self.path)
        self.site = FakeSite()

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def session(self) -> SiteSession:
        return SiteSession(self.store, transport=httpx.MockTransport(self.site))

    def test_login_keeps_cookies_across_restarts_and_logout_clears_them(self) -> None:
        s = self.session()
        self.assertIsNone(s.login("user@example.test", "right"))
        self.assertEqual(s.status(), {"loggedIn": True, "email": "user@example.test", "name": "Test User"})
        self.assertEqual(s.token(), self.site.token)

        restarted = SiteSession(Store(self.path), transport=httpx.MockTransport(self.site))
        self.assertTrue(restarted.logged_in)
        self.assertEqual(restarted.token(), self.site.token)

        restarted.logout()
        self.assertFalse(restarted.logged_in)
        saved = self.store.get_meta(COOKIES_KEY)
        assert isinstance(saved, list)
        self.assertEqual(saved, [])
        self.assertEqual(self.site.requests[-1].url.path, "/api/auth/signout")

    def test_wrong_password_is_reported_and_leaves_no_session(self) -> None:
        s = self.session()
        self.assertEqual(s.login("user@example.test", "wrong"), "Wrong email or password.")
        self.assertFalse(s.logged_in)

    def test_an_expiring_token_is_refreshed_before_use(self) -> None:
        s = self.session()
        s.login("user@example.test", "right")
        self.site.token = jwt(time.time() + 3600)
        old = s.token()
        self.assertNotEqual(old, self.site.token)  # not yet near expiry: no refresh
        s._http.cookies.set("token", jwt(time.time() + 10), domain="triangleliquidators.com", path="/")
        self.assertEqual(s.token(), self.site.token)

    def test_cookies_saved_in_the_older_name_value_form_still_load(self) -> None:
        self.site.session_cookie = "session-1"
        self.store.set_meta(COOKIES_KEY, {"session": "session-1", "token": self.site.token})
        self.store.set_meta(USER_KEY, {"email": "user@example.test", "name": None})
        s = self.session()
        self.assertTrue(s.logged_in)
        self.assertTrue(s.refresh())
        self.assertIn("session=session-1", self.site.requests[-1].headers["cookie"])

    def test_a_session_the_site_ended_logs_out(self) -> None:
        s = self.session()
        s.login("user@example.test", "right")
        self.site.session_cookie = None
        self.assertFalse(s.refresh())
        self.assertFalse(s.logged_in)
        self.assertEqual(self.store.get_meta(COOKIES_KEY), [])

    def test_a_shared_login_follows_the_database_and_never_contacts_the_site(self) -> None:
        def refuse(request: httpx.Request) -> httpx.Response:
            raise AssertionError(f"a shared login contacted the site: {request.url}")

        follower = SiteSession(self.store, transport=httpx.MockTransport(refuse), shared=True)
        self.assertIsNone(follower.token())
        front = self.session()
        front.login("user@example.test", "right")
        self.assertEqual(follower.token(), self.site.token, "a login saved after startup is picked up")
        old = self.site.token
        self.assertIsNone(follower.rejected(old), "no newer token to retry with")
        self.site.token = jwt(time.time() + 7200)
        front.refresh()
        self.assertEqual(follower.rejected(old), self.site.token)
        follower._http.cookies.set("token", jwt(time.time() + 10), domain="triangleliquidators.com", path="/")
        self.assertEqual(follower.token(), self.site.token, "an expiring token is the front server's to refresh")
        self.assertEqual(follower.login("user@example.test", "right"), "Log in through the front server.")
        follower.logout()
        self.assertEqual(follower.token(), self.site.token, "logging out is the front server's too")
        front.logout()
        self.assertIsNone(follower.token())
        self.assertFalse(follower.refresh())


class BackendKeyTest(unittest.TestCase):
    def test_behind_the_front_server_every_request_needs_its_key(self) -> None:
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        store = Store(Path(tmp.name) / "tlx.db")
        api = Api(store, Mock(), Mock(), None, set(), False, backend_key="secret")
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(api))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)

        def status(headers: dict[str, str]) -> int:
            conn = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
            try:
                conn.request("GET", "/api/health", headers=headers)
                return conn.getresponse().status
            finally:
                conn.close()

        self.assertEqual(status({}), 403)
        self.assertEqual(status({"X-TLX-Backend-Key": "wrong"}), 403)
        self.assertEqual(status({"X-TLX-Backend-Key": "secret"}), 200)


if __name__ == "__main__":
    unittest.main()
