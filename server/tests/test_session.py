import base64
import json
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs

import httpx

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


if __name__ == "__main__":
    unittest.main()
