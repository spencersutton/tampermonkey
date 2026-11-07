"""Authenticated HTML pages, HTMX form actions, and server-sent invalidations.

  /tlx             full HTML or an HTMX fragment for the current URL
  /ui/...          validated form actions; every bid needs a one-use confirmation
  /events          authenticated SSE invalidations; reconnects fetch fresh HTML
  /backend/v1/...   compatibility proxy for the site's API
  /api/...         this server's own endpoints:
    GET  /api/me                login state (this app's and the site's)
    POST /api/app-login         {"password"}; sets the session cookie
    POST /api/app-logout
    POST /api/site-login        {"email", "password"}; the server signs in to the site
    POST /api/site-logout
    GET  /api/catalog?since=N   lots changed after sequence N, the id list, and pull status
    POST /api/pull              start a full pull if one is allowed
    GET  /api/settings?since=N  settings changed after revision N
    PUT  /api/settings/<key>    {"value": ...}; last write wins
    PUT  /api/item-type         {"lotId", "itemType"}; correct every listing with this exact title
    GET  /api/history?id=N      closed lots whose name matches lot N's, most recent first
    GET  /api/health

Because the server is logged in to your account (and can bid), every request
except the app's static files needs this app's own password (a session
cookie, SameSite=Strict) once one is set, and one must be set to listen
anywhere but loopback. State-changing requests also need an `X-TLX-Client`
header, which another site can't add without a CORS preflight that's never
answered. Ordinary HTML forms must carry this server's exact Origin.
Without a password, the Host header must be a local name (stops DNS
rebinding).
"""

from __future__ import annotations

import gzip
import hashlib
import hmac
import json
import logging
import mimetypes
import re
import secrets
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .catalog import Catalog
from .gateway import Gateway
from .history import HISTORY_LIMIT, NAME_MATCH_KEY
from .itemtypes import MAX_TYPE_LENGTH, clean_type
from .live import Live
from .session import SiteSession
from .site import SITE, TIMEOUT, USER_AGENT, ApiError, normalize_detail, now_ms
from .store import Store, dumps
from .ui import LOCAL_KEYS, UI
from .views import view_from_query

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
MAX_BODY = 4 * 1024 * 1024
SETTING_KEY = re.compile(r"^[A-Za-z0-9_]{1,64}$")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
SESSION_COOKIE = "tlx_session"
SESSION_MAX_AGE = 90 * 24 * 3600
# Request headers passed through to the site's API (the rest are dropped).
LOT_DETAIL_PATH = re.compile(r"/backend/v1/auctions/lots/[^/]+/\d+/")  # a lot detail the proxy keeps (store.lot_details)
PROXY_HEADERS = ("Accept", "Content-Type", "X-CSRF-Protection", "X-Bid-Surface", "X-Bid-Type")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


_opener = urllib.request.build_opener(_NoRedirect)


class Api:
    """What the handler needs, shared by every request thread."""

    def __init__(self, store: Store, catalog: Catalog, session: SiteSession, password: str | None, hosts: set[str], tls: bool) -> None:
        self.store = store
        self.catalog = catalog
        self.session = session
        self.password = password
        self.hosts = LOCAL_HOSTS | {h.lower().strip("[]") for h in hosts}
        self.tls = tls
        self.gateway = Gateway(store, session)
        self.live = Live(store, self.gateway)
        self.ui = UI(self, self.gateway)
        self.stream_id = secrets.token_hex(8)
        self.stopped = threading.Event()

    def status(self) -> dict[str, Any]:
        meta = self.store.meta()
        p = self.catalog.progress
        return {
            "now": now_ms(),
            "meta": vars(meta),
            "nextPullAt": self.catalog.next_pull_at(meta),
            "progress": {"done": p.done, "total": p.total} if p else None,
            "error": self.catalog.error,
            "liveError": self.live.error,
        }


