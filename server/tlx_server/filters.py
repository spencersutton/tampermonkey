"""Read and replace the synced regex filters (the `filterWords` setting) from
the command line, for tools like the /simplify-filters skill.

  python -m tlx_server.filters get                  # current list, one regex per line, plus its revision
  python -m tlx_server.filters diff < new.txt       # unified diff against the stored list; writes nothing
  python -m tlx_server.filters apply --rev N < new.txt

`apply` always backs up the whole database first (to backups/ next to it,
keeping the newest few), and refuses if the stored list changed since revision
N, so it never overwrites an edit made in the app after the diff was shown.
"""

from __future__ import annotations

import argparse
import difflib
import sqlite3
import sys
import time
from pathlib import Path

from .__main__ import DEFAULT_DB
from .store import Store

KEY = "filterWords"
KEEP_BACKUPS = 10


def stored(store: Store, key: str) -> tuple[list[str], int]:
    """The stored list and the settings revision it was last written at (0 if never)."""
    words = store.setting(key, [])
    row = store._db.execute("SELECT rev FROM settings WHERE key = ?", (key,)).fetchone()
    return list(words), row[0] if row else 0


def read_new() -> list[str]:
    words = [line.strip() for line in sys.stdin.read().splitlines()]
    words = [w for w in words if w]
    if not words:
        sys.exit("nothing on stdin; refusing to clear the list")
    return words


def show_diff(old: list[str], new: list[str]) -> bool:
    lines = list(difflib.unified_diff(old, new, "stored", "proposed", lineterm=""))
    print("\n".join(lines) if lines else "no changes")
    return bool(lines)


def backup(db: Path) -> Path:
    """Copy the live database (WAL included) with SQLite's backup API, then prune old copies."""
    folder = db.parent / "backups"
    folder.mkdir(mode=0o700, exist_ok=True)
    dest = folder / f"{db.stem}-{time.strftime('%Y%m%d-%H%M%S')}.db"
    src = sqlite3.connect(db)
    out = sqlite3.connect(dest)
    try:
        src.backup(out)
    finally:
        out.close()
        src.close()
    dest.chmod(0o600)  # holds the site login cookies
    for old in sorted(folder.glob(f"{db.stem}-*.db"))[:-KEEP_BACKUPS]:
        old.unlink()
    return dest


def main() -> None:
    p = argparse.ArgumentParser(prog="tlx_server.filters", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite file (default {DEFAULT_DB})")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("get", help="print the stored list")
    sub.add_parser("diff", help="diff stdin against the stored list")
    apply = sub.add_parser("apply", help="back up the database, then store the list from stdin")
    apply.add_argument("--rev", type=int, required=True, help="revision printed by get/diff; refuses if the list changed since")
    args = p.parse_args()

    if not args.db.exists():
        sys.exit(f"no database at {args.db}")
    store = Store(args.db)
    old, rev = stored(store, KEY)

    if args.cmd == "get":
        print(f"# rev {rev}, {len(old)} filters")
        print("\n".join(old))
    elif args.cmd == "diff":
        print(f"# rev {rev}")
        show_diff(old, read_new())
    else:
        new = read_new()
        if rev != args.rev:
            sys.exit(f"filters changed since rev {args.rev} (now rev {rev}); run diff again")
        if not show_diff(old, new):
            return
        print(f"backed up to {backup(args.db)}")
        print(f"saved {len(new)} filters (settings rev {store.put_setting(KEY, new)})")


if __name__ == "__main__":
    main()
