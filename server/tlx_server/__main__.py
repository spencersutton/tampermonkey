"""Run the tlx server: the /tlx catalog as a web app (phones included), backed by
its own catalog pulls, synced settings and login to the site.

  python -m tlx_server                                   # this machine only
  python -m tlx_server --host 0.0.0.0 --password ...     # reachable from your phone
"""

from __future__ import annotations

import argparse
import ipaddress
import logging
import os
import sys
import threading
from pathlib import Path

from .catalog import Catalog
from .history import History
from .itemtypes import DEFAULT_MODEL, DEFAULT_URL, Labeller
from .server import Api, serve
from .session import SiteSession
from .store import Store

DEFAULT_DB = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "tlx-server" / "tlx.db"


def is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def main() -> None:
    p = argparse.ArgumentParser(prog="tlx-server", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1; 0.0.0.0 for your phone)")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite file (default {DEFAULT_DB})")
    p.add_argument(
        "--password",
        default=os.environ.get("TLX_PASSWORD"),
        help="password for the app (or set TLX_PASSWORD); required unless listening on loopback only",
    )
    p.add_argument(
        "--background-minutes",
        type=float,
        default=0,
        help="also pull this often when no one has the app open (default 0 = only while it's in use)",
    )
    p.add_argument(
        "--llm-key",
        default=os.environ.get("TLX_LLM_KEY"),
        help="API key for naming each lot's item type (or set TLX_LLM_KEY); without one, lots get no item types",
    )
    p.add_argument(
        "--llm-url", default=os.environ.get("TLX_LLM_URL", DEFAULT_URL), help=f"OpenAI-compatible API base URL (default {DEFAULT_URL})"
    )
    p.add_argument(
        "--llm-model", default=os.environ.get("TLX_LLM_MODEL", DEFAULT_MODEL), help=f"model for item types (default {DEFAULT_MODEL})"
    )
    p.add_argument("--tls-cert", type=Path, help="serve HTTPS with this certificate (PEM)")
    p.add_argument("--tls-key", type=Path, help="private key for --tls-cert")
    p.add_argument("--allow-host", action="append", default=[], metavar="NAME", help="extra Host name to accept when there's no password")
    p.add_argument("-v", "--verbose", action="store_true", help="log every request")
    args = p.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if not args.password and not is_loopback(args.host):
        sys.exit("tlx-server: set --password (or TLX_PASSWORD) to listen beyond this machine; the server can bid as you.")
    if bool(args.tls_cert) != bool(args.tls_key):
        sys.exit("tlx-server: --tls-cert and --tls-key go together.")
    store = Store(args.db)
    session = SiteSession(store)
    history = History(store)
    catalog = Catalog(store, session, history, args.background_minutes)
    threading.Thread(target=catalog.run_forever, name="puller", daemon=True).start()
    threading.Thread(target=history.run_forever, name="closer", daemon=True).start()
    history.wake()  # finish what the last run left
    if args.llm_key:
        labeller = Labeller(store, args.llm_key, args.llm_url, args.llm_model)
        catalog.after_pull = labeller.wake
        threading.Thread(target=labeller.run_forever, name="item-types", daemon=True).start()
    api = Api(store, catalog, session, args.password, set(args.allow_host), tls=bool(args.tls_cert))
    try:
        serve(api, args.host, args.port, args.tls_cert, args.tls_key)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
