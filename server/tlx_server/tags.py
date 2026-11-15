r"""Tags: any number of short labels per item, beyond its one item type. A
plain tag ("cabinet knob") is a label; "name: value" ("finish: satin nickel")
is an attribute, and the app offers a dropdown per attribute name to filter
the current results by its values.

A lot's tags come from two places, merged:
- tags set on the lot itself, stored like item types: by brand/model when both
  are known, else by exact title, so a relisted item keeps them;
- rules: a regular expression (case-insensitive, matched anywhere in the
  title) and the tags every matching lot gets, now and in future pulls. A
  rule's tag can use what the pattern captured: $1 for the first group,
  ${name} for (?P<name>...), $0 for the whole match, $$ for a dollar sign
  (single-quote such tags in the shell). A tag whose group captured nothing
  is left out.

Change them while the server runs; open app tabs pick changes up on their next
check:

  python -m tlx_server.tags set 198469 "cabinet knob" "finish: satin nickel"
  python -m tlx_server.tags show 198469
  python -m tlx_server.tags clear 198469
  python -m tlx_server.tags reset          # forget tags set on lots (keeps rules)

  python -m tlx_server.tags rule preview "satin nickel"
  python -m tlx_server.tags rule add "satin nickel" "finish: satin nickel"
  python -m tlx_server.tags rule add "\bcabinet (knob|pull)s?\b" "cabinet hardware"
  python -m tlx_server.tags rule preview "(satin nickel|brass|chrome)" 'finish: $1'
  python -m tlx_server.tags rule add "(satin nickel|brass|chrome)" 'finish: $1'
  python -m tlx_server.tags rule list
  python -m tlx_server.tags rule remove 2
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .store import Store, compile_tag_pattern

PREVIEW_TITLES = 15


def main() -> None:
    from .__main__ import DEFAULT_DB

    p = argparse.ArgumentParser(prog="tlx_server.tags", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite file (default {DEFAULT_DB})")
    sub = p.add_subparsers(dest="cmd", required=True)
    set_ = sub.add_parser("set", help="replace a lot's tags (and those of the same item listed again)")
    set_.add_argument("lot_id", type=int)
    set_.add_argument("tags", nargs="+", help='e.g. "cabinet knob" "finish: satin nickel"')
    for name, text in (("show", "print a lot's tags"), ("clear", "remove a lot's tags")):
        sub.add_parser(name, help=text).add_argument("lot_id", type=int)
    sub.add_parser("reset", help="forget the tags set on lots (rules are kept)")
    rule = sub.add_parser("rule", help="tag every lot whose title matches a regular expression").add_subparsers(
        dest="rule_cmd", required=True
    )
    add = rule.add_parser("add", help="add a rule; it applies to current and future lots")
    add.add_argument("pattern", help="case-insensitive regular expression, matched anywhere in the title")
    add.add_argument("tags", nargs="+", help='e.g. "finish: satin nickel"')
    preview = rule.add_parser("preview", help="list the current lots a pattern matches, without saving")
    preview.add_argument("pattern")
    preview.add_argument("tags", nargs="*", help="also show the tags each title would get")
    rule.add_parser("list", help="print every rule with its id")
    rule.add_parser("remove", help="drop a rule (the tags it gave go away)").add_argument("rule_id", type=int)
    args = p.parse_args()

    if not args.db.exists():
        sys.exit(f"no database at {args.db}")
    store = Store(args.db)
    if args.cmd == "rule":
        run_rule(store, args)
        return
    if args.cmd == "reset":
        print(f"forgot {store.reset_tags()} tag rows")
        return
    lot = store.lot(args.lot_id)
    if lot is None:
        sys.exit(f"lot {args.lot_id} is not in the catalog")
    if args.cmd == "show":
        print("\n".join(lot.get("tags") or ["(no tags)"]))
        for r in store.tag_rules():
            if compile_tag_pattern(r.pattern).search(lot["title"]):
                print(f"  from rule {r.id}: /{r.pattern}/ → {', '.join(r.tags)}")
        return
    changed = store.save_lot_tags([(lot, args.tags if args.cmd == "set" else [])], manual=True)
    tags = store.lot(args.lot_id) or {}
    print(f"{lot['title']}\n  tags: {', '.join(tags.get('tags') or []) or '(none)'}\n  lots updated: {len(changed)}")


def run_rule(store: Store, args: argparse.Namespace) -> None:
    try:
        if args.rule_cmd == "list":
            rules = store.tag_rules()
            for r in rules:
                print(f"{r.id:>4}  /{r.pattern}/ → {', '.join(r.tags)}")
            if not rules:
                print("(no rules)")
        elif args.rule_cmd == "preview":
            preview = store.preview_tag_rule(args.pattern, args.tags, PREVIEW_TITLES)
            for m in preview["matches"]:
                adds = f"  → {', '.join(m['adds'])}" if m["adds"] else ""
                print(f"{m['title']}{adds}")
            more = f" (first {PREVIEW_TITLES} shown)" if preview["titles"] > PREVIEW_TITLES else ""
            print(f"{preview['lots']} lots, {preview['titles']} distinct titles match{more}")
        elif args.rule_cmd == "add":
            r, changed = store.add_tag_rule(args.pattern, args.tags)
            print(f"rule {r.id}: /{r.pattern}/ → {', '.join(r.tags)}\n  lots updated: {len(changed)}")
        elif (changed := store.remove_tag_rule(args.rule_id)) is None:
            sys.exit(f"no rule {args.rule_id}")
        else:
            print(f"removed rule {args.rule_id}\n  lots updated: {len(changed)}")
    except ValueError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
