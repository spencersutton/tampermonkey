"""The server's own login to triangleliquidators.com.

The site uses next-auth: signing in with email and password sets an HttpOnly
session cookie, and every call to /api/auth/session re-issues a readable
`token` cookie, the bearer token its JSON API takes. The browser version
leaves all that to the site's own page; here the server signs in itself
(your password is used once and never stored), keeps the cookies in SQLite,
and refreshes the token shortly before it expires or after the API rejects it.
"""

from __future__ import annotations

import logging
import threading
import time
import urllib.parse
from typing import Any

import httpx

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
SITE_HOST = urllib.parse.urlsplit(SITE).hostname or ""


class SiteSession:
    def __init__(self, store: Store, transport: httpx.BaseTransport | None = None) -> None:
        self.store = store
        self._lock = threading.RLock()
        # Its own client, so the session's cookie jar (expiry, deletion, domain and path rules) stays apart
        # from the shared API client. Redirects stay off: next-auth answers with them, and we read the reply.
        self._http = httpx.Client(
            base_url=SITE, headers={"Accept": "application/json", "User-Agent": USER_AGENT}, timeout=TIMEOUT, transport=transport
        )
        self._load_cookies(store.get_meta(COOKIES_KEY))
        user = store.get_meta(USER_KEY)
        self.user: dict[str, Any] | None = user if isinstance(user, dict) else None
        self._last_refresh = 0.0

    # -- cookies --------------------------------------------------------------
    def _load_cookies(self, saved: object) -> None:
        """Restore cookies saved by _save, or the older {name: value} form (taken as host cookies for the site)."""
        if isinstance(saved, dict):
            saved = [{"name": k, "value": v, "domain": SITE_HOST, "path": "/"} for k, v in saved.items()]
        for c in saved if isinstance(saved, list) else []:
            if isinstance(c, dict) and all(isinstance(c.get(k), str) for k in ("name", "value", "domain", "path")):
                self._http.cookies.set(c["name"], c["value"], domain=c["domain"], path=c["path"])

    def _save(self) -> None:
        cookies = [{"name": c.name, "value": c.value, "domain": c.domain, "path": c.path} for c in self._http.cookies.jar]
        self.store.set_meta(COOKIES_KEY, cookies)
        self.store.set_meta(USER_KEY, self.user)

    def _cookie(self, name: str) -> str | None:
        return next((c.value for c in self._http.cookies.jar if c.name == name and c.value), None)

    def _request(self, method: str, path: str, form: dict[str, str] | None = None) -> tuple[int, object]:
        """Call one of the site's next-auth endpoints with our cookies; returns (status, parsed JSON or None)."""
        res = self._http.request(method, path, data=form)
        try:
            return res.status_code, res.json() if res.content else None
        except ValueError:
            return res.status_code, None

    # -- state ----------------------------------------------------------------
    @property
    def logged_in(self) -> bool:
        return self.user is not None and self._cookie("token") is not None

    def status(self) -> dict[str, Any]:
        u = self.user or {}
        return {"loggedIn": self.logged_in, "email": u.get("email"), "name": u.get("name")}

    def token(self) -> str | None:
        """The API bearer token, refreshed first if it's about to expire; None when logged out."""
        with self._lock:
            if not self.logged_in:
                return None
            exp = token_expiry(self._cookie("token"))
            if exp is not None and exp - EXPIRY_MARGIN < time.time():
                self.refresh()
            return self._cookie("token") if self.logged_in else None

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
            except httpx.HTTPError as e:
                log.warning("session refresh failed: %s", e)  # offline: keep the current state
                return self.logged_in
            if status >= 500:
                return self.logged_in
            # Logged out is `{}`; a session whose refresh failed carries `error`.
            if not isinstance(s, dict) or not s or s.get("error"):
                log.info("site session ended")
                self._http.cookies.clear()
                self.user = None
            elif isinstance(s.get("user"), dict):
                self.user = {"email": s["user"].get("email"), "name": s["user"].get("name")}
            self._save()
            return self.logged_in

    def rejected(self, token: str) -> str | None:
        """The API rejected `token`: refresh once and return the new token, if any."""
        with self._lock:
            if self._cookie("token") != token:
                return self._cookie("token") if self.logged_in else None
            self.refresh(force=True)
            new = self._cookie("token")
            return new if self.logged_in and new != token else None

    # -- log in / out -----------------------------------------------------------
    def login(self, email: str, password: str) -> str | None:
        """Sign in like the site's login form; returns an error message, or None on success."""
        with self._lock:
            self._http.cookies.clear()
            self.user = None
            try:
                _, csrf = self._request("GET", "/api/auth/csrf")
                if not isinstance(csrf, dict) or not csrf.get("csrfToken"):
                    return "The site didn’t start a login (no CSRF token)."
                form = {"email": email, "password": password, "csrfToken": csrf["csrfToken"], "callbackUrl": SITE, "json": "true"}
                status, d = self._request("POST", "/api/auth/callback/credentials", form)
            except httpx.HTTPError as e:
                return f"Couldn’t reach the site: {e}"
            url = d.get("url", "") if isinstance(d, dict) else ""
            err = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get("error", [None])[0]
            if err or status >= 400:
                self._http.cookies.clear()
                self._save()
                return LOGIN_ERRORS.get(err or "", f"Login failed ({err or status}).")
            self.user = {"email": email, "name": None}
            if not self.refresh() or self._cookie("token") is None:
                self._http.cookies.clear()
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
            except httpx.HTTPError:
                pass  # forget the session locally either way
            self._http.cookies.clear()
            self.user = None
            self._save()
