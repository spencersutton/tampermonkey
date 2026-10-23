"""Item types: a short plain name for what each lot is ("pressure washer",
"area rug"), so the app can sort lots by type and make a category of one type
in a click.

An LLM behind any OpenAI-compatible chat completions API names them (by
default Ministral 3 14B on nano-gpt.com). Types are stored by title, so a
relisted lot costs nothing, and labelling runs on its own thread after each
pull. Titles go in batches from one site category at a time, alphabetically,
with the types that category already uses, so the same kind of item gets the
same name. A failed request leaves the rest for the next run; lots without a
type yet just sort and categorize by title as before.

To try the prompt, or start over after changing it:

  TLX_LLM_KEY=... python -m tlx_server.itemtypes try [-n 80]   # label a random sample, print it, save nothing
  python -m tlx_server.itemtypes reset                          # forget every type; the server relabels on its next run
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import sys
import threading
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

from .site import USER_AGENT
from .store import Store

log = logging.getLogger(__name__)

DEFAULT_URL = "https://nano-gpt.com/api/v1"
DEFAULT_MODEL = "mistralai/ministral-14b-instruct-2512"
BATCH = 40  # titles per request
VOCAB = 100  # types already in use sent with each request
RETRY_SECONDS = 15 * 60  # how often to try again after a failure, with no pull to wake it
TIMEOUT = 60

PROMPT = """You name the kind of item in lot titles from a liquidation auction (customer returns and overstock from home improvement and big-box stores).

For each numbered title, reply with the same number and its item type: the plain, generic name a shopper would use for what the item is, so that every lot of the same kind gets exactly the same name.

Rules:
- Lowercase, singular, usually 1 to 3 words: "pressure washer", "area rug", "garbage disposal", "ceiling fan", "mini fridge", "toilet seat".
- Leave out brand, model, size, capacity, voltage, power source (cordless, electric, battery, gas), color, finish, material, style, quantity and pack count ("wall cabinet", not "plywood cabinet"; "lawn mower", not "electric lawn mower"). Keep a qualifier only when it makes a different kind of item ("mini fridge" is not a "refrigerator", "hammer drill" is not a "drill driver").
- Use the usual store name, not slang or a variant: "string trimmer", not "weed wacker"; "battery", not "battery pack".
- For parts and accessories, name the part, not what it fits, adding what it's for only when the part's name alone is vague: "surface cleaner", "drill bit set", "vacuum filter", "faucet cartridge", "band saw blade", "diamond blade".
- A power tool sold with batteries, a charger or a bag is still that tool: "Drill/Driver Kit with 2 Batteries" is a "drill driver". Batteries sold with a charger ("Battery and Charger Starter Kit") are a "battery". Two or more different power tools sold together are a "power tool combo kit".
- A set of bits, blades or hand tools is named for what's in it: "Drill & Drive Set (42-Pieces)" is a "drill bit set"; also "socket set", "screwdriver set".
- No slashes: "drill driver", not "drill/driver".
- Reuse a type from "Types already in use" whenever the item is that kind of thing; make up a new type only for a different kind of item.

Reply with one line per title, like "3: area rug", and nothing else."""


class LabelError(Exception):
    pass


def clean_type(text: str) -> str:
    """A reply's type, tidied: lowercase, no quotes or trailing punctuation, single spaces."""
    t = re.sub(r"\s+", " ", text.strip().strip("\"'`*").lower())
    return t.rstrip(".,;:").strip()[:60]


def parse_reply(reply: str, n: int) -> dict[int, str]:
    """{index: type} from lines like "3: area rug", for indexes 1..n."""
    out: dict[int, str] = {}
    for line in reply.splitlines():
        m = re.match(r"\s*(\d+)\s*[:.)\-]\s*(.+)", line)
        if m and 1 <= (i := int(m[1])) <= n and (t := clean_type(m[2])):
            out[i] = t
    return out


