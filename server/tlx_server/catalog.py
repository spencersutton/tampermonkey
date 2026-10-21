"""Full catalog pulls, with the same load rules the userscript follows on its own.

- A full pull happens at most once per interval (the synced `tlxSyncMinutes`
  setting, never under MIN_SYNC_MINUTES), measured from the start of the last
  pull, successful or not, so errors don't cause retries either.
- By default it only pulls while some /tlx tab is visible and has been used in
  the last ACTIVE_WINDOW (the userscript says so on each poll). With
  `background_minutes` set, it also pulls that often with no one watching, so
  saved searches keep counting new lots while the browser is closed.
- Pages are fetched one at a time, by a single puller thread.

Account fields (your standing, watchlist) come from the login token the
userscript forwards. It's kept in memory only. A pull made without one (the
token expired while no tab was open) keeps the account fields from the
previous pull rather than wiping them.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

from .site import LIST_PAGE_SIZE, ApiError, fetch_lot_page, now_ms, token_expiry
from .store import CatalogMeta, Store

log = logging.getLogger(__name__)

MINUTE_MS = 60_000
DEFAULT_SYNC_MINUTES = 5
MIN_SYNC_MINUTES = 1
ACTIVE_WINDOW_MS = 10 * MINUTE_MS  # pull only if a tab was in use this recently
CHECK_EVERY = 15  # seconds between checks whether a pull is due
TOKEN_MARGIN = 30  # seconds; a token this close to expiry isn't used
SYNC_MINUTES_KEY = "tlxSyncMinutes"  # same key as src/shared/keys.ts
ACCOUNT_FIELDS = ("yourStanding", "isWatchlisted", "hasBid")


@dataclass
class Progress:
    done: int
    total: int | None


class Catalog:
    def __init__(self, store: Store, background_minutes: float = 0) -> None:
        self.store = store
        self.background_ms = background_minutes * MINUTE_MS
        self.progress: Progress | None = None
        self.error: str | None = None
        self._last_active = 0.0  # epoch ms of the last poll from a tab in use
        self._token: str | None = None
        self._token_lock = threading.Lock()
        self._requested = False
        self._wake = threading.Event()

    # -- what clients tell us ---------------------------------------------------
    def heartbeat(self, active: bool, token: str | None) -> None:
        """Record a poll: whether the tab is in use, and its login token ("" = logged out, None = not sent)."""
        if token is not None:
            with self._token_lock:
                self._token = token or None
        if active:
            self._last_active = now_ms()
            if self.due():
                self._wake.set()

    def _usable_token(self) -> str | None:
        with self._token_lock:
            exp = token_expiry(self._token)
            return self._token if self._token and (exp is None or exp - TOKEN_MARGIN > time.time()) else None

    def _reject_token(self, token: str) -> None:
        with self._token_lock:
            if self._token == token:
                self._token = None

    # -- schedule ---------------------------------------------------------------
    def interval_ms(self) -> float:
        """Minimum time between full pulls, from the synced setting."""
        m = self.store.setting(SYNC_MINUTES_KEY, DEFAULT_SYNC_MINUTES)
        m = m if isinstance(m, (int, float)) and not isinstance(m, bool) else DEFAULT_SYNC_MINUTES
        return max(MIN_SYNC_MINUTES, m) * MINUTE_MS

    def next_pull_at(self, meta: CatalogMeta | None = None) -> float:
        """Epoch ms when the next full pull is allowed."""
        meta = meta or self.store.meta()
        return 0 if meta.pullStartedAt is None else meta.pullStartedAt + self.interval_ms()

    def due(self) -> bool:
        return now_ms() >= self.next_pull_at()

    def _wanted(self, meta: CatalogMeta) -> bool:
        now = now_ms()
        if self._requested or now - self._last_active <= ACTIVE_WINDOW_MS:
            return True
        if self.background_ms:
            started = meta.pullStartedAt or 0
            return now >= started + max(self.interval_ms(), self.background_ms)
        return False

    def request_pull(self) -> str:
        """The Refresh button: start a pull now if one is allowed."""
        if self.progress:
            return "busy"
        if not self.due():
            return "not-due"
        self._requested = True
        self._wake.set()
        return "started"

    def run_forever(self) -> None:
        while True:
            self._wake.wait(CHECK_EVERY)
            self._wake.clear()
            meta = self.store.meta()
            if now_ms() >= self.next_pull_at(meta) and self._wanted(meta):
                self._requested = False
                try:
                    self.pull()
                except Exception:  # keep the thread alive no matter what
                    log.exception("pull crashed")

    # -- the pull -------------------------------------------------------------
    def pull(self) -> None:
        """Fetch every catalog page, merge with what we have, and store the result."""
        started = now_ms()
        self.store.write_meta(pullStartedAt=started)
        prev = self.store.all_lots()
        first_load = not prev
        token = self._usable_token()
        self.error = None
        self.progress = Progress(0, None)
        log.info("pull started (%s)", "logged in" if token else "anonymous")

        def stamp(lot: dict[str, Any], authed: bool) -> dict[str, Any]:
            # Lots not in the previous pull are new (saved searches count them);
            # on the very first pull everything is treated as already listed.
            old = prev.get(lot["id"])
            lot["firstSeenAt"] = (old.get("firstSeenAt") or 0) if old else (0 if first_load else started)
            if not authed and old:
                lot.update({k: old.get(k) for k in ACCOUNT_FIELDS})
            return lot

        try:
            pulled: dict[int, dict[str, Any]] = {}
            pages, count, page = 1, 0, 1
            while page <= pages:
                try:
                    d = fetch_lot_page(page, token)
                except ApiError as e:
                    if e.status != 401 or not token:
                        raise
                    # The token was rejected: start over without it, so every page agrees.
                    log.info("token rejected; pulling anonymously")
                    self._reject_token(token)
                    token, pulled, pages, page = None, {}, 1, 1
                    continue
                if page == 1:
                    count = d.count
                    pages = max(1, -(-d.count // LIST_PAGE_SIZE))
                for lot in d.results:
                    pulled[lot["id"]] = stamp(lot, token is not None)
                self.progress = Progress(len(pulled), count)
                if not d.results:
                    break
                page += 1

            # If lots closed mid-pull, page boundaries shift and a few lots can be
            # skipped; keep still-open ones from the previous pull until next time.
            if len(pulled) < count:
                now = now_ms()
                for i, lot in prev.items():
                    if i not in pulled and (lot.get("endsAt") or 0) > now:
                        pulled[i] = lot

            seq = self.store.replace_all(pulled.values(), fetchedAt=now_ms(), count=count, authed=token is not None)
            log.info("pull done: %d lots in %.1fs (seq %d)", len(pulled), (now_ms() - started) / 1000, seq)
        except Exception as e:
            self.error = f"Catalog refresh failed: {e}"
            log.warning(self.error)
        finally:
            self.progress = None
