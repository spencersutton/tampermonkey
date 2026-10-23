"""HTTP side: serves the /tlx web app and everything it talks to.

The app is the same Preact UI as the userscript, built for the browser
(`npm run build` puts it in static/), so it runs on a phone with no extension.
It can't talk to the site directly: the site's API sends no CORS headers and
its websocket only accepts its own Origin. So this server stands in for the
site:

  /backend/v1/...  the site's JSON API, with the server's login token added
                   (refreshed and retried once on a 401, like the site's client)
  /ws              the site's live-updates websocket, relayed byte for byte
                   with the Origin swapped for the site's
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
    GET  /api/health
  /lost            a plain table of every lot you bid on and lost (not part of the app)
  POST /sql        read-only SQL on the database, in libSQL's HTTP format, for
                   DBeaver's LibSQL driver (needs `Authorization: Bearer <password>`)

Because the server is logged in to your account (and can bid), every request
except the app's static files needs this app's own password (a session
cookie, SameSite=Strict) once one is set, and one must be set to listen
anywhere but loopback. State-changing requests also need an `X-TLX-Client`
header, which another site can't add without a CORS preflight that's never
answered; websocket upgrades must come from this server's own Origin.
Without a password, the Host header must be a local name (stops DNS
rebinding).
"""

from __future__ import annotations

