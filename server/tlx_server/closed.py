"""Fetch an account's won or lost lots, one normalized page at a time."""

from __future__ import annotations

import logging
import math
import threading
import time
from collections.abc import Generator, Iterator
from dataclasses import dataclass, field
from http import HTTPStatus
from typing import Any

from .session import SiteSession
from .site import LIST_PAGE_SIZE, ApiError, _epoch_ms, get

log = logging.getLogger(__name__)
CACHE_SECONDS = 120


@dataclass
class _Fetch:
    identity: str | None
    generation: int
    pages: list[dict[str, Any]] = field(default_factory=list)
    completed_at: float | None = None
    error: ApiError | None = None


class ClosedCache:
    """Share in-flight and completed account-specific fetches between clients."""

    def __init__(self, session: SiteSession) -> None:
        self.session = session
        self._changed = threading.Condition()
        self._generation = 0
        self._fetches: dict[str, _Fetch] = {}

    def invalidate(self) -> None:
        with self._changed:
            self._generation += 1
            self._fetches.clear()
            self._changed.notify_all()

    def counts(self) -> dict[str, int]:
        with self._changed:
            identity = self.session.status().get("email")
            return {
                section: sum(len(page["lots"]) for page in fetch.pages)
                for section, fetch in self._fetches.items()
                if self.session.logged_in
                and fetch.identity == identity
                and fetch.completed_at is not None
                and time.monotonic() - fetch.completed_at < CACHE_SECONDS
            }

    def pages(self, section: str) -> Generator[dict[str, Any], None, None]:
        if section not in ("won", "lost"):
            raise ValueError("Expected section=won or section=lost")
        if not self.session.token():
            raise ApiError("Log in to see your closed lots.", HTTPStatus.UNAUTHORIZED)
        identity = self.session.status().get("email")
        with self._changed:
            fetch = self._fetches.get(section)
            if (
                fetch is None
                or fetch.identity != identity
                or fetch.error is not None
                or (fetch.completed_at is not None and time.monotonic() - fetch.completed_at >= CACHE_SECONDS)
            ):
                fetch = _Fetch(identity, self._generation)
                self._fetches[section] = fetch
                threading.Thread(target=self._load, args=(section, fetch), daemon=True).start()

        index = 0
        while True:
            with self._changed:
                while True:
                    if fetch.generation != self._generation or not self.session.logged_in or self.session.status().get("email") != identity:
                        raise ApiError("Site login changed while loading closed lots.", HTTPStatus.UNAUTHORIZED)
                    if index < len(fetch.pages):
                        page = fetch.pages[index]
                        index += 1
                        break
                    if fetch.error is not None:
                        raise fetch.error
                    if fetch.completed_at is not None:
                        return
                    self._changed.wait()
            yield page

    def _load(self, section: str, fetch: _Fetch) -> None:
        try:
            for page in closed_pages(section, self.session):
                with self._changed:
                    if fetch.generation != self._generation:
                        return
                    fetch.pages.append(page)
                    if page["done"]:
                        fetch.completed_at = time.monotonic()
                    self._changed.notify_all()
            if fetch.completed_at is None:
                raise ApiError("The closed-lot response ended unexpectedly.", HTTPStatus.BAD_GATEWAY)
        except ApiError as exc:
            with self._changed:
                fetch.error = exc
                self._changed.notify_all()
        except Exception:
            log.exception("closed-lot fetch failed")
            with self._changed:
                fetch.error = ApiError("Couldn’t load closed lots from the site.", HTTPStatus.BAD_GATEWAY)
                self._changed.notify_all()


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
