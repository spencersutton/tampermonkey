"""Past closing prices: what earlier lots with the same (or nearly the same)
name closed at.

When a lot leaves the catalog, the store keeps a slim row of it in
`closed_lots` with the last price a pull saw. Lots get most of their bids in
the last minutes, so after each pull the closer thread asks the site for each
newly closed lot once (one request at a time, a short pause between), and
records its final price and whether it sold. Closed lots are kept for good;
at about 200 bytes each that's well under 100 MB a year.

Each open lot gets `pastCloses`: how many closed lots match its name and the
most recent few of them, so a card can show what the item usually goes for.
GET /api/history?id=N lists every match for the lot popup.

Names match fuzzily, by `names_match`, which src/shared/names.ts mirrors for
combining duplicate listings in the app. How fuzzy is the synced
`tlxNameMatch` setting: the share of words two titles must have in common,
100 meaning the same words (ignoring case, punctuation and word order).
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
from collections import Counter, defaultdict
from collections.abc import Iterable
from typing import Any

from .site import ApiError, get, normalize_detail, normalize_lot
from .store import Store

log = logging.getLogger(__name__)

NAME_MATCH_KEY = "tlxNameMatch"  # same key as src/shared/keys.ts
DEFAULT_NAME_MATCH = 90
MIN_NAME_MATCH = 50
RECENT = 8  # closes attached to each lot
HISTORY_LIMIT = 200  # closes listed in the lot popup
DETAIL_PAUSE = 0.5  # seconds between final-price requests

_QTY = re.compile(r"\bqty\.?\s*([0-9]+)")
_TOKEN = re.compile(r"qty[0-9]+|[0-9]+(?:[./][0-9]+)*|[a-z]+")


def name_tokens(title: str) -> frozenset[str]:
    """The words of a title for matching: lowercase letters runs and numbers ("4.0", "1/2"), with "Qty 3" as one word."""
    return frozenset(_TOKEN.findall(_QTY.sub(r" qty\1 ", title.lower())))


def names_match(a: frozenset[str], b: frozenset[str], min_pct: float) -> bool:
    """Whether two titles' words are close enough: the same words, or (below 100%)
    at least `min_pct`% of all their words in common and no number that only one has
    (so "10 oz." never matches "29 oz.", nor "Qty 4" "Qty 6")."""
    if a == b:
        return bool(a)
    if min_pct >= 100 or not a or not b:
        return False
    diff = a ^ b
    if any(any(c.isdigit() for c in t) for t in diff):
        return False
    return len(a & b) * 100 >= min_pct * len(a | b)


def name_match_pct(value: object) -> float:
    """The `tlxNameMatch` setting as a percentage, defaulted and clamped."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return DEFAULT_NAME_MATCH
    return min(100, max(MIN_NAME_MATCH, value))


class NameIndex:
    """Finds which of many token sets match a given one, without comparing to each.

    Prefix filtering: with the words of every set in one fixed order (rarest
    first), two sets with at least t of their words in common must share one
    of the first |x| - ceil(t·|x|) + 1 words of each. Only those prefixes are
    indexed and probed; candidates are then checked in full.
    """

    def __init__(self, keys: Iterable[frozenset[str]], min_pct: float) -> None:
        self.keys = [k for k in keys if k]
        self.min_pct = min_pct
        self._freq = Counter(t for k in self.keys for t in k)
        self._postings: dict[str, list[int]] = defaultdict(list)
        for i, k in enumerate(self.keys):
            for t in self._prefix(k):
                self._postings[t].append(i)

    def _prefix(self, k: frozenset[str]) -> list[str]:
        ordered = sorted(k, key=lambda t: (self._freq.get(t, 0), t))
        return ordered[: len(k) - math.ceil(len(k) * min(self.min_pct, 100) / 100) + 1]

    def matches(self, k: frozenset[str]) -> list[frozenset[str]]:
        if not k:
            return []
        seen: set[int] = set()
        out = []
        for t in self._prefix(k):
            for i in self._postings.get(t, ()):
                if i not in seen:
                    seen.add(i)
                    if names_match(k, self.keys[i], self.min_pct):
                        out.append(self.keys[i])
        return out


def _close(row: dict[str, Any]) -> dict[str, Any]:
    """A closed lot as attached to an open lot's `pastCloses`."""
    return {
        "id": row["id"],
        "price": row["price"],
        "endsAt": row["endsAt"],
        "condition": row["condition"],
        "sold": row["sold"],
        "final": row["final"],
    }