import gzip
import hmac
import html
import json
import logging
import mimetypes
import re
import secrets
import socket
import sqlite3
import ssl
import threading
import time
import urllib.error
import urllib.request
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .catalog import Catalog
from .session import SiteSession
from .site import SITE, TIMEOUT, USER_AGENT, ApiError, fetch_lost, now_ms
from .store import Store, dumps

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"
WS_HOST = "ws.triangleliquidators.com"
WS_PATH = "/connection/websocket"
MAX_BODY = 4 * 1024 * 1024
SETTING_KEY = re.compile(r"^[A-Za-z0-9_]{1,64}$")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
SESSION_COOKIE = "tlx_session"
SESSION_MAX_AGE = 90 * 24 * 3600
# Request headers passed through to the site's API (the rest are dropped).
PROXY_HEADERS = ("Accept", "Content-Type", "X-CSRF-Protection", "X-Bid-Surface", "X-Bid-Type")
WS_HEADERS = ("Sec-WebSocket-Key", "Sec-WebSocket-Version", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
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

    def status(self) -> dict[str, Any]:
        meta = self.store.meta()
        p = self.catalog.progress
        return {
            "now": now_ms(),
            "meta": vars(meta),
            "nextPullAt": self.catalog.next_pull_at(meta),
            "progress": {"done": p.done, "total": p.total} if p else None,
            "error": self.catalog.error,
        }


def make_handler(api: Api) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        server_version = f"tlx-server/{__version__}"
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:
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

        def _json(self, status: int, obj: Any, headers: dict[str, str] | None = None) -> None:
            self._send(status, dumps(obj), headers=headers)

        def _error(self, status: HTTPStatus, message: str) -> None:
            self._json(status, {"error": message})

        def _body(self) -> Any:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ValueError("Request body too large")
            return self.rfile.read(n) if n else b""

        def _json_body(self) -> dict[str, Any]:
            d = json.loads(self._body() or b"null")
            if not isinstance(d, dict):
                raise ValueError("Expected a JSON object")
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
            except Exception:
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
            if path == "/sql":
                # Another site can't send an Authorization header without a CORS preflight, so the bearer password is enough.
                if not api.password:
                    self._error(HTTPStatus.FORBIDDEN, "Set --password (or TLX_PASSWORD) to use /sql")
                    return False
                given = self.headers.get("Authorization", "").removeprefix("Bearer ")
                if not hmac.compare_digest(given.encode(), api.password.encode()):
                    self._error(HTTPStatus.UNAUTHORIZED, "Wrong password.")
                    return False
                return True
            if not api.password and self._host() not in api.hosts:
                self._error(HTTPStatus.FORBIDDEN, f"Host {self._host()!r} not allowed (use --allow-host, or set a password)")
                return False
            public = path in ("/api/me", "/api/app-login", "/api/health") or not path.startswith(("/api/", "/backend/", "/ws", "/lost"))
            if method not in ("GET", "HEAD") and not self.headers.get("X-TLX-Client"):
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
                if path == "/ws" and self.headers.get("Upgrade", "").lower() == "websocket":
                    self._relay_ws()
                elif path.startswith("/backend/v1/") and ".." not in path.split("/"):
                    self._proxy(method)
                elif path.startswith("/api/"):
                    self._api(method, path, parse_qs(url.query))
                elif path == "/lost" and method in ("GET", "HEAD"):
                    self._lost()
                elif path == "/sql" and method == "POST":
                    self._sql()
                elif method in ("GET", "HEAD"):
                    self._static(path)
                else:
                    self._error(HTTPStatus.NOT_FOUND, "Not found")
            except (ValueError, KeyError) as e:
                self._error(HTTPStatus.BAD_REQUEST, str(e))

        # -- this server's API ------------------------------------------------
        def _api(self, method: str, path: str, query: dict[str, list[str]]) -> None:
            route = (method, path)
            if route == ("GET", "/api/health"):
                self._json(HTTPStatus.OK, {"ok": True, "version": __version__})
            elif route == ("GET", "/api/me"):
                self._json(HTTPStatus.OK, self._me())
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
                    api.catalog.request_pull()  # pick up your standings and watchlist when allowed
                self._json(HTTPStatus.OK, {"error": error, **self._me()})
            elif route == ("POST", "/api/site-logout"):
                api.session.logout()
                self._json(HTTPStatus.OK, self._me())
            elif route == ("GET", "/api/catalog"):
                self._catalog(self._since(query))
            elif route == ("POST", "/api/pull"):
                self._json(HTTPStatus.OK, {"result": api.catalog.request_pull(), **api.status()})
            elif route == ("GET", "/api/settings"):
                rev, values = api.store.settings(self._since(query))
                self._json(HTTPStatus.OK, {"rev": rev, "values": values})
            elif method == "PUT" and path.startswith("/api/settings/"):
                self._put_setting(path.removeprefix("/api/settings/"))
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
            head = dumps({"seq": c.seq, "full": full, "ids": None if full else c.ids, **api.status()})
            # Lots are stored as JSON text; splice them in rather than re-encoding ~5,000 objects.
            self._send(HTTPStatus.OK, f'{head[:-1]},"lots":[{",".join(c.lots)}]}}')

        def _put_setting(self, key: str) -> None:
            if not SETTING_KEY.match(key):
                raise ValueError(f"Bad setting key {key!r}")
            body = self._json_body()
            if "value" not in body:
                raise ValueError('Expected {"value": ...}')
            self._json(HTTPStatus.OK, {"rev": api.store.put_setting(key, body["value"])})

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
                    return res.status, res.headers.get("Content-Type", "application/json"), res.read()

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

        def _relay_ws(self) -> None:
            """Relay the site's websocket: our handshake goes upstream with the site's Origin, then bytes flow both ways."""
            origin = self.headers.get("Origin")
            if origin and urlsplit(origin).netloc.lower() != (self.headers.get("Host") or "").lower():
                self._error(HTTPStatus.FORBIDDEN, "Cross-origin websocket")
                return
            try:
                raw = socket.create_connection((WS_HOST, 443), timeout=15)
                upstream = ssl.create_default_context().wrap_socket(raw, server_hostname=WS_HOST)
                lines = [
                    f"GET {WS_PATH} HTTP/1.1",
                    f"Host: {WS_HOST}",
                    "Upgrade: websocket",
                    "Connection: Upgrade",
                    f"Origin: {SITE}",
                    f"User-Agent: {USER_AGENT}",
                ]
                lines += [f"{h}: {v}" for h in WS_HEADERS if (v := self.headers.get(h))]
                upstream.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
                head = b""
                while b"\r\n\r\n" not in head:
                    chunk = upstream.recv(4096)
                    if not chunk or len(head) > 65536:
                        raise OSError("bad handshake reply")
                    head += chunk
            except OSError as e:
                self._error(HTTPStatus.BAD_GATEWAY, f"Couldn’t reach the live-updates server: {e}")
                return
            self.close_connection = True
            self.connection.sendall(head)  # the 101 (its accept key depends only on the client's key) and any first frames
            if not head.startswith(b"HTTP/1.1 101"):
                upstream.close()
                return
            upstream.settimeout(None)

            def up() -> None:
                try:
                    while chunk := self.rfile.read1(65536):
                        upstream.sendall(chunk)
                except OSError:
                    pass
                finally:
                    _shutdown(upstream)

            threading.Thread(target=up, name="ws-up", daemon=True).start()
            try:
                while chunk := upstream.recv(65536):
                    self.connection.sendall(chunk)
            except OSError:
                pass
            finally:
                _shutdown(self.connection)
                upstream.close()

        # -- lost lots ------------------------------------------------------
        def _lost(self) -> None:
            def page(body: str) -> str:
                return (
                    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
                    "<title>Lost lots</title><style>"
                    "body{font:14px system-ui,sans-serif;margin:16px}table{border-collapse:collapse}"
                    "th,td{border-bottom:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:middle}"
                    "td.n,th.n{text-align:right}img{width:48px;height:48px;object-fit:cover}"
                    f"</style>{body}"
                )

            token = api.session.token()
            if not token:
                self._send(HTTPStatus.OK, page("<p>The server isn’t logged in to the site.</p>"), "text/html; charset=utf-8")
                return
            try:
                try:
                    lots = fetch_lost(token)
                except ApiError as e:
                    if e.status != 401 or not (new := api.session.rejected(token)):
                        raise
                    lots = fetch_lost(new)
            except ApiError as e:
                self._error(HTTPStatus.BAD_GATEWAY, str(e))
                return
            esc = html.escape
            rows = "".join(
                "<tr>"
                + (
                    f'<td><img src="https://cdn.triangleliquidators.com/{esc(img)}" alt="" loading="lazy"></td>'
                    if (img := r.get("hero_image"))
                    else "<td></td>"
                )
                + f"<td>{esc(str(r.get('title') or ''))}</td><td>{esc(str(r.get('lot_number') or ''))}</td>"
                + f"<td>{esc(str(r.get('location_name') or ''))}</td><td>{esc(str(r.get('auction_period') or ''))}</td>"
                + f'<td class="n">${r.get("final_price") or 0:,.2f}</td></tr>'
                for r in lots
            )
            head = '<tr><th></th><th>Title</th><th>Lot #</th><th>Location</th><th>Auction</th><th class="n">Final price</th></tr>'
            self._send(HTTPStatus.OK, page(f"<h1>Lost lots ({len(lots)})</h1><table>{head}{rows}</table>"), "text/html; charset=utf-8")

        # -- the app itself -------------------------------------------------
        def _sql(self) -> None:
            """Run {"statements": [sql | {"q", "params"}]} read-only and answer [{"results": ...} | {"error"}] (libSQL's format)."""
            statements = self._json_body().get("statements")
            if not isinstance(statements, list):
                raise ValueError('Expected {"statements": [...]}')
            out: list[dict[str, Any]] = []
            db = sqlite3.connect(f"{api.store.path.resolve().as_uri()}?mode=ro", uri=True, timeout=10)
            try:
                for st in statements:
                    q, params = (st.get("q", ""), st.get("params") or []) if isinstance(st, dict) else (st, [])
                    if isinstance(params, dict):
                        params = {k.lstrip(":@$"): v for k, v in params.items()}
                    try:
                        cur = db.execute(q, params)
                        rows = [[v.hex() if isinstance(v, bytes) else v for v in row] for row in cur.fetchall()]
                    except sqlite3.Error as e:
                        out.append({"error": str(e)})
                        break
                    columns = [d[0] for d in cur.description or []]
                    out.append({"results": {"columns": columns, "rows": rows, "rows_read": len(rows), "rows_written": 0}})
            finally:
                db.close()
            self._json(HTTPStatus.OK, out)

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


def _shutdown(sock: socket.socket) -> None:
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


def serve(api: Api, host: str, port: int, cert: Path | None = None, key: Path | None = None) -> None:
    mimetypes.add_type("application/manifest+json", ".webmanifest")
    mimetypes.add_type("image/svg+xml", ".svg")
    httpd = ThreadingHTTPServer((host, port), make_handler(api))
    httpd.daemon_threads = True
    if cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        # Handshake in the request thread, so a stalled client can't block accept().
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True, do_handshake_on_connect=False)
    log.info("serving the app on %s://%s:%d/", "https" if cert else "http", host if ":" not in host else f"[{host}]", port)
    httpd.serve_forever()
