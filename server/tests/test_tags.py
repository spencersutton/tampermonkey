import json
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from unittest.mock import Mock
from urllib.parse import quote

from tlx_server.server import Api, make_handler
from tlx_server.store import Store, clean_tag, clean_tags


def lot(lot_id: int, title: str = "Knob", **fields: object) -> dict[str, Any]:
    return {"id": lot_id, "title": title, "category": {"value": "home", "label": "Home"}, "version": 1, **fields}


class CleanTagTests(unittest.TestCase):
    def test_tags_are_tidied_and_attributes_normalized(self) -> None:
        self.assertEqual(clean_tag("  Cabinet   Knob "), "Cabinet Knob")
        self.assertEqual(clean_tag("Finish:Satin  Nickel"), "Finish: Satin Nickel")
        self.assertEqual(clean_tag("finish:"), "finish")
        self.assertIsNone(clean_tag(" : "))
        self.assertEqual(clean_tags(["Brass", "brass", "", "Finish: Brass", "finish:BRASS"]), ["Brass", "Finish: Brass"])


class TagStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.store = Store(Path(folder.name) / "catalog.db")
        self.addCleanup(self.store._db.close)
        self.store.replace_all([lot(1), lot(2), lot(3, "Pull")])

    def test_tags_follow_exact_titles_and_bump_the_sequence(self) -> None:
        seq = self.store.seq()
        changed = self.store.save_lot_tags([(lot(1), ["Cabinet Knob", "Finish: Satin Nickel"])])
        self.assertEqual(changed, {1: ["Cabinet Knob", "Finish: Satin Nickel"], 2: ["Cabinet Knob", "Finish: Satin Nickel"]})
        changes = self.store.changes(seq)
        self.assertEqual(sorted(x["id"] for x in changes.lots), [1, 2])
        self.assertEqual(changes.lots[0]["tags"], ["Cabinet Knob", "Finish: Satin Nickel"])
        self.assertNotIn("tags", self.store.lot(3) or {})

    def test_brand_and_model_identify_items_across_titles(self) -> None:
        self.store.save_lot_detail({"id": 1, "title": "Knob", "brand": "Mila", "model": "K-1", "bidHistory": []})
        self.store.save_lot_detail({"id": 3, "title": "Pull", "brand": "MILA", "model": "k-1", "bidHistory": []})
        self.store.save_lot_tags([(self.store.lot(1) or {}, ["finish: brass"])])
        self.assertEqual((self.store.lot(3) or {}).get("tags"), ["finish: brass"])
        # Lot 2 has no brand/model, so it falls back to the exact title, as item types do.
        self.assertEqual((self.store.lot(2) or {}).get("tags"), ["finish: brass"])

    def test_automatic_tags_never_replace_manual_ones_and_reset_clears_all(self) -> None:
        self.store.save_lot_tags([(lot(1), ["finish: brass"])], manual=True)
        self.store.save_lot_tags([(lot(1), ["finish: chrome"])])
        self.assertEqual((self.store.lot(1) or {}).get("tags"), ["finish: brass"])
        self.store.save_lot_tags([(lot(1), [])], manual=True)
        self.assertNotIn("tags", self.store.lot(1) or {})
        self.store.save_lot_tags([(lot(3, "Pull"), ["x"])])
        self.assertEqual(self.store.reset_tags(), 2)
        self.assertNotIn("tags", self.store.lot(3) or {})


class TagRuleTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.store = Store(Path(folder.name) / "catalog.db")
        self.addCleanup(self.store._db.close)
        self.store.replace_all([
            lot(1, "Mila Satin Nickel Oval Cabinet Knob"),
            lot(2, "Brass Cabinet Pull (Qty 4)"),
            lot(3, "Cordless Drill"),
        ])

    def tags(self, lot_id: int) -> list[str] | None:
        return (self.store.lot(lot_id) or {}).get("tags")

    def test_rules_tag_matching_titles_case_insensitively_and_bump_the_sequence(self) -> None:
        seq = self.store.seq()
        rule, changed = self.store.add_tag_rule(r"\bcabinet (knob|pull)", ["Cabinet Hardware"])
        self.assertEqual(rule.tags, ["Cabinet Hardware"])
        self.assertEqual(sorted(changed), [1, 2])
        self.assertEqual(sorted(x["id"] for x in self.store.changes(seq).lots), [1, 2])
        self.assertIsNone(self.tags(3))

    def test_rule_tags_merge_with_lot_tags_without_repeats(self) -> None:
        self.store.save_lot_tags([(lot(1, "Mila Satin Nickel Oval Cabinet Knob"), ["cabinet knob", "finish: satin nickel"])], manual=True)
        self.store.add_tag_rule("satin nickel", ["Finish: SATIN Nickel"])  # the same tag, ignoring case
        self.store.add_tag_rule("knob|pull", ["cabinet hardware"])
        self.assertEqual(self.tags(1), ["cabinet knob", "finish: satin nickel", "cabinet hardware"])

    def test_tags_in_use_are_counted_ignoring_case(self) -> None:
        self.store.save_lot_tags([(lot(1, "Mila Satin Nickel Oval Cabinet Knob"), ["Finish: Brass"])], manual=True)
        self.store.add_tag_rule("brass", ["finish: brass"])
        _, in_use = self.store.tag_overview()
        self.assertEqual(len(in_use), 1)
        self.assertEqual(in_use[0][1], 2)

    def test_rules_apply_to_future_lots_and_go_away_when_removed(self) -> None:
        rule, _ = self.store.add_tag_rule("drill", ["power tool"])
        self.store.replace_all([lot(3, "Cordless Drill"), lot(4, "Hammer Drill Kit")])
        self.assertEqual(self.tags(4), ["power tool"])
        self.assertEqual(sorted(self.store.remove_tag_rule(rule.id) or {}), [3, 4])
        self.assertIsNone(self.tags(4))
        self.assertIsNone(self.store.remove_tag_rule(rule.id))

    def test_reset_keeps_rules_and_bad_rules_are_refused(self) -> None:
        self.store.add_tag_rule("brass", ["finish: brass"])
        self.store.reset_tags()
        self.assertEqual(self.tags(2), ["finish: brass"])
        with self.assertRaises(ValueError):
            self.store.add_tag_rule("(unclosed", ["x"])
        with self.assertRaises(ValueError):
            self.store.add_tag_rule("brass", [" "])
        self.assertEqual(len(self.store.tag_rules()), 1)


class TagRuleGroupTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.store = Store(Path(folder.name) / "catalog.db")
        self.addCleanup(self.store._db.close)
        self.store.replace_all([lot(1, "Satin Nickel Knob 3 in."), lot(2, "Matte Black Pull 5 in."), lot(3, "Knob")])

    def tags(self, lot_id: int) -> list[str] | None:
        return (self.store.lot(lot_id) or {}).get("tags")

    def test_tags_fill_in_numbered_and_named_groups(self) -> None:
        self.store.add_tag_rule(r"(satin nickel|matte black) (?P<Kind>knob|pull)", ["finish: $1", "${kind}", "$0"])
        self.assertEqual(self.tags(1), ["finish: Satin Nickel", "Knob", "Satin Nickel Knob"])  # as written in the title
        self.assertEqual(self.tags(2), ["finish: Matte Black", "Pull", "Matte Black Pull"])
        self.assertIsNone(self.tags(3))

    def test_groups_that_capture_nothing_drop_their_tag_and_dollars_can_be_escaped(self) -> None:
        self.store.add_tag_rule(r"knob(?: (\d+) in)?", ["size: $1 in", "knob", "$$1 deal"])
        self.assertEqual(self.tags(1), ["size: 3 in", "knob", "$1 deal"])
        self.assertEqual(self.tags(3), ["knob", "$1 deal"])

    def test_references_to_missing_groups_are_refused(self) -> None:
        with self.assertRaisesRegex(ValueError, "only 1 group"):
            self.store.add_tag_rule("(knob)", ["$2"])
        with self.assertRaisesRegex(ValueError, "no groups"):
            self.store.add_tag_rule("knob", ["$1"])
        with self.assertRaisesRegex(ValueError, "no group named 'x'"):
            self.store.add_tag_rule("(?P<y>knob)", ["${x}"])
        self.assertEqual(self.store.tag_rules(), [])


