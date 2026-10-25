"""SQLite storage: the catalog, catalog meta, synced settings, the site login
cookies, sessions of this app's own password login, the item type of each lot
title (itemtypes.py), and every lot that has left the catalog, with its final
price (history.py).

A lot is a row of `lots` with its site category, condition and location in
lookup tables, its images in `lot_images`, its item type joined from
`item_types` by title, and its most recent past closes in `lot_past_closes`,
pointing at `closed_lots`. The store hands lots out, and takes them in, as one
dict each, in the shape the app gets them (Lot in src/app/types.ts).

Every full pull that changes anything gets a new sequence number, and each lot
row records the sequence of its last change, so a client that has seen
sequence N only needs the rows with seq > N (plus the current id list, to
drop lots that are gone).
"""

from __future__ import annotations

import copy
import json
import sqlite3
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (value TEXT PRIMARY KEY, label TEXT);
CREATE TABLE IF NOT EXISTS conditions (value INTEGER PRIMARY KEY, label TEXT);
CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS lots (
  id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, auction_period TEXT, title TEXT NOT NULL, lot_number TEXT NOT NULL,
  category TEXT REFERENCES categories, condition INTEGER REFERENCES conditions, location INTEGER REFERENCES locations,
  is_transferable INTEGER NOT NULL, transfer_fee NUMERIC, current_price NUMERIC, estimated_retail_price NUMERIC,
  ends_at INTEGER, status TEXT, version INTEGER, bid_count INTEGER, next_min_increment NUMERIC,
  is_leading INTEGER, your_max_bid NUMERIC, is_watchlisted INTEGER NOT NULL, has_bid INTEGER NOT NULL,
  first_seen_at INTEGER, past_close_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lots_seq ON lots (seq);
CREATE INDEX IF NOT EXISTS lots_title ON lots (title);
CREATE TABLE IF NOT EXISTS lot_images (
  lot_id INTEGER NOT NULL REFERENCES lots, position INTEGER NOT NULL, thumb TEXT, card TEXT, large TEXT, PRIMARY KEY (lot_id, position)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS lot_past_closes (
  lot_id INTEGER NOT NULL REFERENCES lots, rank INTEGER NOT NULL, closed_id INTEGER NOT NULL, PRIMARY KEY (lot_id, rank)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS lot_past_closes_closed ON lot_past_closes (closed_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS app_sessions (id TEXT PRIMARY KEY, created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS item_types (title TEXT PRIMARY KEY, type TEXT NOT NULL, category TEXT, at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS item_types_category ON item_types (category);
CREATE TABLE IF NOT EXISTS closed_lots (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, auction_period TEXT, ends_at INTEGER, price REAL, bid_count INTEGER,
  sold INTEGER NOT NULL, final INTEGER NOT NULL, condition TEXT, location TEXT, category TEXT, retail REAL
);
CREATE INDEX IF NOT EXISTS closed_lots_pending ON closed_lots (final, ends_at);
"""

# lots: is_leading and your_max_bid are null without a standing; past_close_count
# counts every matching closed lot, lot_past_closes holds the most recent few.
LOT_COLUMNS = (
    "id, seq, auction_period, title, lot_number, category, condition, location, is_transferable, transfer_fee, current_price, "
    "estimated_retail_price, ends_at, status, version, bid_count, next_min_increment, is_leading, your_max_bid, is_watchlisted, "
    "has_bid, first_seen_at, past_close_count"
)


def lot_row(lot: dict[str, Any], seq: int) -> tuple[Any, ...]:
    """A lot as a lots row (LOT_COLUMNS order)."""
    s = lot.get("yourStanding")
    return (
        lot["id"],
        seq,
        lot.get("auctionPeriod"),
        lot.get("title") or "",
        lot.get("lotNumber") or "",
        (lot.get("category") or {}).get("value"),
        (lot.get("condition") or {}).get("value"),
        (lot.get("location") or {}).get("id"),
        int(bool(lot.get("isTransferable"))),
        lot.get("transferFee"),
        lot.get("currentPrice"),
        lot.get("estimatedRetailPrice"),
        lot.get("endsAt"),
        lot.get("status"),
        lot.get("version"),
        lot.get("bidCount"),
        lot.get("nextMinIncrement"),
        None if s is None else int(bool(s.get("isLeading"))),
        None if s is None else s.get("yourMaxBid"),
        int(bool(lot.get("isWatchlisted"))),
        int(bool(lot.get("hasBid"))),
        lot.get("firstSeenAt"),
        (lot.get("pastCloses") or {}).get("n", 0),
    )


# closed_lots.final: the price is the site's final one (1), the last one a pull saw
# and the site no longer has the lot (-1), or the last one seen, to be asked for (0).
CLOSED_COLUMNS = "id, title, auction_period, ends_at, price, bid_count, sold, final, condition, location, category, retail"


def closed_row(lot: dict[str, Any], final: int) -> tuple[Any, ...]:
    """A lot as a closed_lots row (CLOSED_COLUMNS order). Until the final price is known, a lot with bids counts as sold."""
    sold = lot.get("status") == "sold" if final == 1 else (lot.get("bidCount") or 0) > 0
    return (
        lot["id"],
        lot.get("title") or "",
        lot.get("auctionPeriod"),
        lot.get("endsAt"),
        lot.get("currentPrice"),
        lot.get("bidCount"),
        int(sold),
        final,
        (lot.get("condition") or {}).get("label"),
        (lot.get("location") or {}).get("name"),
        (lot.get("category") or {}).get("value"),
        lot.get("estimatedRetailPrice"),
    )


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
    lots: list[dict[str, Any]]  # each changed lot
    ids: list[int]  # every lot id currently stored


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._lock = threading.Lock()
        self._db.executescript(SCHEMA)
        path.chmod(0o600)  # holds the site login cookies

    @contextmanager
    def _tx(self) -> Iterator[None]:
        self._db.execute("BEGIN")
        try:
            yield
        except BaseException:
            self._db.execute("ROLLBACK")
            raise
        self._db.execute("COMMIT")

    # -- meta -----------------------------------------------------------------
    def _get(self, key: str, default: Any = None) -> Any:
        row = self._db.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def _set(self, key: str, value: Any) -> None:
        self._db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, dumps(value)))

    def get_meta(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._get(key, default)

    def set_meta(self, key: str, value: Any) -> None:
        with self._lock:
            self._set(key, value)

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

    def _load(self, where: str = "", params: tuple[Any, ...] = ()) -> dict[int, dict[str, Any]]:
        """The lots matching `where` (on lots as l), assembled from their rows."""
        lots: dict[int, dict[str, Any]] = {}
        rows = self._db.execute(
            f"""SELECT l.id, l.auction_period, l.title, l.lot_number, l.category, c.label, l.condition, k.label, l.location, p.name,
              l.is_transferable, l.transfer_fee, l.current_price, l.estimated_retail_price, l.ends_at, l.status, l.version,
              l.bid_count, l.next_min_increment, l.is_leading, l.your_max_bid, l.is_watchlisted, l.has_bid, l.first_seen_at,
              t.type, l.past_close_count
            FROM lots l LEFT JOIN categories c ON c.value = l.category LEFT JOIN conditions k ON k.value = l.condition
              LEFT JOIN locations p ON p.id = l.location LEFT JOIN item_types t ON t.title = l.title {where}""",
            params,
        )
        for (i, period, title, number, cat, cat_label, cond, cond_label, loc, loc_name, transferable, fee, price, retail, ends,
             status, version, bids, increment, leading, max_bid, watched, has_bid, first_seen, item_type, n) in rows:  # fmt: skip
            lot = lots[i] = {
                "id": i,
                "auctionPeriod": period,
                "title": title,
                "lotNumber": number,
                "category": None if cat is None else {"value": cat, "label": cat_label},
                "condition": None if cond is None else {"value": cond, "label": cond_label},
                "location": None if loc is None else {"id": loc, "name": loc_name},
                "isTransferable": bool(transferable),
                "transferFee": fee,
                "currentPrice": price,
                "estimatedRetailPrice": retail,
                "endsAt": ends,
                "status": status,
                "version": version,
                "bidCount": bids,
                "nextMinIncrement": increment,
                "yourStanding": None if leading is None else {"isLeading": bool(leading), "yourMaxBid": max_bid},
                "isWatchlisted": bool(watched),
                "hasBid": bool(has_bid),
                "images": [],
            }
            if first_seen is not None:
                lot["firstSeenAt"] = first_seen
            if item_type is not None:
                lot["itemType"] = item_type
            if n:
                lot["pastCloses"] = {"n": n, "recent": []}
        if not lots:
            return lots
        ids = f"(SELECT l.id FROM lots l {where})"
        for i, thumb, card, large in self._db.execute(
            f"SELECT lot_id, thumb, card, large FROM lot_images WHERE lot_id IN {ids} ORDER BY lot_id, position", params
        ):
            lots[i]["images"].append({"thumb": thumb, "card": card, "large": large})
        for i, closed_id, price, ends, cond, sold, final in self._db.execute(
            f"""SELECT r.lot_id, c.id, c.price, c.ends_at, c.condition, c.sold, c.final FROM lot_past_closes r
              JOIN closed_lots c ON c.id = r.closed_id WHERE r.lot_id IN {ids} ORDER BY r.lot_id, r.rank""",
            params,
        ):
            if "pastCloses" in lots[i]:
                lots[i]["pastCloses"]["recent"].append(
                    {"id": closed_id, "price": price, "endsAt": ends, "condition": cond, "sold": bool(sold), "final": final == 1}
                )
        return lots

    def _write_lots(self, lots: list[dict[str, Any]], seq: int) -> None:
        """Store these lots under this sequence, replacing their old rows (in the caller's transaction)."""
        for table, key, label, field, name in (
            ("categories", "value", "label", "category", "label"),
            ("conditions", "value", "label", "condition", "label"),
            ("locations", "id", "name", "location", "name"),
        ):
            values = {(v[key], v.get(name)) for lot in lots if (v := lot.get(field)) and v.get(key) is not None}
            self._db.executemany(
                f"INSERT INTO {table} ({key}, {label}) VALUES (?, ?) ON CONFLICT ({key}) DO UPDATE SET {label} = excluded.{label}", values
            )
        ids = [(lot["id"],) for lot in lots]
        self._db.executemany("DELETE FROM lot_images WHERE lot_id = ?", ids)
        self._db.executemany("DELETE FROM lot_past_closes WHERE lot_id = ?", ids)
        self._db.executemany(
            f"INSERT OR REPLACE INTO lots ({LOT_COLUMNS}) VALUES ({', '.join('?' * 23)})", [lot_row(lot, seq) for lot in lots]
        )
        self._db.executemany(
            "INSERT INTO lot_images (lot_id, position, thumb, card, large) VALUES (?, ?, ?, ?, ?)",
            [
                (lot["id"], n, im.get("thumb"), im.get("card"), im.get("large"))
                for lot in lots
                for n, im in enumerate(lot.get("images") or [])
            ],
        )
        self._db.executemany(
            "INSERT INTO lot_past_closes (lot_id, rank, closed_id) VALUES (?, ?, ?)",
            [(lot["id"], n, c["id"]) for lot in lots for n, c in enumerate((lot.get("pastCloses") or {}).get("recent", []))],
        )

    def _delete_lots(self, ids: Iterable[int]) -> None:
        rows = [(i,) for i in ids]
        for table, col in (("lot_images", "lot_id"), ("lot_past_closes", "lot_id"), ("lots", "id")):
            self._db.executemany(f"DELETE FROM {table} WHERE {col} = ?", rows)

    def _touch_closes(self, closed_ids: Iterable[int]) -> None:
        """Give the lots listing any of these closed lots among their past closes a new sequence (what they show changed)."""
        seq = int(self._get("seq", 0)) + 1
        before = self._db.total_changes
        self._db.executemany(
            "UPDATE lots SET seq = ? WHERE id IN (SELECT lot_id FROM lot_past_closes WHERE closed_id = ?)", [(seq, i) for i in closed_ids]
        )
        if self._db.total_changes > before:
            self._set("seq", seq)

    def all_lots(self) -> dict[int, dict[str, Any]]:
        """Every stored lot (used by a pull to merge with what it fetched)."""
        with self._lock:
            return self._load()

    def lot(self, lot_id: int) -> dict[str, Any] | None:
        with self._lock:
            return self._load("WHERE l.id = ?", (lot_id,)).get(lot_id)

    def replace_all(self, lots: Iterable[dict[str, Any]], **meta: Any) -> int:
        """Store a full pull: changed lots get the next sequence, missing ones move to closed_lots. Returns the sequence."""
        with self._lock:
            old = self._load()
            seq = int(self._get("seq", 0))
            fresh = {lot["id"]: lot for lot in lots}
            changed = [lot for i, lot in fresh.items() if old.get(i) != lot]
            gone = old.keys() - fresh.keys()
            back = fresh.keys() - old.keys()  # usually new, but may have been taken for closed
            with self._tx():
                if changed or gone:
                    seq += 1
                    self._write_lots(changed, seq)
                    self._delete_lots(gone)
                    self._set("seq", seq)
                if gone or back:
                    self._db.executemany("DELETE FROM closed_lots WHERE id = ?", [(i,) for i in back])
                    self._touch_closes(back)
                    self._db.executemany(
                        f"INSERT OR REPLACE INTO closed_lots ({CLOSED_COLUMNS}) VALUES ({', '.join('?' * 12)})",
                        [closed_row(old[i], 0) for i in gone],
                    )
                    self._set("closedRev", int(self._get("closedRev", 0)) + 1)
                self._set("catalog", {**asdict(CatalogMeta()), **self._get("catalog", {}), **meta})
            return int(self._get("seq", 0))

    def changes(self, since: int) -> CatalogChanges:
        """Lots changed after sequence `since` (all of them for 0) and the current id list."""
        with self._lock:
            seq = int(self._get("seq", 0))
            if since > seq:  # the client saw a newer (since reset) database: send everything
                since = 0
            lots = list(self._load("WHERE l.seq > ?", (since,)).values())
            ids = [i for (i,) in self._db.execute("SELECT id FROM lots")]
            return CatalogChanges(seq=seq, lots=lots, ids=ids)

    def update_lots(self, fn: Callable[[dict[str, Any]], dict[str, Any]]) -> int:
        """Replace each stored lot with fn(lot), giving the changed ones a new sequence. Returns how many changed."""
        with self._lock:
            seq = int(self._get("seq", 0)) + 1
            changed = [new for lot in self._load().values() if (new := fn(copy.deepcopy(lot))) != lot]
            if changed:
                with self._tx():
                    self._write_lots(changed, seq)
                    self._set("seq", seq)
            return len(changed)

    # -- closed lots ----------------------------------------------------------
    def closed_rev(self) -> int:
        """Goes up whenever closed_lots changes."""
        with self._lock:
            return int(self._get("closedRev", 0))

    def closed_lots(self) -> list[dict[str, Any]]:
        """Every closed lot, in the shape the app gets them (see PastClose in src/app/types.ts)."""
        with self._lock:
            rows = self._db.execute(f"SELECT {CLOSED_COLUMNS} FROM closed_lots").fetchall()
        return [
            {
                "id": i,
                "title": title,
                "auctionPeriod": period,
                "endsAt": ends,
                "price": price,
                "bidCount": bids,
                "sold": bool(sold),
                "final": final == 1,
                "condition": cond,
                "location": loc,
                "category": cat,
                "retail": retail,
            }
            for i, title, period, ends, price, bids, sold, final, cond, loc, cat, retail in rows
        ]

    def pending_closes(self, now: float) -> list[dict[str, Any]]:
        """Closed lots (ended before `now`, epoch ms) whose final price hasn't been asked for yet, oldest first."""
        with self._lock:
            rows = self._db.execute(
                "SELECT id, auction_period FROM closed_lots WHERE final = 0 AND ends_at <= ? ORDER BY ends_at", (now,)
            ).fetchall()
        return [{"id": i, "auctionPeriod": p} for i, p in rows]

    def finish_close(self, lot_id: int, lot: dict[str, Any] | None) -> None:
        """Record a closed lot's final state from the site, or with None, that the site no longer has it."""
        with self._lock, self._tx():
            if lot:
                self._db.execute(
                    f"INSERT OR REPLACE INTO closed_lots ({CLOSED_COLUMNS}) VALUES ({', '.join('?' * 12)})", closed_row(lot, 1)
                )
                self._touch_closes([lot_id])
            else:
                self._db.execute("UPDATE closed_lots SET final = -1 WHERE id = ?", (lot_id,))
            self._set("closedRev", int(self._get("closedRev", 0)) + 1)

    def drop_close(self, lot_id: int) -> None:
        """Forget a lot taken for closed that is still open."""
        with self._lock, self._tx():
            self._db.execute("DELETE FROM closed_lots WHERE id = ?", (lot_id,))
            self._touch_closes([lot_id])
            self._set("closedRev", int(self._get("closedRev", 0)) + 1)

    # -- item types -----------------------------------------------------------
    def item_types(self, titles: Iterable[str]) -> dict[str, str]:
        """The stored item type of each of these titles that has one."""
        with self._lock:
            known = dict(self._db.execute("SELECT title, type FROM item_types"))
        return {t: known[t] for t in titles if t in known}

    def untyped_lots(self) -> dict[str, dict[str, Any] | None]:
        """Titles of stored lots without an item type, with each one's site category."""
        with self._lock:
            rows = self._db.execute(
                """SELECT l.title, l.category, c.label FROM lots l LEFT JOIN categories c ON c.value = l.category
                WHERE NOT EXISTS (SELECT 1 FROM item_types t WHERE t.title = l.title)"""
            ).fetchall()
        return {title: None if cat is None else {"value": cat, "label": label} for title, cat, label in rows}

    def common_types(self, category: str | None, limit: int) -> list[str]:
        """The item types given most often to titles in a site category."""
        with self._lock:
            rows = self._db.execute(
                "SELECT type FROM item_types WHERE category IS ? GROUP BY type ORDER BY count(*) DESC, type LIMIT ?", (category, limit)
            )
            return [t for (t,) in rows]

    def save_item_types(self, types: dict[str, tuple[str, str | None]]) -> None:
        """Store {title: (type, site category)}, giving the lots whose item type that changes a new sequence."""
        if not types:
            return
        with self._lock, self._tx():
            seq = int(self._get("seq", 0)) + 1
            before = self._db.total_changes
            self._db.executemany(
                "UPDATE lots SET seq = ? WHERE title = ? AND NOT EXISTS (SELECT 1 FROM item_types WHERE title = ? AND type = ?)",
                [(seq, title, title, t) for title, (t, _) in types.items()],
            )
            if self._db.total_changes > before:
                self._set("seq", seq)
            now = time.time()
            self._db.executemany(
                "INSERT OR REPLACE INTO item_types (title, type, category, at) VALUES (?, ?, ?, ?)",
                [(title, t, cat, now) for title, (t, cat) in types.items()],
            )

    def reset_item_types(self) -> int:
        """Forget every stored item type, giving the lots that had one a new sequence. Returns how many titles had one."""
        with self._lock, self._tx():
            seq = int(self._get("seq", 0)) + 1
            (n,) = self._db.execute("SELECT count(*) FROM item_types").fetchone()
            before = self._db.total_changes
            self._db.execute("UPDATE lots SET seq = ? WHERE title IN (SELECT title FROM item_types)", (seq,))
            if self._db.total_changes > before:
                self._set("seq", seq)
            self._db.execute("DELETE FROM item_types")
            return n

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

    # -- app sessions -----------------------------------------------------------
    def add_session(self, sid: str) -> None:
        with self._lock:
            self._db.execute("INSERT INTO app_sessions (id, created) VALUES (?, ?)", (sid, time.time()))

    def has_session(self, sid: str, max_age: float) -> bool:
        with self._lock:
            row = self._db.execute("SELECT created FROM app_sessions WHERE id = ?", (sid,)).fetchone()
            return bool(row) and time.time() - row[0] < max_age

    def drop_session(self, sid: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM app_sessions WHERE id = ?", (sid,))
