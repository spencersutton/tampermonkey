"""Pure catalog views for server rendering. All instants are epoch milliseconds."""

from __future__ import annotations

import math
import re
import unicodedata
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from datetime import datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal
from functools import lru_cache
from operator import itemgetter
from typing import Any
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import regex

from .history import NameIndex, name_match_pct, name_tokens

type Record = dict[str, Any]

SORTS = {
    "ending-soonest": "Ending soonest",
    "newly-listed": "Newly listed",
    "title-asc": "Title A–Z",
    "title-desc": "Title Z–A",
    "total-asc": "Total cost: low to high",
    "total-desc": "Total cost: high to low",
    "retail-pct-asc": "Best deal (% of retail)",
    "retail-desc": "Retail price: high to low",
    "bids-most": "Most bids",
    "bids-fewest": "Fewest bids",
}
ENDING = {"": "Any time", "1h": "Within 1 hour", "3h": "Within 3 hours", "today": "Today", "tomorrow": "Tomorrow"}
MINE = {"": "All lots", "bid": "Lots I bid on", "leading": "I’m winning", "outbid": "I’m outbid", "watch": "Watchlist"}
DEFAULT_VIEW: Record = {
    "sort": "ending-soonest",
    "search": "",
    "searchRegex": False,
    "categories": [],
    "conditions": [],
    "locations": [],
    "reachable": False,
    "priceMin": None,
    "priceMax": None,
    "totalMax": None,
    "retailMin": None,
    "ending": "",
    "mine": "",
    "newSince": None,
}
_QUERY_KEYS = {
    "search": "search",
    "regex": "searchRegex",
    "sort": "sort",
    "category": "categories",
    "condition": "conditions",
    "location": "locations",
    "reachable": "reachable",
    "priceMin": "priceMin",
    "priceMax": "priceMax",
    "totalMax": "totalMax",
    "retailMin": "retailMin",
    "ending": "ending",
    "mine": "mine",
    "newSince": "newSince",
}
_LIST_KEYS = {"categories", "conditions", "locations"}
_NUMBER_KEYS = {"priceMin", "priceMax", "totalMax", "retailMin", "newSince"}
REGEX_TIMEOUT = 0.025  # Per match; the first timeout aborts the request.


def _number(value: object) -> int | float | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return int(value) if value.is_integer() else value
    return None


def _query_number(value: str) -> int | float | None:
    try:
        number = float(value)
    except ValueError, OverflowError:
        return None
    return (int(number) if number.is_integer() else number) if math.isfinite(number) else None


def normalize_view(view: Record | None) -> Record:
    """Validate persisted state, discard unknown keys, and return fresh lists."""
    raw = view if isinstance(view, dict) else {}
    out = dict(DEFAULT_VIEW)
    for key in ("sort", "ending", "mine"):
        options = {"sort": SORTS, "ending": ENDING, "mine": MINE}[key]
        value = raw.get(key)
        out[key] = value if isinstance(value, str) and value in options else DEFAULT_VIEW[key]
    out["search"] = raw.get("search") if isinstance(raw.get("search"), str) else ""
    for key in ("searchRegex", "reachable"):
        out[key] = raw.get(key) is True
    for key in _LIST_KEYS:
        values = raw.get(key)
        if not isinstance(values, (list, tuple)):
            values = []
        if key == "conditions":
            values = [int(v) for v in values if _number(v) is not None and int(v) == v]
        else:
            values = [v for v in values if isinstance(v, str)]
        out[key] = list(dict.fromkeys(values))
    for key in _NUMBER_KEYS:
        out[key] = _number(raw.get(key))
    return out


def view_from_query(query: dict[str, list[str]], defaults: Record | None = None) -> Record:
    """Repeated singular URL keys select facets. Explicit views replace defaults."""
    if not any(key in query for key in _QUERY_KEYS):
        defaults = defaults or {}
        return normalize_view({key: defaults.get(key, []) for key in ("categories", "conditions")})
    raw: Record = {}
    for url_key, key in _QUERY_KEYS.items():
        if url_key not in query:
            continue
        values = query[url_key]
        value = values[-1] if values else ""
        if key in _LIST_KEYS:
            raw[key] = [_query_number(v) for v in values] if key == "conditions" else [v for v in values if v]
        elif key in _NUMBER_KEYS:
            raw[key] = _query_number(value)
        elif key in ("searchRegex", "reachable"):
            raw[key] = value.lower() in ("1", "true", "on", "yes")
        else:
            raw[key] = value
    return normalize_view(raw)