class TagRuleApiTests(unittest.TestCase):
    def setUp(self) -> None:
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.store = Store(Path(folder.name) / "catalog.db")
        self.addCleanup(self.store._db.close)
        self.store.replace_all([lot(1, "Satin Nickel Knob"), lot(2, "Satin Nickel Knob"), lot(3, "Brass Pull")])
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(Api(self.store, Mock(), Mock(), None, set(), False)))
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.port = server.server_port

        def stop() -> None:
            server.shutdown()
            thread.join()
            server.server_close()

        self.addCleanup(stop)

    def call(self, method: str, path: str, body: object = None) -> tuple[int, Any]:
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        try:
            data = None if body is None else json.dumps(body)
            conn.request(method, path, body=data, headers={"X-TLX-Client": "1", "Content-Type": "application/json"})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def test_preview_groups_titles_with_spans_and_current_tags(self) -> None:
        self.store.add_tag_rule("knob", ["cabinet knob"])
        status, data = self.call("GET", "/api/tag-rules/preview?pattern=" + quote("nickel"))
        self.assertEqual(status, 200)
        self.assertEqual(data["lots"], 2)
        self.assertEqual(data["titles"], 1)
        self.assertEqual(
            data["matches"][0] | {"lotId": 0},
            {"title": "Satin Nickel Knob", "lotId": 0, "lots": 2, "span": [6, 12], "tags": ["cabinet knob"], "adds": []},
        )
        _, data = self.call("GET", "/api/tag-rules/preview?pattern=" + quote("(satin) nickel") + "&tag=finish:+%241&tag=Cabinet+KNOB")
        self.assertEqual(data["matches"][0]["adds"], ["finish: Satin"])
        status, data = self.call("GET", "/api/tag-rules/preview?pattern=knob&tag=%241")
        self.assertEqual((status, data["field"]), (400, "tags"))
        status, data = self.call("GET", "/api/tag-rules/preview?pattern=" + quote("(bad"))
        self.assertEqual(status, 400)
        self.assertIn("invalid pattern", data["error"])
        self.assertEqual(data["field"], "pattern")

    def test_add_update_list_and_delete_rules(self) -> None:
        status, data = self.call("POST", "/api/tag-rules", {"pattern": "nickel", "tags": ["Finish: Satin Nickel"]})
        self.assertEqual((status, data["changed"], data["rule"]["tags"]), (200, 2, ["Finish: Satin Nickel"]))
        rule_id = data["rule"]["id"]
        status, data = self.call("PUT", f"/api/tag-rules/{rule_id}", {"pattern": "brass|nickel", "tags": ["metal"]})
        self.assertEqual((status, data["changed"]), (200, 3))
        status, data = self.call("GET", "/api/tag-rules")
        self.assertEqual(
            data, {"rules": [{"id": rule_id, "pattern": "brass|nickel", "tags": ["metal"], "lots": 3}], "tags": [["metal", 3]]}
        )
        self.assertEqual(self.call("DELETE", f"/api/tag-rules/{rule_id}"), (200, {"changed": 3}))
        self.assertEqual(self.call("DELETE", f"/api/tag-rules/{rule_id}")[0], 404)

    def test_bad_bodies_are_refused(self) -> None:
        self.assertEqual(self.call("POST", "/api/tag-rules", {"pattern": "x", "tags": "x"})[0], 400)
        self.assertEqual(self.call("POST", "/api/tag-rules", {"pattern": "x", "tags": []})[0], 400)
        self.assertEqual(self.call("POST", "/api/tag-rules", ["x"])[0], 400)
        self.assertEqual(self.call("PUT", "/api/tag-rules/99", {"pattern": "x", "tags": ["y"]})[0], 404)