class History:
    def __init__(self, store: Store) -> None:
        self.store = store
        self._wake = threading.Event()
        self._cache: tuple[tuple[int, float], NameIndex, dict[frozenset[str], list[dict[str, Any]]]] | None = None
        self._cache_lock = threading.Lock()

    # -- matching ---------------------------------------------------------------
    def _index(self) -> tuple[NameIndex, dict[frozenset[str], list[dict[str, Any]]]]:
        """The index of closed lot names and the closed lots under each, rebuilt when either changed."""
        version = (self.store.closed_rev(), name_match_pct(self.store.setting(NAME_MATCH_KEY)))
        with self._cache_lock:
            if self._cache and self._cache[0] == version:
                return self._cache[1], self._cache[2]
            by_key: dict[frozenset[str], list[dict[str, Any]]] = defaultdict(list)
            for row in self.store.closed_lots():
                by_key[name_tokens(row["title"])].append(row)
            for rows in by_key.values():
                rows.sort(key=lambda r: -(r["endsAt"] or 0))
            index = NameIndex(by_key, version[1])
            self._cache = (version, index, by_key)
            return index, by_key

    def closes_for(self, lot: dict[str, Any]) -> list[dict[str, Any]]:
        """Closed lots matching this lot's name, most recent first."""
        return self._closes_for(lot, *self._index())

    @staticmethod
    def _closes_for(lot: dict[str, Any], index: NameIndex, by_key: dict[frozenset[str], list[dict[str, Any]]]) -> list[dict[str, Any]]:
        rows = [r for m in index.matches(name_tokens(lot["title"])) for r in by_key[m] if r["id"] != lot["id"]]
        rows.sort(key=lambda r: -(r["endsAt"] or 0))
        return rows

    def annotate(self, lots: Iterable[dict[str, Any]]) -> None:
        """Set (or drop) `pastCloses` on each lot."""
        index, by_key = self._index()
        for lot in lots:
            self._annotate(lot, index, by_key)

    @classmethod
    def _annotate(cls, lot: dict[str, Any], index: NameIndex, by_key: dict[frozenset[str], list[dict[str, Any]]]) -> None:
        if rows := cls._closes_for(lot, index, by_key):
            lot["pastCloses"] = {"n": len(rows), "recent": [_close(r) for r in rows[:RECENT]]}
        else:
            lot.pop("pastCloses", None)

    def refresh(self) -> None:
        """Re-annotate the stored lots (after closes were added or the setting changed)."""
        index, by_key = self._index()  # outside the store lock, which update_lots holds

        def update(lot: dict[str, Any]) -> dict[str, Any]:
            out = dict(lot)
            self._annotate(out, index, by_key)
            return out

        if n := self.store.update_lots(update):
            log.info("past closes changed on %d lots", n)

    # -- final prices -------------------------------------------------------------
    def wake(self) -> None:
        self._wake.set()

    def run_forever(self) -> None:
        while True:
            self._wake.wait()
            self._wake.clear()
            try:
                self.finalize()
                self.refresh()
            except Exception:  # keep the thread alive no matter what
                log.exception("recording closed lots crashed")

    def finalize(self) -> None:
        """Ask the site for the final price of every closed lot that doesn't have one yet."""
        pending = self.store.pending_closes(time.time() * 1000)
        if not pending:
            return
        log.info("fetching final prices of %d closed lots", len(pending))
        done = 0
        for row in pending:
            try:
                raw = get(f"/v1/auctions/lots/{row['auctionPeriod']}/{row['id']}/")
            except ApiError as e:
                if e.status == 404:  # gone from the site: keep the last price seen
                    self.store.finish_close(row["id"], None)
                    time.sleep(DETAIL_PAUSE)
                    continue
                log.warning("final prices stopped after %d of %d: %s", done, len(pending), e)
                return
            lot = normalize_lot(raw)
            self.store.save_lot_detail(normalize_detail(raw))
            if lot["status"] == "live" and (lot["endsAt"] or 0) > time.time() * 1000:
                self.store.drop_close(row["id"])  # back in the catalog: the next pull has it
            elif lot["status"] in ("sold", "unsold"):
                self.store.finish_close(row["id"], lot)
                done += 1
            time.sleep(DETAIL_PAUSE)
        log.info("recorded %d final prices", done)
