"""SQLite storage: the catalog (one row per lot), catalog meta, and synced settings.

Every full pull that changes anything gets a new sequence number, and each lot
row records the sequence of its last change, so a client that has seen
sequence N only needs the rows with seq > N (plus the current id list, to
drop lots that are gone).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS lots (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lots_seq ON lots (seq);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL);
"""


def dumps(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


@dataclass
class CatalogMeta:
    fetchedAt: float | None = None  # when the last complete pull finished (epoch ms)
    pullStartedAt: float | None = None  # when the last pull (successful or not) started – rate limit anchor
    count: int = 0  # lot count the API reported in the last complete pull
    authed: bool = False  # whether that pull carried account data


@dataclass
class CatalogChanges:
    seq: int
    lots: list[str]  # JSON text of each changed lot
    ids: list[int]  # every lot id currently stored


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()

    # -- meta -----------------------------------------------------------------
    def _get(self, key: str, default: Any = None) -> Any:
        row = self._db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def _set(self, key: str, value: Any) -> None:
        self._db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, dumps(value)))

    def meta(self) -> CatalogMeta:
        with self._lock:
            return CatalogMeta(**{**asdict(CatalogMeta()), **self._get("catalog", {})})

    def write_meta(self, **patch: Any) -> CatalogMeta:
        with self._lock:
            merged = {**asdict(CatalogMeta()), **self._get("catalog", {}), **patch}
            self._set("catalog", merged)
            return CatalogMeta(**merged)

    # -- catalog --------------------------------------------------------------
    def seq(self) -> int:
        with self._lock:
            return int(self._get("seq", 0))

    def all_lots(self) -> dict[int, dict[str, Any]]:
        """Every stored lot, parsed (used by a pull to merge with what it fetched)."""
        with self._lock:
            return {i: json.loads(d) for i, d in self._db.execute("SELECT id, data FROM lots")}

    def replace_all(self, lots: Iterable[dict[str, Any]], **meta: Any) -> int:
        """Store a full pull: changed rows get the next sequence, missing ones are dropped. Returns the sequence."""
        with self._lock:
            old = dict(self._db.execute("SELECT id, data FROM lots"))
            seq = int(self._get("seq", 0))
            fresh = {lot["id"]: dumps(lot) for lot in lots}
            changed = [(i, d) for i, d in fresh.items() if old.get(i) != d]
            gone = [(i,) for i in old.keys() - fresh.keys()]
            self._db.execute("BEGIN")
            try:
                if changed or gone:
                    seq += 1
                    self._db.executemany("INSERT OR REPLACE INTO lots (id, seq, data) VALUES (?, ?, ?)", [(i, seq, d) for i, d in changed])
                    self._db.executemany("DELETE FROM lots WHERE id = ?", gone)
                    self._set("seq", seq)
                self._set("catalog", {**asdict(CatalogMeta()), **self._get("catalog", {}), **meta})
                self._db.execute("COMMIT")
            except BaseException:
                self._db.execute("ROLLBACK")
                raise
            return seq

    def changes(self, since: int) -> CatalogChanges:
        """Lots changed after sequence `since` (all of them for 0) and the current id list."""
        with self._lock:
            seq = int(self._get("seq", 0))
            if since > seq:  # the client saw a newer (since reset) database: send everything
                since = 0
            lots = [d for (d,) in self._db.execute("SELECT data FROM lots WHERE seq > ?", (since,))]
            ids = [i for (i,) in self._db.execute("SELECT id FROM lots")]
            return CatalogChanges(seq=seq, lots=lots, ids=ids)

    # -- settings -------------------------------------------------------------
    def settings(self, since: int = 0) -> tuple[int, dict[str, Any]]:
        """The settings revision and every setting changed after `since`."""
        with self._lock:
            rev = int(self._get("settingsRev", 0))
            if since > rev:
                since = 0
            rows = self._db.execute("SELECT key, value FROM settings WHERE rev > ?", (since,))
            return rev, {k: json.loads(v) for k, v in rows}

    def setting(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            return json.loads(row[0]) if row else default

    def put_setting(self, key: str, value: Any) -> int:
        """Save a setting (last write wins) and return the new settings revision."""
        with self._lock:
            rev = int(self._get("settingsRev", 0)) + 1
            self._db.execute("BEGIN")
            self._db.execute("INSERT OR REPLACE INTO settings (key, value, rev) VALUES (?, ?, ?)", (key, dumps(value), rev))
            self._set("settingsRev", rev)
            self._db.execute("COMMIT")
            return rev