def view_url(view: Record, **extra: object) -> str:
    """Canonical /tlx URL. Sort is always present so cleared filters stay cleared.

    Extra URL parameters replace existing parameters; None removes a parameter.
    """
    view = normalize_view(view)
    params: Record = {}
    for url_key, key in _QUERY_KEYS.items():
        value = view[key]
        if key in _LIST_KEYS:
            if value:
                params[url_key] = sorted(value)
        elif key == "sort" or (value is not None and value is not False and value != ""):
            params[url_key] = "1" if value is True else value
    for key, value in extra.items():
        if value is None or value is False:
            params.pop(key, None)
        else:
            params[key] = "1" if value is True else value
    encoded = urlencode(params, doseq=True)
    return "/tlx" + ("?" + encoded if encoded else "")


def total_cost(bid: float, transfer_fee: float = 0) -> float:
    return (bid * 1.15 + 1 + transfer_fee) * 1.0725


def money(value: float) -> str:
    amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return f"{'-' if amount.is_signed() else ''}${abs(amount):,.2f}"


def has_bid(lot: Record) -> bool:
    return bool(lot.get("hasBid")) or lot.get("yourStanding") is not None


def is_leading(lot: Record) -> bool:
    standing = lot.get("yourStanding") or {}
    maximum = standing.get("yourMaxBid")
    return bool(standing.get("isLeading")) and lot.get("currentPrice", 0) <= (maximum if maximum is not None else math.inf)


def quick_bid(lot: Record) -> int | float:
    return max(lot.get("nextMinIncrement") or 0, lot.get("currentPrice") or 0)


def min_max_bid(lot: Record) -> int | float:
    maximum = (lot.get("yourStanding") or {}).get("yourMaxBid")
    return max(maximum + 1, quick_bid(lot)) if is_leading(lot) and maximum is not None else quick_bid(lot)


@lru_cache(maxsize=16384)
def _natural(value: str) -> tuple[tuple[int, Any], ...]:
    text = "".join(c for c in unicodedata.normalize("NFKD", value.casefold()) if not unicodedata.combining(c))
    return tuple((1, int(part)) if part.isdecimal() else (0, part) for part in re.split(r"(\d+)", text))


_SORT_ONE = r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[- ]\d+/\d+|/\d+)?"
_SORT_NUM = rf"{_SORT_ONE}(?:\s*[-–]\s*{_SORT_ONE})?"
_SORT_UNIT = (
    r"in(?:ch(?:es)?)?(?!\s*-|\s+\d+(?![\d.,/]))\.?|"
    r"ft\.?|feet|foot|yds?\.?|yards?|mm|cm|mil|ga\.?|gauge|awg|"
    r"gal(?:lons?)?\.?|qts?\.?|quarts?|pints?|pt\.?|cups?|fl\.? ?oz\.?|oz\.?|lbs?\.?|pounds?|kg|tons?|ml|l|liters?|litres?|cc|"
    r"(?:cu|sq)\.? ?(?:ft|in|yd)\.?|"
    r"v|volts?|w|watts?|kw|amps?|a|ah|mah|wh|btus?|psi|gpm|cfm|mph|hp|lm|lumens?|"
    r"[mg]bps|[gkm]?hz|rpm|db|deg(?:rees?)?|°|%|"
    r"pcs?\.?|pieces?|pk|packs?|count|ct|pairs?|tiers?|panels?|channels?"
)
_SORT_HYPHEN_UNIT = r"(?:light|bulb|gang|outlet|port|drawer|shelf|shelves|cube|seat|person|burner|speed|blade|tool|bottle|door|zone|way|step|cutter|cycle|stroke|handle|row|tooth|teeth)s?"
_SORT_MARK = r"""(?:"|''|”|″|'|\u2032)"""
_SORT_MEASURE = rf"{_SORT_NUM}\s*(?:{_SORT_MARK}|-?\s*(?:{_SORT_UNIT}))?"
_SORT_LEAD = re.compile(
    "^(?:"
    + "|".join((
        r"[(\[][^)\]]*[)\]]",
        r"(?:set|pack|box|case|lot)\s+of\s+\d+",
        rf"{_SORT_MEASURE}(?:\s*[x\u00d7]\s*{_SORT_MEASURE})+(?=[\s,.)/]|$)",
        rf"{_SORT_NUM}\s*{_SORT_MARK}",
        rf"{_SORT_NUM}-{_SORT_HYPHEN_UNIT}(?=[\s,.)/]|$)",
        rf"{_SORT_NUM}[\s-]?(?:{_SORT_UNIT})(?=[\s,.)/x\u00d7]|$)",
        rf"{_SORT_NUM}\s*[x\u00d7](?=\s*\d)",
    ))
    + ")",
    re.IGNORECASE,
)
_SORT_SEP = re.compile(r"^[x\u00d7]\s*(?=\d)", re.IGNORECASE)


