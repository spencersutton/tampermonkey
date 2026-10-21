"""Run the server: python -m tlx_server [--port 8765] [--background-minutes 30] ..."""

from __future__ import annotations

import argparse
import logging
import os
import threading
from pathlib import Path

from .catalog import Catalog
from .server import Api, serve
from .store import Store

DEFAULT_DB = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "tlx-server" / "tlx.db"


def main() -> None:
    p = argparse.ArgumentParser(prog="tlx-server", description=__doc__)
    p.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite file (default {DEFAULT_DB})")
    p.add_argument(
        "--background-minutes",
        type=float,
        default=0,
        help="also pull this often when no /tlx tab is in use (default 0 = only while one is)",
    )
    p.add_argument("--key", default=os.environ.get("TLX_KEY"), help="require this key from the userscript (or set TLX_KEY)")
    p.add_argument(
        "--allow-host",
        action="append",
        default=[],
        metavar="NAME",
        help="extra Host header to accept, e.g. this machine's name when not using localhost",
    )
    p.add_argument("-v", "--verbose", action="store_true", help="log every request")
    args = p.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    store = Store(args.db)
    catalog = Catalog(store, args.background_minutes)
    threading.Thread(target=catalog.run_forever, name="puller", daemon=True).start()
    try:
        serve(Api(store, catalog, args.key, set(args.allow_host)), args.host, args.port)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
