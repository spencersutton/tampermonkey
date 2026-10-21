"""HTTP API for the server build of the userscript.

The userscript calls this through GM_xmlhttpRequest, so there's no CORS: the
server sends no CORS headers at all and every request must carry an
`X-TLX-Client` header. A web page can't add that header to a cross-origin
request without a preflight this server never answers, so other sites can't
drive it. The Host header must also be one we expect (stops DNS rebinding),
and an optional shared key can be required on top.

  GET  /api/catalog?since=N   lots changed after sequence N, the id list, and pull status
  POST /api/pull              start a full pull if one is allowed
  GET  /api/settings?since=N  settings changed after revision N
  PUT  /api/settings/<key>    {"value": ...}; last write wins
  GET  /api/health

Headers the userscript sends on /api/catalog: `X-TLX-Active: 1` while the tab
is visible and in use (lets pulls happen), and `X-TL-Token` with the site
login token ("" when logged out).
"""

from __future__ import annotations

import gzip
import hmac
import json
import logging
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

from . import __version__
from .catalog import Catalog
from .site import now_ms
from .store import Store, dumps

log = logging.getLogger(__name__)

MAX_BODY = 4 * 1024 * 1024
SETTING_KEY = re.compile(r"^[A-Za-z0-9_]{1,64}$")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class Api:
    """What the handler needs, shared by every request thread."""

    def __init__(self, store: Store, catalog: Catalog, key: str | None, hosts: set[str]) -> None:
        self.store = store
        self.catalog = catalog
        self.key = key
        self.hosts = LOCAL_HOSTS | {h.lower().strip("[]") for h in hosts}

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
        def _send(self, status: int, body: str | bytes, content_type: str = "application/json") -> None:
            data = body.encode() if isinstance(body, str) else body
            gz = len(data) > 1024 and "gzip" in self.headers.get("Accept-Encoding", "")
            if gz:
                data = gzip.compress(data, 5)
            self.send_response(status)
            self.send_header("Content-Type", f"{content_type}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            if gz:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            self.wfile.write(data)

        def _json(self, status: int, obj: Any) -> None:
            self._send(status, dumps(obj))

        def _error(self, status: HTTPStatus, message: str) -> None:
            self._json(status, {"error": message})

        def _allowed(self) -> bool:
            try:
                host = urlsplit(f"//{self.headers.get('Host') or ''}").hostname or ""
            except ValueError:
                host = ""
            if host not in api.hosts:
                self._error(HTTPStatus.FORBIDDEN, f"Host {host!r} not allowed (start the server with --allow-host {host})")
                return False
            if not self.headers.get("X-TLX-Client"):
                self._error(HTTPStatus.FORBIDDEN, "Missing X-TLX-Client header")
                return False
            if api.key and not hmac.compare_digest(self.headers.get("X-TLX-Key", ""), api.key):
                self._error(HTTPStatus.UNAUTHORIZED, "Wrong or missing server key")
                return False
            return True

        def _body(self) -> Any:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ValueError("Request body too large")
            return json.loads(self.rfile.read(n) or b"null")

        @staticmethod
        def _since(query: dict[str, list[str]]) -> int:
            try:
                return max(0, int(query.get("since", ["0"])[0]))
            except ValueError:
                return 0

        def _route(self, method: str) -> None:
            if not self._allowed():
                return
            url = urlsplit(self.path)
            query = parse_qs(url.query)
            try:
                if method == "GET" and url.path == "/api/health":
                    self._json(HTTPStatus.OK, {"ok": True, "version": __version__})
                elif method == "GET" and url.path == "/api/catalog":
                    self._catalog(self._since(query))
                elif method == "POST" and url.path == "/api/pull":
                    self._json(HTTPStatus.OK, {"result": api.catalog.request_pull(), **api.status()})
                elif method == "GET" and url.path == "/api/settings":
                    rev, values = api.store.settings(self._since(query))
                    self._json(HTTPStatus.OK, {"rev": rev, "values": values})
                elif method == "PUT" and url.path.startswith("/api/settings/"):
                    self._put_setting(url.path.removeprefix("/api/settings/"))
                else:
                    self._error(HTTPStatus.NOT_FOUND, "Not found")
            except (ValueError, KeyError) as e:
                self._error(HTTPStatus.BAD_REQUEST, str(e))

        # -- endpoints ------------------------------------------------------
        def _catalog(self, since: int) -> None:
            token = self.headers.get("X-TL-Token")
            api.catalog.heartbeat(self.headers.get("X-TLX-Active") == "1", token.strip() if token is not None else None)
            c = api.store.changes(since)
            full = since == 0 or since > c.seq
            head = dumps({"seq": c.seq, "full": full, "ids": None if full else c.ids, **api.status()})
            # Lots are stored as JSON text; splice them in rather than re-encoding ~5,000 objects.
            self._send(HTTPStatus.OK, f'{head[:-1]},"lots":[{",".join(c.lots)}]}}')

        def _put_setting(self, key: str) -> None:
            if not SETTING_KEY.match(key):
                raise ValueError(f"Bad setting key {key!r}")
            body = self._body()
            if not isinstance(body, dict) or "value" not in body:
                raise ValueError('Expected {"value": ...}')
            self._json(HTTPStatus.OK, {"rev": api.store.put_setting(key, body["value"])})

        def do_GET(self) -> None:
            self._route("GET")

        def do_POST(self) -> None:
            self._route("POST")

        def do_PUT(self) -> None:
            self._route("PUT")

    return Handler


def serve(api: Api, host: str, port: int) -> None:
    httpd = ThreadingHTTPServer((host, port), make_handler(api))
    httpd.daemon_threads = True
    log.info("listening on http://%s:%d", host, port)
    httpd.serve_forever()