@lru_cache(maxsize=16384)
def _sort_key(title: str, item_type: str = "") -> str:
    rest, moved = title.strip(), []
    for _ in range(12):
        match = _SORT_LEAD.match(rest) or (_SORT_SEP.match(rest) if moved else None)
        if not match:
            break
        moved.append(match[0].strip())
        rest = re.sub(r"^[\s,;:/–—-]+", "", rest[match.end() :])
    key = " ".join(part for part in (item_type, rest, *moved) if part) if rest or item_type else title
    return key[next((i for i, char in enumerate(key) if char.isalnum()), len(key)) :]


def _categories(categories: Iterable[Record]) -> dict[str, Record]:
    by_type: dict[str, Record] = {}
    for category in sorted(categories, key=lambda c: (_natural(c["name"].strip()), c["name"].strip())):
        for item_type in category.get("types") or []:
            by_type.setdefault(item_type, {"value": "custom:" + category["name"], "label": category["name"]})
    return by_type


def _category(lot: Record, by_type: dict[str, Record]) -> Record | None:
    return by_type.get(lot.get("itemType"), lot.get("category"))


def _compile_search(pattern: str) -> regex.Pattern:
    try:
        return regex.compile(pattern, regex.IGNORECASE)
    except (regex.error, OverflowError) as exc:
        raise ValueError(f"Invalid search regex: {exc}") from exc


def _search(pattern: regex.Pattern, text: str) -> bool:
    try:
        return pattern.search(text, timeout=REGEX_TIMEOUT) is not None
    except TimeoutError as exc:
        raise ValueError("Regex search timed out; simplify the pattern") from exc


class _Rows:
    """Compile request settings once and cache repeated title matches."""

    def __init__(self, pickup: str, settings: Mapping[str, Any]) -> None:
        self.pickup = pickup
        self.settings = settings
        self.categories = _categories(settings.get("tlxCustomCategories") or [])
        self.words = list(dict.fromkeys(settings.get("filterWords") or []))
        self.errors: list[str] = []
        self.patterns: list[tuple[str, regex.Pattern]] = []
        self.matches: dict[str, list[str]] = {}
        edge = r"(?:(?<![A-Za-z0-9_])|(?![A-Za-z0-9_]))"
        for word in self.words:
            if not word.strip():
                continue
            try:
                self.patterns.append((word, regex.compile(f"{edge}(?:{word}){edge}", regex.IGNORECASE)))
            except (regex.error, OverflowError) as exc:
                self.errors.append(f"Invalid exclusion regex {word!r}: {exc}")

    def title_matches(self, title: str) -> list[str]:
        if title not in self.matches:
            self.matches[title] = [word for word, pattern in self.patterns if _search(pattern, title)]
        return self.matches[title]

    def row(self, lot: Record) -> Record:
        elsewhere = bool(lot.get("location")) and lot["location"]["name"] != self.pickup
        fee = (lot.get("transferFee") or 0) if elsewhere and lot.get("isTransferable") else 0
        retail = lot.get("estimatedRetailPrice")
        matched = self.title_matches(lot["title"]) if self.settings.get("filterEnabled", True) else []
        hidden = self.settings.get("hiddenLots") or {}
        return {
            "lot": lot,
            "category": _category(lot, self.categories),
            "transferFee": fee,
            "pickupOnly": bool(elsewhere and not lot.get("isTransferable")),
            "total": total_cost(lot["currentPrice"], fee),
            "retailPct": math.floor(lot["currentPrice"] / retail * 100 + 0.5) / 100 if retail else None,
            "matched": matched[0] if matched else None,
            "hidden": str(lot["id"]) in hidden or lot["id"] in hidden,
            "others": [],
            "errors": self.errors.copy(),
        }


