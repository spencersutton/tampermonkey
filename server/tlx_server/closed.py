"""Fetch an account's won or lost lots, one normalized page at a time."""

from __future__ import annotations

import math
from collections.abc import Iterator
from http import HTTPStatus
from typing import Any

from .session import SiteSession
from .site import LIST_PAGE_SIZE, ApiError, _epoch_ms, get


def normalize_closed(row: dict[str, Any]) -> dict[str, Any]:
    """Convert one control-panel result to the browser's ClosedLot shape."""
    location = row.get("location") or {}
    ends = next((row[key] for key in ("ends_at", "closed_at", "ended_at") if row.get(key) is not None), None)
    raw_price = row.get("final_price")
    price = float(raw_price if raw_price is not None else 0)
    if not math.isfinite(price):
        raise ValueError("invalid final price")
    lot_id = row.get("lot_id")
    return {
        "lotId": int(lot_id if lot_id is not None else row["id"]),
        "auctionPeriod": str(row.get("auction_period") if row.get("auction_period") is not None else ""),
        "title": str(row.get("title") if row.get("title") is not None else ""),
        "lotNumber": str(row.get("lot_number") if row.get("lot_number") is not None else ""),
        "locationName": row.get("location_name") if row.get("location_name") is not None else location.get("name"),
        "finalPrice": price,
        "heroImage": row.get("hero_image"),
        "endsAt": _epoch_ms(ends),
    }


def closed_pages(section: str, session: SiteSession) -> Iterator[dict[str, Any]]:
    """Yield newly seen lots as each upstream page arrives."""
    if section not in ("won", "lost"):
        raise ValueError("Expected section=won or section=lost")
    account = session.status()
    token = session.token()
    if not token:
        raise ApiError("Log in to see your closed lots.", HTTPStatus.UNAUTHORIZED)
    identity = account.get("email")
    seen: set[tuple[str, int]] = set()
    page = 1
    path = f"/v1/auctions/control-panel/closed/{section}/"
    while True:
        if not session.logged_in or session.status().get("email") != identity:
            raise ApiError("Site login changed while loading closed lots.", HTTPStatus.UNAUTHORIZED)
        try:
            data = get(path, {"page": page, "per_page": LIST_PAGE_SIZE}, token)
        except ApiError as exc:
            if exc.status != HTTPStatus.UNAUTHORIZED:
                raise
            token = session.rejected(token)
            if not token or session.status().get("email") != identity:
                raise ApiError("Site login expired while loading closed lots.", HTTPStatus.UNAUTHORIZED) from exc
            data = get(path, {"page": page, "per_page": LIST_PAGE_SIZE}, token)
        if not session.logged_in or session.status().get("email") != identity:
            raise ApiError("Site login changed while loading closed lots.", HTTPStatus.UNAUTHORIZED)
        try:
            count = int(data["count"])
            results = data["results"]
            if count < 0 or not isinstance(results, list):
                raise ValueError("invalid count or results")
            lots = []
            for row in results:
                lot = normalize_closed(row)
                key = (lot["auctionPeriod"], lot["lotId"])
                if key not in seen:
                    seen.add(key)
                    lots.append(lot)
        except (AttributeError, KeyError, TypeError, ValueError, OverflowError) as exc:
            raise ApiError("Invalid closed-lot response from the site.", HTTPStatus.BAD_GATEWAY) from exc
        done = not results or len(seen) >= count
        yield {"lots": lots, "count": count, "done": done}
        if done:
            return
        page += 1
