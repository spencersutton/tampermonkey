"""Site reads and mutations, shared by HTML requests and the live subscriber."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .session import SiteSession
from .site import BASE, TIMEOUT, USER_AGENT, ApiError, normalize_detail, normalize_lot, now_ms
from .store import Store


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:
        return None


_opener = urllib.request.build_opener(_NoRedirect)


class Gateway:
    def __init__(self, store: Store, session: SiteSession) -> None:
        self.store = store
        self.session = session
        self._cache: dict[str, tuple[int, dict[str, Any]]] = {}
        self._lock = threading.RLock()
        self.bid_lock = threading.Lock()

    def request(self, path: str, method: str = "GET", body: object = None, headers: dict[str, str] | None = None) -> dict[str, Any]:
        if not path.startswith("/v1/") or ".." in path.split("/"):
            raise ValueError("Invalid site API path")
        token = self.session.token()
        for attempt in range(2):
            request_headers = {"Accept": "application/json", "User-Agent": USER_AGENT, **(headers or {})}
            if token:
                request_headers["Authorization"] = "Bearer " + token
            data = None
            if body is not None:
                data = json.dumps(body).encode()
                request_headers["Content-Type"] = "application/json"
            if method != "GET":
                request_headers["X-CSRF-Protection"] = "1"
            req = urllib.request.Request(BASE + path, data=data, headers=request_headers, method=method)
            try:
                response = _opener.open(req, timeout=TIMEOUT)
            except urllib.error.HTTPError as error:
                response = error
            except (urllib.error.URLError, OSError) as error:
                raise ApiError("Network error. For a bid, check the lot before trying again; it may have been accepted.", 0) from error
            with response:
                status = response.status
                raw = response.read()
            if not isinstance(status, int):
                raise ApiError("Missing HTTP status from the site", 502)
            if status == 401 and token and attempt == 0:
                token = self.session.rejected(token)
                if token or method == "GET":
                    continue
            try:
                result = json.loads(raw) if raw else {}
            except ValueError as error:
                raise ApiError(f"Invalid reply from the site ({status})", status) from error
            if not isinstance(result, dict):
                raise ApiError("Expected a JSON object from the site", 502)
            if status >= 300:
                details = result.get("details") or {}
                amounts = details.get("amount") or []
                message = (amounts[0] if isinstance(amounts, list) and amounts else None) or result.get("error")
                raise ApiError(str(message or f"Site request failed ({status})"), status)
            return result
        raise ApiError("Site login expired", 401)

    def cached(self, path: str, ttl: int = 120_000) -> dict[str, Any]:
        # Serialize cache fills; a disconnected browser never cancels a shared read.
        with self._lock:
            hit = self._cache.get(path)
            if hit and now_ms() - hit[0] < ttl:
                return hit[1]
            data = self.request(path)
            self._cache[path] = (now_ms(), data)
            return data

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def detail(self, lot_id: int, period: str | None = None, *, fresh: bool = False) -> dict[str, Any]:
        existing = self.store.lot(lot_id)
        period = (existing or {}).get("auctionPeriod") or period
        if not period:
            raise ValueError("No such lot")
        path = f"/v1/auctions/lots/{urllib.parse.quote(str(period), safe='')}/{lot_id}/"
        with self._lock:
            hit = self._cache.get(path)
            cached = not fresh and hit is not None and now_ms() - hit[0] < 120_000
            since = self.store.seq()
            raw = hit[1] if cached and hit else self.request(path)
            detail = normalize_detail(raw)
            detail["similar"] = [normalize_lot(lot) for lot in raw.get("similar") or []]
            if not cached:
                self._cache[path] = (now_ms(), raw)
                self.store.save_lot_detail(detail)
                self.store.merge_lot(lot_id, detail, account=self.session.logged_in, since=since)
            current = self.store.lot(lot_id) or {}
            return {**detail, **current, "images": detail["images"] or current.get("images", [])}

    def closed(self, section: str) -> list[dict[str, Any]]:
        if section not in ("won", "lost"):
            raise ValueError("Invalid closed-lot section")
        if not self.session.logged_in:
            raise ValueError("Log in to see closed lots.")
        lots: dict[tuple[str, int], dict[str, Any]] = {}
        page = 1
        while True:
            data = self.cached(f"/v1/auctions/control-panel/closed/{section}/?page={page}&per_page=100")
            rows = data.get("results") or []
            before = len(lots)
            for row in rows:
                lots[row["auction_period"], row["lot_id"]] = row
            if not rows or len(lots) >= data["count"]:
                return list(lots.values())
            if len(lots) == before:
                raise ApiError("Closed-lot pagination made no progress. Try again.", 502)
            page += 1
