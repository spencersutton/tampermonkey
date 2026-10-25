"""The server's own login to triangleliquidators.com.

The site uses next-auth: signing in with email and password sets an HttpOnly
session cookie, and every call to /api/auth/session re-issues a readable
`token` cookie, the bearer token its JSON API takes. The browser version
leaves all that to the site's own page; here the server signs in itself
(your password is used once and never stored), keeps the cookies in SQLite,
and refreshes the token shortly before it expires or after the API rejects it.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.cookies import CookieError, SimpleCookie
from typing import Any

from .site import SITE, TIMEOUT, USER_AGENT, token_expiry
from .store import Store

log = logging.getLogger(__name__)

EXPIRY_MARGIN = 120  # seconds; refresh the token this long before it expires
REFRESH_MIN_GAP = 30  # seconds between forced refreshes (after a 401)
COOKIES_KEY = "siteCookies"
USER_KEY = "siteUser"

LOGIN_ERRORS = {
    "CredentialsSignin": "Wrong email or password.",
    "user_blocked": "Your account is blocked. Contact Triangle Liquidators support.",
    "email_not_verified": "Your email address isn’t verified yet. Finish signing up on the site first.",
}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:  # noqa: PLR6301
        return None


_opener = urllib.request.build_opener(_NoRedirect)


class SiteSession:
    def __init__(self, store: Store) -> None:
        self.store = store
        self._lock = threading.RLock()
        self._cookies: dict[str, str] = store.get_meta(COOKIES_KEY, {})
        self.user: dict[str, Any] | None = store.get_meta(USER_KEY, None)
        self._last_refresh = 0.0

    # -- cookies --------------------------------------------------------------
    def _save(self) -> None:
        self.store.set_meta(COOKIES_KEY, self._cookies)
        self.store.set_meta(USER_KEY, self.user)

    def _take_cookies(self, headers: Any) -> None:
        for raw in headers.get_all("Set-Cookie") or []:
            jar = SimpleCookie()
            try:
                jar.load(raw)
            except CookieError as e:
                log.debug("ignoring malformed Set-Cookie header: %s", e)
                continue
            for name, morsel in jar.items():
                gone = morsel["max-age"] == "0" or not morsel.value or "1970" in (morsel["expires"] or "")
                if gone:
                    self._cookies.pop(name, None)
                else:
                    self._cookies[name] = morsel.value

    def _request(self, method: str, path: str, form: dict[str, str] | None = None) -> tuple[int, Any]:
        """Call one of the site's next-auth endpoints with our cookies; returns (status, parsed JSON or None)."""
        headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
        if self._cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self._cookies.items())
        data = None
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(f"{SITE}{path}", data=data, headers=headers, method=method)
        try:
            res = _opener.open(req, timeout=TIMEOUT)
        except urllib.error.HTTPError as e:
            res = e  # redirects (with redirects off) and errors still carry cookies and a body
        with res:
            self._take_cookies(res.headers)
            body = res.read()
            try:
                return res.status, json.loads(body) if body else None
            except ValueError:
                return res.status, None

    # -- state ----------------------------------------------------------------
    @property
    def logged_in(self) -> bool:
        return self.user is not None and "token" in self._cookies

    def status(self) -> dict[str, Any]:
        u = self.user or {}
        return {"loggedIn": self.logged_in, "email": u.get("email"), "name": u.get("name")}

    def token(self) -> str | None:
        """The API bearer token, refreshed first if it's about to expire; None when logged out."""
        with self._lock:
            if not self.logged_in:
                return None
            exp = token_expiry(self._cookies.get("token"))
            if exp is not None and exp - EXPIRY_MARGIN < time.time():
                self.refresh()
            return self._cookies.get("token") if self.logged_in else None

    def refresh(self, force: bool = False) -> bool:
        """Ask next-auth for the session, which re-issues the token cookie. Returns whether we're logged in."""
        with self._lock:
            if not self.user:
                return False
            if force and time.time() - self._last_refresh < REFRESH_MIN_GAP:
                return self.logged_in
            self._last_refresh = time.time()
            try:
                status, s = self._request("GET", "/api/auth/session")
            except (urllib.error.URLError, OSError) as e:
                log.warning("session refresh failed: %s", e)  # offline: keep the current state
                return self.logged_in
            if status >= 500:
                return self.logged_in
            # Logged out is `{}`; a session whose refresh failed carries `error`.
            if not isinstance(s, dict) or not s or s.get("error"):
                log.info("site session ended")
                self._cookies.clear()
                self.user = None
            elif isinstance(s.get("user"), dict):
                self.user = {"email": s["user"].get("email"), "name": s["user"].get("name")}
            self._save()
            return self.logged_in

    def rejected(self, token: str) -> str | None:
        """The API rejected `token`: refresh once and return the new token, if any."""
        with self._lock:
            if self._cookies.get("token") != token:
                return self._cookies.get("token") if self.logged_in else None
            self.refresh(force=True)
            new = self._cookies.get("token")
            return new if self.logged_in and new != token else None

    # -- log in / out -----------------------------------------------------------
    def login(self, email: str, password: str) -> str | None:
        """Sign in like the site's login form; returns an error message, or None on success."""
        with self._lock:
            self._cookies.clear()
            self.user = None
            try:
                _, csrf = self._request("GET", "/api/auth/csrf")
                if not isinstance(csrf, dict) or not csrf.get("csrfToken"):
                    return "The site didn’t start a login (no CSRF token)."
                form = {"email": email, "password": password, "csrfToken": csrf["csrfToken"], "callbackUrl": SITE, "json": "true"}
                status, d = self._request("POST", "/api/auth/callback/credentials", form)
            except (urllib.error.URLError, OSError) as e:
                return f"Couldn’t reach the site: {e}"
            url = d.get("url", "") if isinstance(d, dict) else ""
            err = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("error", [None])[0]
            if err or status >= 400:
                self._cookies.clear()
                self._save()
                return LOGIN_ERRORS.get(err or "", f"Login failed ({err or status}).")
            self.user = {"email": email, "name": None}
            if not self.refresh() or "token" not in self._cookies:
                self._cookies.clear()
                self.user = None
                self._save()
                return "Logged in, but the site didn’t hand out an API token."
            log.info("logged in to the site as %s", email)
            return None

    def logout(self) -> None:
        with self._lock:
            try:
                _, csrf = self._request("GET", "/api/auth/csrf")
                if isinstance(csrf, dict) and csrf.get("csrfToken"):
                    self._request("POST", "/api/auth/signout", {"csrfToken": csrf["csrfToken"], "callbackUrl": SITE, "json": "true"})
            except (urllib.error.URLError, OSError):
                pass  # forget the session locally either way
            self._cookies.clear()
            self.user = None
            self._save()