class Labeller:
    def __init__(self, store: Store, key: str, url: str = DEFAULT_URL, model: str = DEFAULT_MODEL) -> None:
        self.store = store
        self.key = key
        self.url = url.rstrip("/") + "/chat/completions"
        self.model = model
        self._wake = threading.Event()

    def wake(self) -> None:
        self._wake.set()

    def run_forever(self) -> None:
        while True:
            try:
                self.label_all()
            except Exception:  # keep the thread alive no matter what
                log.exception("item type labelling crashed")
            self._wake.wait(RETRY_SECONDS)
            self._wake.clear()

    def label_all(self) -> None:
        """Give every stored lot without an item type one: from an earlier title match if there is one, else from the model."""
        pending = self.store.untyped_lots()
        if not pending:
            return
        known = self.store.item_types(pending)
        self.store.save_item_types({t: (known[t], (pending[t] or {}).get("value")) for t in known})
        by_category: dict[str | None, list[str]] = defaultdict(list)
        labels: dict[str | None, str] = {}
        for title, cat in pending.items():
            if title not in known:
                value = (cat or {}).get("value")
                by_category[value].append(title)
                labels[value] = (cat or {}).get("label") or "Other"
        total = sum(map(len, by_category.values()))
        if not total:
            return
        log.info("labelling item types for %d titles", total)
        done = 0
        try:
            for value, titles in by_category.items():
                titles.sort(key=str.lower)  # similar items in the same batch
                for start in range(0, len(titles), BATCH):
                    batch = titles[start : start + BATCH]
                    types = self.ask(labels[value], batch, self.store.common_types(value, VOCAB))
                    self.store.save_item_types({batch[i - 1]: (t, value) for i, t in types.items()})
                    done += len(types)
        except LabelError as e:
            log.warning("item type labelling stopped after %d of %d titles: %s", done, total, e)
            return
        log.info("labelled %d of %d titles", done, total)

    def ask(self, category: str, titles: list[str], vocab: list[str]) -> dict[int, str]:
        """{1-based index into titles: type} from the model."""
        user = "\n".join(
            [
                f"Site category: {category}",
                f"Types already in use: {', '.join(vocab) if vocab else '(none yet)'}",
                "",
                "Titles:",
                *(f"{i}: {t}" for i, t in enumerate(titles, 1)),
            ]
        )
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": user}],
            "temperature": 0,
            "max_tokens": 16 * len(titles) + 50,
        }
        return parse_reply(self._complete(body), len(titles))

    def _complete(self, body: dict[str, Any]) -> str:
        req = urllib.request.Request(
            self.url,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.key}", "User-Agent": USER_AGENT},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
                d = json.loads(res.read())
            return d["choices"][0]["message"]["content"] or ""
        except urllib.error.HTTPError as e:
            raise LabelError(f"HTTP {e.code}: {e.read()[:300].decode(errors='replace')}") from e
        except (urllib.error.URLError, TimeoutError, ValueError, KeyError, IndexError) as e:
            raise LabelError(str(e)) from e


def main() -> None:
    from .__main__ import DEFAULT_DB

    p = argparse.ArgumentParser(prog="tlx_server.itemtypes", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite file (default {DEFAULT_DB})")
    sub = p.add_subparsers(dest="cmd", required=True)
    try_ = sub.add_parser("try", help="label a random sample of stored titles and print them; saves nothing")
    try_.add_argument("-n", type=int, default=BATCH * 2, help=f"titles to sample (default {BATCH * 2})")
    try_.add_argument("-c", "--category", help="sample only this site category (its value, e.g. tools or Building_Hardware)")
    sub.add_parser("reset", help="forget every stored item type")
    args = p.parse_args()

    if not args.db.exists():
        sys.exit(f"no database at {args.db}")
    store = Store(args.db)
    if args.cmd == "reset":
        n = store.reset_item_types()
        print(
            f"forgot the item types of {n} titles; a running server relabels them on its next run (after a pull, or within {RETRY_SECONDS // 60} minutes)"
        )
        return
    key = os.environ.get("TLX_LLM_KEY")
    if not key:
        sys.exit("set TLX_LLM_KEY")
    lab = Labeller(store, key, os.environ.get("TLX_LLM_URL", DEFAULT_URL), os.environ.get("TLX_LLM_MODEL", DEFAULT_MODEL))
    lots = list({lot["title"]: lot for lot in store.all_lots().values()}.values())
    if args.category:
        lots = [lot for lot in lots if (lot.get("category") or {}).get("value") == args.category]
    by_category: dict[str | None, list[dict[str, Any]]] = defaultdict(list)
    for lot in random.Random(0).sample(lots, min(args.n, len(lots))):  # the same sample each time, to compare prompts
        by_category[(lot.get("category") or {}).get("value")].append(lot)
    for value, group in by_category.items():
        label = (group[0].get("category") or {}).get("label") or "Other"
        titles = sorted((lot["title"] for lot in group), key=str.lower)
        print(f"\n## {label}")
        seen: dict[str, int] = {}  # types given so far in this run, standing in for the ones a real run saves
        for start in range(0, len(titles), BATCH):
            batch = titles[start : start + BATCH]
            vocab = [*store.common_types(value, VOCAB), *sorted(seen, key=lambda t: -seen[t])][:VOCAB]
            types = lab.ask(label, batch, vocab)
            for i, title in enumerate(batch, 1):
                t = types.get(i)
                if t:
                    seen[t] = seen.get(t, 0) + 1
                print(f"{t or '(none)':<28} {title}")


if __name__ == "__main__":
    main()
