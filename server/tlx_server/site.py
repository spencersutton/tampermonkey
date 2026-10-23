"""Client for triangleliquidators.com's JSON API (the same endpoints /tlx uses).

`normalize_lot` mirrors `normalizeLot` in src/app/api.ts, so the server hands
the userscript lots in exactly the shape it already works with.
"""

from __future__ import annotations

import base64
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Any

SITE = "https://triangleliquidators.com"
BASE = f"{SITE}/backend"
LIST_PAGE_SIZE = 100  # the API's maximum per_page
USER_AGENT = "tlx-server/1.0 (+https://github.com/spencersutton/tampermonkey)"
TIMEOUT = 30

Raw = dict[str, Any]


class ApiError(Exception):
    """A failed API request, with its HTTP status (0 = network error)."""

    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


def token_expiry(token: str | None) -> float | None:
    """Epoch seconds when a JWT expires (its `exp` claim), or None if it has none."""
    if not token:
        return None
    try:
        part = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except (IndexError, ValueError):
        return None
    exp = claims.get("exp")
    return float(exp) if isinstance(exp, (int, float)) else None


def get(path: str, params: dict[str, str | int] | None = None, token: str | None = None) -> Any:
    """GET a JSON endpoint, with the bearer token when there is one."""
    qs = f"?{urllib.parse.urlencode(params)}" if params else ""
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(f"{BASE}{path}{qs}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        raise ApiError(f"{e.code} {e.reason or 'error'} for {path}", e.code) from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise ApiError(f"Network error for {path}: {e}", 0) from e


def _num(v: Any, fallback: Any = 0) -> Any:
    """The value if it is a finite number, else the fallback."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return fallback
    return v


def _epoch_ms(iso: str | None) -> int | None:
    """ISO 8601 timestamp to epoch ms (like JS Date.parse), or None."""
    if not iso:
        return None
    try:
        return round(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def normalize_standing(s: Any) -> Raw | None:
    """The API's `your_standing` object as a Standing."""
    if not isinstance(s, dict):
        return None
    return {"isLeading": bool(s.get("is_leading")), "yourMaxBid": s.get("your_max_bid")}


def normalize_lot(r: Raw) -> Raw:
    """A raw API lot (snake_case) as a Lot (see src/app/types.ts)."""
    cat, cond, loc = r.get("category"), r.get("condition"), r.get("location")
    images = sorted(r.get("images") or [], key=lambda i: _num(i.get("position")))
    return {
        "id": r["id"],
        "auctionPeriod": r.get("auction_period"),
        "title": str(r.get("title") or ""),
        "lotNumber": str(r.get("lot_number") or ""),
        "category": {"value": cat.get("value"), "label": cat.get("label")} if cat else None,
        "condition": {"value": cond.get("value"), "label": cond.get("display_name")} if cond else None,
        "location": {"id": loc.get("id"), "name": loc.get("name")} if loc else None,
        "isTransferable": bool(r.get("is_transferable")),
        "transferFee": _num(r.get("transfer_fee")),
        "currentPrice": _num(r.get("current_price")),
        "estimatedRetailPrice": r.get("estimated_retail_price"),
        "endsAt": _epoch_ms(r.get("ends_at")),
        "status": r.get("status"),
        "version": _num(r.get("version"), -1),
        "bidCount": _num(r.get("bid_count")),
        "nextMinIncrement": _num(r.get("next_min_increment")),
        "yourStanding": normalize_standing(r.get("your_standing")),
        "isWatchlisted": bool(r.get("is_watchlisted")),
        "hasBid": bool(r.get("has_bid")),
        "images": [{"thumb": i.get("image_thumb"), "card": i.get("image_card"), "large": i.get("image_large")} for i in images],
    }


@dataclass
class LotPage:
    count: int
    results: list[Raw]


def fetch_lot_page(page: int, token: str | None) -> LotPage:
    """One page of the catalog, newest first.

    `newly-listed` order keeps pages stable while we walk them: new lots only
    push items toward later pages (we dedupe), and lots that close are mostly
    the oldest listings at the end.
    """
    d = get("/v1/auctions/lots/", {"page": page, "per_page": LIST_PAGE_SIZE, "order_by": "newly-listed"}, token)
    return LotPage(count=int(d["count"]), results=[normalize_lot(r) for r in d["results"]])


def fetch_lost(token: str) -> list[Raw]:
    """Every closed lot you bid on and lost, as the API returns them (most recent first)."""
    out: list[Raw] = []
    page = 1
    while True:
        d = get("/v1/auctions/control-panel/closed/lost/", {"page": page, "per_page": LIST_PAGE_SIZE}, token)
        out += d["results"]
        if not d["results"] or len(out) >= int(d["count"]):
            return out
        page += 1


def now_ms() -> int:
    return round(time.time() * 1000)