def make_handler(api: Api) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = f"tlx-server/{__version__}"
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: object) -> None:
            log.debug("%s %s", self.address_string(), format % args)

        # -- plumbing -------------------------------------------------------
        def _send(
            self,
            status: int,
            body: str | bytes,
            content_type: str = "application/json; charset=utf-8",
            headers: dict[str, str] | None = None,
        ) -> None:
            data = body.encode() if isinstance(body, str) else body
            compressible = content_type.startswith(("application/json", "text/", "application/javascript", "image/svg"))
            gz = compressible and len(data) > 1024 and "gzip" in self.headers.get("Accept-Encoding", "")
            if gz:
                data = gzip.compress(data, 5)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            for k, v in {"Cache-Control": "no-store", **(headers or {})}.items():
                self.send_header(k, v)
            if gz:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)

        def _json(self, status: int, obj: object, headers: dict[str, str] | None = None) -> None:
            self._send(status, dumps(obj), headers=headers)

        def _error(self, status: HTTPStatus, message: str) -> None:
            self.close_connection = True
            self._json(status, {"error": message}, {"Connection": "close"})

        def _body(self) -> bytes:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ValueError("Request body too large")
            return self.rfile.read(n) if n else b""

        def _json_body(self) -> dict[str, Any]:
            d = json.loads(self._body() or b"null")
            if not isinstance(d, dict):
                raise TypeError("Expected a JSON object")
            return d

        @staticmethod
        def _since(query: dict[str, list[str]]) -> int:
            try:
                return max(0, int(query.get("since", ["0"])[0]))
            except ValueError:
                return 0

        def _host(self) -> str:
            try:
                return urlsplit(f"//{self.headers.get('Host') or ''}").hostname or ""
            except ValueError:
                return ""

        def _secure(self) -> bool:
            return api.tls or self.headers.get("X-Forwarded-Proto") == "https"

        def _session_id(self) -> str | None:
            jar = SimpleCookie()
            try:
                jar.load(self.headers.get("Cookie") or "")
            except CookieError:
                return None
            m = jar.get(SESSION_COOKIE)
            return m.value if m else None

        def _unlocked(self) -> bool:
            """Whether this request may use the server (no password set, or a valid session cookie)."""
            if not api.password:
                return True
            sid = self._session_id()
            return bool(sid) and api.store.has_session(sid, SESSION_MAX_AGE)

        def _guard(self, method: str, path: str) -> bool:
            """Host, CSRF and password checks; sends the error and returns False if one fails."""
            if not api.password and self._host() not in api.hosts:
                self._error(HTTPStatus.FORBIDDEN, f"Host {self._host()!r} not allowed (use --allow-host, or set a password)")
                return False
            public = path in ("/api/me", "/api/app-login", "/api/health", "/ui/unlock") or not path.startswith((
                "/api/",
                "/backend/",
                "/ui/",
                "/events",
            ))
            origin = f"{'https' if self._secure() else 'http'}://{self.headers.get('Host', '')}"
            same_origin_form = path.startswith("/ui/") and self.headers.get("Origin") == origin
            if method not in ("GET", "HEAD") and not self.headers.get("X-TLX-Client") and not same_origin_form:
                self._error(HTTPStatus.FORBIDDEN, "Missing X-TLX-Client header")
                return False
            if not public and not self._unlocked():
                self._error(HTTPStatus.UNAUTHORIZED, "app_locked")
                return False
            return True

        def _route(self, method: str) -> None:
            url = urlsplit(self.path)
            path = url.path
            if not self._guard(method, path):
                return
            try:
                if path == "/events" and method == "GET":
                    self._events()
                elif path in ("/", "/tlx", "/tlx/") and method in ("GET", "HEAD"):
                    self._html(parse_qs(url.query))
                elif path.startswith("/ui/") and method == "POST":
                    self._ui_action(path.removeprefix("/ui/"))
                elif path.startswith("/backend/v1/") and ".." not in path.split("/"):
                    self._proxy(method)
                elif path.startswith("/api/"):
                    self._api(method, path, parse_qs(url.query))
                elif method in ("GET", "HEAD"):
                    self._static(path)
                else:
                    self._error(HTTPStatus.NOT_FOUND, "Not found")
            except (ValueError, KeyError, TypeError) as e:
                self._error(HTTPStatus.BAD_REQUEST, str(e))

        # -- this server's API ------------------------------------------------
        def _api(self, method: str, path: str, query: dict[str, list[str]]) -> None:
            route = (method, path)
            if route == ("GET", "/api/health"):
                self._json(HTTPStatus.OK, {"ok": True, "version": __version__})
            elif route == ("GET", "/api/me"):
                self._json(HTTPStatus.OK, self._me())
            elif route == ("POST", "/api/activity"):
                data = self._json_body()
                active = data.get("active") is True
                api.live.watch(str(data.get("tab", "")), data.get("ids", []), active)
                api.catalog.heartbeat(active)
                self._json(HTTPStatus.OK, {"ok": True})
            elif route == ("POST", "/api/import"):
                self._import_browser()
            elif route == ("POST", "/api/visit"):
                self._json_body()
                browser_id, browser, cookie = self._browser()
                api.ui.visit(browser, api.ui.settings())
                api.store.save_browser(browser_id, browser)
                self._json(200, {"ok": True}, {"Set-Cookie": cookie})
            elif route == ("POST", "/api/app-login"):
                self._app_login()
            elif route == ("POST", "/api/app-logout"):
                if sid := self._session_id():
                    api.store.drop_session(sid)
                self._json(HTTPStatus.OK, self._me(locked=bool(api.password)), headers={"Set-Cookie": self._cookie("", 0)})
            elif route == ("POST", "/api/site-login"):
                d = self._json_body()
                error = api.session.login(str(d.get("email", "")).strip(), str(d.get("password", "")))
                if not error:
                    api.live.reconnect()
                    api.catalog.request_pull()  # pick up your standings and watchlist when allowed
                self._json(HTTPStatus.OK, {"error": error, **self._me()})
            elif route == ("POST", "/api/site-logout"):
                api.session.logout()
                api.live.reconnect()
                self._json(HTTPStatus.OK, self._me())
            elif route == ("GET", "/api/catalog"):
                self._catalog(self._since(query))
            elif route == ("POST", "/api/pull"):
                self._json(HTTPStatus.OK, {"result": api.catalog.request_pull(), **api.status()})
            elif route == ("GET", "/api/settings"):
                rev, values = api.store.settings(self._since(query))
                self._json(HTTPStatus.OK, {"rev": rev, "values": values})
            elif route == ("GET", "/api/history"):
                lot = api.store.lot(int(query["id"][0]))
                if not lot:
                    raise ValueError("No such open lot")
                self._json(HTTPStatus.OK, {"closes": api.catalog.history.closes_for(lot)[:HISTORY_LIMIT]})
            elif method == "PUT" and path.startswith("/api/settings/"):
                self._put_setting(path.removeprefix("/api/settings/"))
            elif route == ("PUT", "/api/item-type"):
                self._put_item_type()
            else:
                self._error(HTTPStatus.NOT_FOUND, "Not found")

        def _me(self, locked: bool | None = None) -> dict[str, Any]:
            locked = not self._unlocked() if locked is None else locked
            return {
                "version": __version__,
                "app": {"locked": locked, "password": bool(api.password)},
                "site": None if locked else api.session.status(),
            }

        def _cookie(self, value: str, max_age: int) -> str:
            secure = "; Secure" if self._secure() else ""
            return f"{SESSION_COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict{secure}"

        def _app_login(self) -> None:
            given = str(self._json_body().get("password", ""))
            if not api.password or hmac.compare_digest(given.encode(), api.password.encode()):
                sid = secrets.token_urlsafe(32)
                api.store.add_session(sid)
                self._json(HTTPStatus.OK, self._me(locked=False), headers={"Set-Cookie": self._cookie(sid, SESSION_MAX_AGE)})
            else:
                time.sleep(1)  # slow down guessing
                self._error(HTTPStatus.UNAUTHORIZED, "Wrong password.")

        def _catalog(self, since: int) -> None:
            api.catalog.heartbeat(self.headers.get("X-TLX-Active") == "1")
            c = api.store.changes(since)
            full = since == 0 or since > c.seq
            self._json(HTTPStatus.OK, {"seq": c.seq, "full": full, "ids": None if full else c.ids, **api.status(), "lots": c.lots})

        def _put_setting(self, key: str) -> None:
            if not SETTING_KEY.match(key):
                raise ValueError(f"Bad setting key {key!r}")
            body = self._json_body()
            if "value" not in body:
                raise ValueError('Expected {"value": ...}')
            self._json(HTTPStatus.OK, {"rev": api.store.put_setting(key, body["value"])})
            if key == NAME_MATCH_KEY:
                api.catalog.history.wake()  # match names again

        def _put_item_type(self) -> None:
            try:
                body = self._json_body()
            except TypeError as e:
                raise ValueError(str(e)) from e
            lot_id = body.get("lotId")
            if not isinstance(lot_id, int) or isinstance(lot_id, bool) or not 0 < lot_id <= 2**53 - 1:
                raise ValueError("Expected a positive integer lotId")
            text = body.get("itemType")
            if (
                not isinstance(text, str)
                or len(text) > MAX_TYPE_LENGTH
                or any(not c.isprintable() and not c.isspace() for c in text)
                or not (item_type := clean_type(text))
            ):
                raise ValueError(f"Item type must be 1 to {MAX_TYPE_LENGTH} characters")
            lot = api.store.lot(lot_id)
            if not lot:
                self._error(HTTPStatus.NOT_FOUND, "No such catalog lot")
                return
            api.store.save_item_types({lot["title"]: (item_type, (lot.get("category") or {}).get("value"))}, manual=True)
            self._json(HTTPStatus.OK, {"title": lot["title"], "itemType": item_type, "seq": api.store.seq()})

        # -- the site's API ---------------------------------------------------
        def _proxy(self, method: str) -> None:
            body = self._body() if method in ("POST", "PUT", "PATCH", "DELETE") else None

            def send(token: str | None) -> tuple[int, str, bytes]:
                headers = {h: v for h in PROXY_HEADERS if (v := self.headers.get(h))}
                headers["User-Agent"] = USER_AGENT
                if token:
                    headers["Authorization"] = f"Bearer {token}"
                req = urllib.request.Request(f"{SITE}{self.path}", data=body, headers=headers, method=method)
                try:
                    res = _opener.open(req, timeout=TIMEOUT)
                except urllib.error.HTTPError as e:
                    res = e
                with res:
                    return (res.status or HTTPStatus.BAD_GATEWAY, res.headers.get("Content-Type", "application/json"), res.read())

            try:
                token = api.session.token()
                status, ctype, data = send(token)
                # A 401 means the request wasn't processed, so retrying is safe even for bids.
                if status == 401 and token:
                    if new := api.session.rejected(token):
                        status, ctype, data = send(new)
                    if status == 401 and method == "GET":
                        status, ctype, data = send(None)  # fall back to anonymous data
            except (urllib.error.URLError, OSError) as e:
                self._error(HTTPStatus.BAD_GATEWAY, f"Couldn’t reach the site: {e}")
                return
            self._send(status, data, ctype)
            if method == "GET" and status == HTTPStatus.OK and LOT_DETAIL_PATH.fullmatch(urlsplit(self.path).path):
                try:
                    api.store.save_lot_detail(normalize_detail(json.loads(data)))
                except ValueError, KeyError, TypeError, AttributeError, sqlite3.Error:
                    log.warning("couldn't keep the detail of %s", self.path, exc_info=True)

        # -- the app itself -------------------------------------------------

        def _browser(self) -> tuple[str, dict[str, Any], str]:
            cookies = SimpleCookie()
            try:
                cookies.load(self.headers.get("Cookie", ""))
            except CookieError:
                cookies = SimpleCookie()
            raw = cookies.get("tlx_browser")
            browser_id = raw.value if raw and re.fullmatch(r"[A-Za-z0-9_-]{32,64}", raw.value) else secrets.token_urlsafe(32)
            secure = "; Secure" if self._secure() else ""
            cookie = f"tlx_browser={browser_id}; Path=/; Max-Age={SESSION_MAX_AGE}; HttpOnly; SameSite=Strict{secure}"
            return browser_id, api.store.browser(browser_id), cookie

        def _assets(self) -> dict[str, Any]:
            manifest = STATIC_DIR / ".vite" / "manifest.json"
            if not manifest.is_file():
                raise ValueError("Build the web assets first: npm install && npm run build")
            entries = [entry for entry in json.loads(manifest.read_text()).values() if entry.get("isEntry")]
            if len(entries) != 1:
                raise ValueError("Expected one web asset entry")
            return {"script": entries[0]["file"], "styles": entries[0].get("css", [])}

        def _html(self, query: dict[str, list[str]], message: str = "") -> None:
            browser_id, browser, cookie = self._browser()
            if not self._unlocked():
                self._send(200, api.ui.render("page.html", {"locked": True, **self._assets()}), "text/html; charset=utf-8")
                return
            fragment = self.headers.get("HX-Request") == "true" and self.headers.get("HX-History-Restore-Request") != "true"
            if (
                self.headers.get("HX-Request") != "true"
                and self.headers.get("HX-History-Restore-Request") != "true"
                and self.command != "HEAD"
            ):
                api.ui.visit(browser, api.ui.settings())
            context = api.ui.context(query, browser)
            context.update(oob=False, message=message, locked=False)
            if self.headers.get("X-TLX-Live") != "1":
                api.store.save_browser(browser_id, browser)
            headers = {"Set-Cookie": cookie, "Vary": "HX-Request, HX-History-Restore-Request, X-TLX-Live, X-TLX-More"}
            if self.headers.get("X-TLX-Live") == "1":
                template = "live.html"
            elif self.headers.get("X-TLX-More") == "1":
                template = "results.html"
                headers["HX-Replace-Url"] = context["url"]
            elif fragment:
                template = "app.html"
                previous = parse_qs(urlsplit(self.headers.get("HX-Current-URL", "")).query)
                previous_view = view_from_query(previous)
                changed_search = previous_view["search"] != context["view"]["search"]
                same_rest = (
                    {k: v for k, v in previous_view.items() if k != "search"} == {k: v for k, v in context["view"].items() if k != "search"}
                    and previous.get("closed") == query.get("closed")
                    and previous.get("lot") == query.get("lot")
                    and int(previous.get("page", ["1"])[0]) == context["page"]
                )
                replacing = (
                    bool(previous.get("lot") and query.get("lot"))
                    or (changed_search and same_rest and browser.get("searchEntry"))
                    or (not changed_search and same_rest)
                    or self.headers.get("X-TLX-Init") == "1"
                )
                headers["HX-Replace-Url" if replacing else "HX-Push-Url"] = context["url"]
                if query.get("dialog"):
                    headers.pop("HX-Replace-Url", None)
                    headers["HX-Push-Url"] = "false"
                browser["searchEntry"] = changed_search and same_rest
                api.store.save_browser(browser_id, browser)
            else:
                template = "page.html"
                context.update(self._assets())
            self._send(200, api.ui.render(template, context), "text/html; charset=utf-8", headers)

        def _ui_action(self, action: str) -> None:
            data = parse_qs(self._body().decode(), keep_blank_values=True)
            if action == "unlock":
                given = data.get("password", [""])[0]
                if api.password and not hmac.compare_digest(given.encode(), api.password.encode()):
                    time.sleep(1)
                    self._send(
                        401,
                        '<p class="error" role="alert">Wrong password.</p>',
                        "text/html; charset=utf-8",
                        {"HX-Retarget": "#notifications"},
                    )
                    return
                sid = secrets.token_urlsafe(32)
                api.store.add_session(sid)
                self._send(
                    200 if self.headers.get("HX-Request") == "true" else 303,
                    "",
                    headers={"Set-Cookie": self._cookie(sid, SESSION_MAX_AGE), "Location": "/tlx", "HX-Redirect": "/tlx"},
                )
                return
            if action == "lock":
                if sid := self._session_id():
                    api.store.drop_session(sid)
                self._send(
                    200 if self.headers.get("HX-Request") == "true" else 303,
                    "",
                    headers={"Set-Cookie": self._cookie("", 0), "HX-Redirect": "/tlx", "Location": "/tlx"},
                )
                return
            browser_id, browser, cookie = self._browser()
            try:
                if action == "bid-preview":
                    context = api.ui.bid_preview(data, browser, browser_id)
                    context.update(oob=False, message="")
                    self._send(200, api.ui.render("app.html", context), "text/html; charset=utf-8", {"Set-Cookie": cookie})
                    return
                if action in ("categories-preview", "type-preview"):
                    context = api.ui.preview(action, data, browser)
                    self._send(200, api.ui.render("preview.html", context), "text/html; charset=utf-8")
                    return
                url, message = api.ui.action(action, data, browser, browser_id)
                api.store.save_browser(browser_id, browser)
                if self.headers.get("HX-Request") != "true":
                    self._send(303, "", headers={"Location": url, "Set-Cookie": cookie})
                    return
                context = api.ui.context(parse_qs(urlsplit(url).query), browser)
                context.update(oob=False, message=message)
                self._send(
                    200,
                    api.ui.render("app.html", context),
                    "text/html; charset=utf-8",
                    {"HX-Push-Url" if action in ("clear", "search-open") else "HX-Replace-Url": url, "Set-Cookie": cookie},
                )
            except (ApiError, ValueError, KeyError, TypeError) as error:
                from html import escape

                self._send(
                    400,
                    f'<p class="error" role="alert">{escape(str(error))}</p>',
                    "text/html; charset=utf-8",
                    {"HX-Retarget": "#notifications", "HX-Reswap": "innerHTML"},
                )

        def _import_browser(self) -> None:
            from zoneinfo import ZoneInfo

            data = self._json_body()
            values = data.get("values", {})
            if not isinstance(values, dict):
                raise TypeError("Expected a settings object")
            timezone = data.get("timezone", "America/New_York")
            if not isinstance(timezone, str):
                raise TypeError("Invalid timezone")
            ZoneInfo(timezone)
            browser_id, browser, cookie = self._browser()
            if not browser.get("imported"):
                stored = api.store.settings()[1]
                for key, value in values.items():
                    if key in LOCAL_KEYS and not (key == "tlxView" and data.get("shared")):
                        browser[key] = value
                    elif key in api.ui.settings() and key not in stored:
                        api.store.put_setting(key, value)
                browser["imported"] = True
            browser["timezone"] = timezone
            api.store.save_browser(browser_id, browser)
            self._json(200, {"ok": True}, {"Set-Cookie": cookie})

        def _events(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            last, heartbeat = "", 0.0
            try:
                while not api.stopped.is_set():
                    if not self._unlocked():
                        self.wfile.write(b"event: locked\ndata: {}\n\n")
                        self.wfile.flush()
                        return
                    status = api.status()
                    state = [
                        api.store.seq(),
                        api.store.settings()[0],
                        status["progress"],
                        status["error"],
                        status["meta"],
                        api.live.state,
                        api.session.status(),
                        now_ms() // 30_000,
                    ]
                    revision = api.stream_id + "-" + hashlib.sha256(dumps(state).encode()).hexdigest()[:20]
                    if revision != last:
                        self.wfile.write(f"id: {revision}\nevent: refresh\ndata: {{}}\n\n".encode())
                        last = revision
                    elif time.monotonic() - heartbeat > 15:
                        self.wfile.write(b": heartbeat\n\n")
                        heartbeat = time.monotonic()
                    self.wfile.flush()
                    api.stopped.wait(1)
            except BrokenPipeError, ConnectionResetError, TimeoutError:
                log.debug("Browser event stream disconnected")

        def _static(self, path: str) -> None:
            name = "index.html" if path in ("/", "/tlx", "/tlx/") else path.lstrip("/")
            file = (STATIC_DIR / name).resolve()
            if not file.is_relative_to(STATIC_DIR.resolve()) or not file.is_file():
                self._error(HTTPStatus.NOT_FOUND, "Not found")
                return
            ctype = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "application/manifest+json"):
                ctype += "; charset=utf-8"
            # Built assets have content hashes in their names; the page itself must always be fresh.
            cache = "public, max-age=31536000, immutable" if name.startswith("assets/") else "no-cache"
            self._send(HTTPStatus.OK, file.read_bytes(), ctype, headers={"Cache-Control": cache})

        def do_GET(self) -> None:
            self._route("GET")

        def do_HEAD(self) -> None:
            self._route("HEAD")

        def do_POST(self) -> None:
            self._route("POST")

        def do_PUT(self) -> None:
            self._route("PUT")

        def do_DELETE(self) -> None:
            self._route("DELETE")

    return Handler


def serve(api: Api, host: str, port: int, cert: Path | None = None, key: Path | None = None) -> None:
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    mimetypes.add_type("image/svg+xml", ".svg")
    if not (STATIC_DIR / ".vite" / "manifest.json").is_file():
        log.warning("web assets are not built: run `npm install && npm run build` in the repo root")
    api.live.start()
    httpd = ThreadingHTTPServer((host, port), make_handler(api))
    httpd.daemon_threads = True
    if cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        # Handshake in the request thread, so a stalled client can't block accept().
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True, do_handshake_on_connect=False)
    log.info("serving the app on %s://%s:%d/", "https" if cert else "http", host if ":" not in host else f"[{host}]", port)
    try:
        httpd.serve_forever()
    finally:
        api.stopped.set()
        api.live.stop()
        httpd.server_close()