def make_row(lot: Record, pickup: str, settings: Record) -> Record:
    """Compute one card; invalid legacy exclusions are exposed in errors."""
    return _Rows(pickup, settings).row(lot)


def _window(ending: str, now: int, timezone: str) -> tuple[int, int] | None:
    if ending in ("1h", "3h"):
        return now, now + int(ending[0]) * 3_600_000
    if ending in ("today", "tomorrow"):
        zone = ZoneInfo(timezone)
        date = datetime.fromtimestamp(now / 1000, zone).date() + timedelta(days=ending == "tomorrow")
        start = datetime.combine(date, time.min, zone)
        end = datetime.combine(date + timedelta(days=1), time.min, zone)
        return max(now, int(start.timestamp() * 1000)), int(end.timestamp() * 1000)
    return None


def _matcher(view: Record, now: int, timezone: str) -> Callable[[Record], bool]:
    pattern = _compile_search(view["search"].strip()) if view["searchRegex"] and view["search"].strip() else None
    terms = [] if view["searchRegex"] else view["search"].lower().split()
    window = _window(view["ending"], now, timezone)
    selections = {key: set(view[key]) for key in _LIST_KEYS}

    def matches(row: Record) -> bool:
        lot = row["lot"]
        haystack = f"{lot['title']} {lot.get('lotNumber', '')}"
        standing = lot.get("yourStanding") or {}
        mine = {
            "": True,
            "bid": has_bid(lot),
            "leading": bool(standing.get("isLeading")),
            "outbid": has_bid(lot) and not standing.get("isLeading"),
            "watch": bool(lot.get("isWatchlisted")),
        }
        return (
            (view["newSince"] is None or (lot.get("firstSeenAt") or 0) > view["newSince"])
            and (not pattern or _search(pattern, haystack))
            and all(term in haystack.lower() for term in terms)
            and (not selections["categories"] or (row["category"] or {}).get("value", "") in selections["categories"])
            and (not selections["conditions"] or (lot.get("condition") or {}).get("value", -1) in selections["conditions"])
            and (not selections["locations"] or (lot.get("location") or {}).get("name", "") in selections["locations"])
            and not (view["reachable"] and row["pickupOnly"])
            and (view["priceMin"] is None or lot["currentPrice"] >= view["priceMin"])
            and (view["priceMax"] is None or lot["currentPrice"] <= view["priceMax"])
            and (view["totalMax"] is None or row["total"] <= view["totalMax"])
            and (view["retailMin"] is None or (lot.get("estimatedRetailPrice") or 0) >= view["retailMin"])
            and (window is None or window[0] <= lot["endsAt"] < window[1])
            and bool(mine[view["mine"]])
        )

    return matches


def _name_groups(titles: Iterable[str], min_pct: float) -> dict[str, int]:
    by_words: dict[frozenset[str], int] = {}
    empty: dict[str, int] = {}
    groups: dict[str, int] = {}
    for title in titles:
        words = name_tokens(title)
        group = by_words.setdefault(words, len(by_words)) if words else None
        groups[title] = group if group is not None else -empty.setdefault(title.strip().lower(), len(empty) + 1)
    parent = list(range(len(by_words)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    if min_pct < 100:
        partitions: dict[frozenset[str], list[frozenset[str]]] = defaultdict(list)
        # Every matching edge has identical numeric tokens, so no transitive
        # component can cross these partitions.
        for words in by_words:
            numbers = frozenset(word for word in words if any(char.isdigit() for char in word))
            partitions[numbers].append(words)
        for partition in partitions.values():
            if len(partition) < 2:
                continue
            index = NameIndex(partition, min_pct)
            for words in partition:
                for other in index.matches(words):
                    parent[find(by_words[words])] = find(by_words[other])
    return {title: find(group) if group >= 0 else group for title, group in groups.items()}


def _combine(rows: list[Record], names: dict[str, int]) -> tuple[list[Record], dict[int, list[Record]]]:
    cards: list[Record] = []
    groups: dict[int, list[Record]] = {}
    buckets: dict[tuple[int, Any], list[Record]] = defaultdict(list)
    for row in rows:
        lot = row["lot"]
        if has_bid(lot) or row["hidden"] or row["matched"]:
            cards.append(row)
        else:
            buckets[names[lot["title"]], (lot.get("condition") or {}).get("value", "")].append(row)
    for bucket in buckets.values():
        bucket.sort(key=lambda r: (r["pickupOnly"], r["total"], r["lot"]["endsAt"], r["lot"]["id"]))
        cards.append({**bucket[0], "others": bucket[1:]} if len(bucket) > 1 else bucket[0])
        if len(bucket) > 1:
            groups.update((row["lot"]["id"], bucket) for row in bucket)
    return cards, groups


def _sort_rows(rows: list[Record], sort: str) -> None:
    rows.sort(key=lambda r: (r["lot"]["endsAt"], r["lot"]["id"]))
    keys: dict[str, Callable[[Record], Any]] = {
        "newly-listed": lambda r: -r["lot"]["id"],
        "title-asc": lambda r: _natural(_sort_key(r["lot"]["title"], r["lot"].get("itemType") or "")),
        "total-asc": itemgetter("total"),
        "total-desc": lambda r: -r["total"],
        "retail-pct-asc": lambda r: (
            r["retailPct"] if r["retailPct"] is not None else math.inf,
            -(r["lot"].get("estimatedRetailPrice") or 0),
        ),
        "retail-desc": lambda r: -(r["lot"]["estimatedRetailPrice"] if r["lot"].get("estimatedRetailPrice") is not None else -1),
        "bids-most": lambda r: -(r["lot"].get("bidCount") or 0),
        "bids-fewest": lambda r: r["lot"].get("bidCount") or 0,
    }
    if sort == "title-desc":
        rows.sort(key=keys["title-asc"], reverse=True)
    elif sort in keys:
        rows.sort(key=keys[sort])


def compute_view(
    lots: Iterable[Record], view: Record, pickup: str, settings: Record, now: int, timezone: str = "America/New_York"
) -> Record:
    view = normalize_view(view)
    matches = _matcher(view, now, timezone)
    builder = _Rows(pickup, settings)
    counts = dict.fromkeys(builder.words, 0)
    rows: list[Record] = []
    titles: dict[str, None] = {}
    opened = removed = filtered = 0
    for lot in lots:
        if lot["endsAt"] <= now:
            continue
        opened += 1
        titles[lot["title"]] = None
        for word in builder.title_matches(lot["title"]):
            counts[word] += 1
        row = builder.row(lot)
        if not view["mine"] and (
            (row["hidden"] and not settings.get("showHidden", False)) or (row["matched"] and settings.get("removeFiltered", False))
        ):
            removed += 1
        elif not matches(row):
            filtered += 1
        else:
            rows.append(row)
    pct = settings.get("tlxNameMatch")
    pct = name_match_pct(pct if _number(pct) is not None else None)
    cards, groups = _combine(rows, _name_groups(titles, pct))
    _sort_rows(cards, view["sort"])
    return {
        "rows": cards,
        "open": opened,
        "removed": removed,
        "filteredOut": filtered,
        "matchCounts": counts,
        "combined": len(rows) - len(cards),
        "groups": groups,
        "errors": builder.errors,
    }


def _tally(items: Iterable[Record | None]) -> list[Record]:
    counts: dict[Any, Record] = {}
    for item in items:
        if item is not None:
            counts.setdefault(item["value"], {**item, "count": 0})["count"] += 1
    return list(counts.values())


def compute_facets(lots: Iterable[Record], now: int, custom_categories: list[Record]) -> Record:
    opened = [lot for lot in lots if lot["endsAt"] > now]
    by_type = _categories(custom_categories)
    categories = _tally(_category(lot, by_type) for lot in opened)
    for category in custom_categories:
        value = "custom:" + category["name"]
        if not any(f["value"] == value for f in categories) and any(
            f["value"].startswith("custom:") and f["label"].startswith(category["name"] + " - ") for f in categories
        ):
            categories.append({"value": value, "label": category["name"], "count": 0})
    return {
        "categories": sorted(categories, key=lambda f: _natural(f["label"])),
        "siteCategories": _tally(lot.get("category") for lot in opened),
        "conditions": sorted(_tally(lot.get("condition") for lot in opened), key=itemgetter("value")),
        "locations": sorted(
            _tally({"value": lot["location"]["name"], "label": lot["location"]["name"]} if lot.get("location") else None for lot in opened),
            key=lambda f: -f["count"],
        ),
    }


def category_tree(facets: Record) -> list[Record]:
    """Branch count includes descendants; ownCount is the category's own count."""
    all_facets = {f["value"]: {**f, "count": 0} for f in facets["siteCategories"]}
    all_facets.update((f["value"], f) for f in facets["categories"])
    nodes = {value: {**facet, "children": [], "values": [value], "ownCount": facet["count"]} for value, facet in all_facets.items()}
    parents = sorted(all_facets.values(), key=lambda f: -len(f["label"]))
    roots: list[Record] = []
    for facet in facets["categories"]:
        parent = (
            next((p for p in parents if facet["label"].startswith(p["label"] + " - ")), None)
            if facet["value"].startswith("custom:")
            else None
        )
        node = nodes[facet["value"]]
        if parent:
            node["label"] = facet["label"][len(parent["label"]) + 3 :]
            nodes[parent["value"]]["children"].append(node)
        else:
            roots.append(node)
    for facet in facets["siteCategories"]:
        node = nodes[facet["value"]]
        if node["children"] and node not in roots:
            roots.append(node)

    def finish(branches: list[Record]) -> list[Record]:
        for node in branches:
            node["children"] = finish(node["children"])
            node["values"] = [node["value"], *(value for child in node["children"] for value in child["values"])]
            node["count"] = node["ownCount"] + sum(child["count"] for child in node["children"])
        return sorted(branches, key=lambda node: _natural(node["label"]))

    return finish(roots)


def saved_search_stats(
    lots: Iterable[Record], searches: Iterable[Record], pickup: str, settings: Record, now: int, timezone: str = "America/New_York"
) -> dict[str, dict[str, int]]:
    """Count individual listings, not cards; never count hidden/excluded rows.

    Invalid exclusions raise here: the id-to-counts return schema has no errors
    field in which to make ignored patterns visible.
    """
    builder = _Rows(pickup, settings)
    if builder.errors:
        raise ValueError("; ".join(builder.errors))
    entries = [(search, _matcher(normalize_view({**search["view"], "newSince": None}), now, timezone)) for search in searches]
    stats = {search["id"]: {"total": 0, "fresh": 0} for search, _ in entries}
    for lot in lots:
        if lot["endsAt"] <= now:
            continue
        row = builder.row(lot)
        if row["hidden"] or row["matched"]:
            continue
        for search, matches in entries:
            if matches(row):
                counts = stats[search["id"]]
                counts["total"] += 1
                if (lot.get("firstSeenAt") or 0) > (search.get("lastViewedAt") or 0):
                    counts["fresh"] += 1
    return stats


def same_filters(a: Record, b: Record) -> bool:
    """Match saved filters, ignoring sort and newSince (selection order matters)."""
    left, right = normalize_view(a), normalize_view(b)
    return all(left[key] == right[key] for key in DEFAULT_VIEW if key not in ("sort", "newSince"))
