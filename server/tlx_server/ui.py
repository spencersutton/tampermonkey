"""Server-rendered views and form actions. The URL is the current view; SQLite owns durable state."""

from __future__ import annotations

import copy
import math
import operator
import secrets
import threading
from pathlib import Path
from statistics import median
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, urlsplit

import regex
from jinja2 import Environment, FileSystemLoader, select_autoescape

from .gateway import Gateway
from .history import HISTORY_LIMIT, name_match_pct, name_tokens, names_match
from .itemtypes import MAX_TYPE_LENGTH, clean_type
from .site import SITE, ApiError, now_ms
from .store import Store
from .views import (
    DEFAULT_VIEW,
    ENDING,
    MINE,
    SORTS,
    category_tree,
    compute_facets,
    compute_view,
    is_leading,
    make_row,
    min_max_bid,
    money,
    normalize_view,
    quick_bid,
    same_filters,
    saved_search_stats,
    total_cost,
    view_from_query,
    view_url,
)

DEFAULTS: dict[str, Any] = {
    "hiddenLots": {},
    "filterWords": [],
    "filterEnabled": True,
    "showHidden": False,
    "removeFiltered": False,
    "tlxSyncMinutes": 5,
    "tlxPickup": None,
    "tlxSavedSearches": [],
    "tlxCustomCategories": [],
    "tlxDefaultFilters": {"categories": [], "conditions": []},
    "tlxLastVisit": None,
    "tlxNameMatch": 90,
}
if TYPE_CHECKING:
    from .server import Api
LOCAL_KEYS = {"tlxView", "tlxTitleLines", "tlxLastCategory", "collapsedLists"}
PAGE_SIZE = 60


def first(data: dict[str, list[str]], key: str, default: str = "") -> str:
    return data.get(key, [default])[0]


def number(text: str, *, minimum: float = 0) -> float:
    value = float(text.replace("$", "").replace(",", "").strip())
    if not math.isfinite(value) or value < minimum:
        raise ValueError(f"Expected a number of at least {minimum:g}")
    return value


def lot_href(lot: dict[str, Any]) -> str:
    from urllib.parse import quote

    return f"https://triangleliquidators.com/lots/{quote(str(lot.get('auctionPeriod') or ''), safe='')}/{lot['id']}"


def plural(count: int, word: str) -> str:
    return f"{count:,} {word}{'' if count == 1 else 's'}"


def past_price(lot: dict[str, Any]) -> dict[str, Any] | None:
    recent = [row for row in (lot.get("pastCloses") or {}).get("recent", []) if row["sold"]]
    same = [row for row in recent if row.get("condition") == (lot.get("condition") or {}).get("label")]
    prices = [row["price"] for row in same or recent]
    return {"median": median(prices), "n": len(prices), "same": bool(same)} if prices else None


class UI:
    def __init__(self, api: Api, gateway: Gateway) -> None:
        self.api = api
        self.store: Store = api.store
        self.gateway = gateway
        self.templates = Environment(
            loader=FileSystemLoader(Path(__file__).parent / "templates"),
            autoescape=select_autoescape(("html",)),
            trim_blocks=True,
            lstrip_blocks=True,
        )
        self.templates.globals.update(
            money=money,
            plural=plural,
            lot_href=lot_href,
            past_price=past_price,
            total_cost=total_cost,
            quick_bid=quick_bid,
            min_max_bid=min_max_bid,
            is_leading=is_leading,
        )
        self._confirmations: dict[str, tuple[str, int, float, str, int]] = {}
        self._confirmation_lock = threading.Lock()

    def settings(self) -> dict[str, Any]:
        return {**copy.deepcopy(DEFAULTS), **self.store.settings()[1]}

    def visit(self, browser: dict[str, Any], settings: dict[str, Any]) -> None:
        now = now_ms()
        since = settings.get("tlxLastVisit")
        if since is None:
            seen = [lot.get("firstSeenAt") or 0 for lot in self.store.all_lots().values() if (lot.get("endsAt") or 0) > now + 2 * 86400_000]
            since = max(0, min(seen) - 1) if seen else now
        browser["visitSince"] = since
        self.store.put_setting("tlxLastVisit", now)

    def context(self, query: dict[str, list[str]], browser: dict[str, Any]) -> dict[str, Any]:
        settings, now = self.settings(), now_ms()
        view_keys = set(query) - {"closed", "period", "dialog", "id", "filter", "newOnly"}
        if view_keys:
            view = view_from_query(query)
        else:
            defaults = settings["tlxDefaultFilters"]
            saved = browser.get("tlxView")
            view = normalize_view(saved if saved is not None else {**DEFAULT_VIEW, **defaults})
        page = min(10_000, max(1, int(first(query, "page", "1"))))
        timezone = browser.get("timezone", "America/New_York")
        errors: list[str] = []
        account_pickup = browser.get("accountPickup")
        conditions: dict[int, str] = {}
        condition_info = []
        if self.gateway.session.logged_in and (not account_pickup or now - browser.get("accountPickupAt", 0) >= 86400_000):
            try:
                account_pickup = self.gateway.cached("/v1/auth/me/", 86400_000).get("pickup_location")
                browser["accountPickup"] = account_pickup
                browser["accountPickupAt"] = now
            except ApiError as error:
                errors.append(str(error))
        try:
            config = self.gateway.cached("/v1/auctions/filter-config/", 86400_000)
            condition_info = config.get("conditions") or []
            conditions = {row["value"]: row["description"] for row in condition_info}
        except ApiError as error:
            errors.append(f"Condition descriptions unavailable: {error}")
        lots = list(self.store.all_lots().values())
        if account_pickup and not account_pickup.get("name"):
            account_pickup["name"] = next(
                (lot["location"]["name"] for lot in lots if lot.get("location") and lot["location"]["id"] == account_pickup.get("id")), None
            )
        pickup = settings["tlxPickup"] or (account_pickup or {}).get("name") or "Raleigh"
        hidden_links = {}
        for key, hidden in settings["hiddenLots"].items():
            saved_url = urlsplit(hidden.get("href") or "/")
            valid = saved_url.scheme in ("", "http", "https") and saved_url.hostname in (None, "triangleliquidators.com")
            hidden_links[key] = SITE + saved_url.path if valid else None
            if not valid:
                errors.append(f"Invalid saved link for hidden lot {key}; unhide it to remove the entry.")
        try:
            result = compute_view(lots, view, pickup, settings, now, timezone)
        except ValueError as error:
            errors.append(str(error))
            result = {"rows": [], "groups": {}, "open": 0, "combined": 0, "removed": 0, "filteredOut": 0, "matchCounts": {}}
        facets = compute_facets(lots, now, settings["tlxCustomCategories"])
        try:
            stats = saved_search_stats(lots, settings["tlxSavedSearches"], pickup, settings, now, timezone)
        except ValueError as error:
            errors.append(f"Saved-search counts unavailable: {error}")
            stats = {}
        active = next((search for search in settings["tlxSavedSearches"] if same_filters(view, search["view"])), None)
        highlight = browser.get("highlight") or {}
        since = view.get("newSince")
        if since is None:
            since = highlight.get("since") if active and active["id"] == highlight.get("id") else browser.get("visitSince")
        browser["tlxView"] = view
        closed = first(query, "closed")
        if closed not in ("", "won", "lost"):
            raise ValueError("Invalid closed-lot section")
        lot_id = int(first(query, "lot", "0")) or None
        dialog = first(query, "dialog")
        url = view_url(view, page=page, closed=closed or None, lot=lot_id, period=first(query, "period") or None)
        context = {
            "view": view,
            "settings": settings,
            "browser": browser,
            "now": now,
            "pickup": pickup,
            "conditions": conditions,
            "condition_info": condition_info,
            "result": result,
            "rows": result["rows"][: page * PAGE_SIZE],
            "facets": facets,
            "tree": category_tree(facets),
            "stats": stats,
            "active": active,
            "since": since,
            "page": page,
            "more": len(result["rows"]) > page * PAGE_SIZE,
            "fresh": sum((row["lot"].get("firstSeenAt") or 0) > since for row in result["rows"]) if since is not None else 0,
            "total_new": sum(item["fresh"] for item in stats.values()),
            "status": self.api.status(),
            "live": self.api.live.state,
            "authed": self.gateway.session.logged_in,
            "account": self.gateway.session.status(),
            "account_pickup": account_pickup,
            "sorts": SORTS,
            "ending": ENDING,
            "mine": MINE,
            "url": url,
            "closed": closed,
            "lot_id": lot_id,
            "errors": errors,
            "dialog": dialog,
            "detail": None,
            "modal": None,
            "catalog_ids": {str(lot["id"]) for lot in lots},
            "hidden_links": hidden_links,
            "view_url": lambda **extra: view_url(view, **extra),
            "filter_url": lambda **patch: view_url({**view, **patch}),
            "mine_url": lambda choice: view_url({**DEFAULT_VIEW, "sort": view["sort"], "mine": choice}),
            "new_url": view_url({**view, "newSince": None if view.get("newSince") is not None else since}),
            "next_url": view_url(view, page=page + 1),
        }
        errors.extend(result.get("errors", []))
        if closed:
            try:
                rows = self.gateway.closed(closed)
                terms = first(query, "filter").casefold().split()
                rows = [
                    row
                    for row in rows
                    if all(term in f"{row['title']} {row['lot_number']} {row['location_name']}".casefold() for term in terms)
                ]
                for row in rows:
                    row["relisted"] = [
                        make_row(lot, pickup, settings)
                        for lot in lots
                        if lot["id"] != row["lot_id"]
                        and (lot.get("endsAt") or 0) > now
                        and names_match(name_tokens(lot["title"]), name_tokens(row["title"]), name_match_pct(settings["tlxNameMatch"]))
                    ]
                    row["relisted"].sort(key=operator.itemgetter("total"))
                context.update(
                    closed_rows=rows, closed_filter=first(query, "filter"), closed_total=sum(total_cost(row["final_price"]) for row in rows)
                )
            except (ApiError, ValueError) as error:
                errors.append(str(error))
                context.update(closed_rows=[], closed_filter=first(query, "filter"), closed_total=0)
        if lot_id:
            try:
                detail = self.gateway.detail(lot_id, first(query, "period") or None)
                context.update(
                    detail=detail,
                    detail_row=make_row(detail, pickup, settings),
                    group=result["groups"].get(lot_id, []),
                    closes=self.api.catalog.history.closes_for(detail)[:HISTORY_LIMIT],
                )
            except (ApiError, ValueError) as error:
                errors.append(str(error))
        if dialog:
            self.dialog(context, query)
        return context

    def render(self, name: str, context: dict[str, Any]) -> str:
        return self.templates.get_template(name).render(**context)

    def dialog(self, context: dict[str, Any], data: dict[str, list[str]]) -> None:
        kind = context["dialog"]
        lots = [lot for lot in self.store.all_lots().values() if (lot.get("endsAt") or 0) > context["now"]]
        types: dict[str, int] = {}
        for lot in lots:
            if lot.get("itemType"):
                types[lot["itemType"]] = types.get(lot["itemType"], 0) + 1
        context["types"] = sorted(types.items(), key=lambda item: (-item[1], item[0]))
        if kind == "categories":
            context["drafts"] = context["settings"]["tlxCustomCategories"]
        elif kind in ("item-type", "type-category"):
            lot = self.store.lot(int(first(data, "id", str(context["lot_id"] or 0))))
            if not lot:
                raise ValueError("No such catalog lot")
            context["type_lot"] = lot
            if kind == "type-category":
                item_type = lot.get("itemType") or ""
                parts = item_type.split()
                if not parts:
                    raise ValueError("Set the lot's item type first")
                last = parts[-1]
                parts[-1] = last + ("es" if last.endswith(("ss", "x", "z", "ch", "sh")) else "" if last.endswith("s") else "s")
                if regex.search(r"[^aeiou]y$", last):
                    parts[-1] = last[:-1] + "ies"
                parent = (make_row(lot, context["pickup"], context["settings"])["category"] or {}).get("label")
                suggested = " ".join(part.capitalize() for part in parts)
                context["suggested"] = f"{parent} - {suggested}" if parent else suggested
                words = [word for word in regex.split(r"[\s/-]+", item_type) if len(word) > 2 and word not in ("and", "for", "with")]
                similar = [
                    (name, count)
                    for name, count in context["types"]
                    if name != item_type and set(words).intersection(regex.split(r"[\s/-]+", name))
                ]
                similar.sort(key=lambda item: (not words or regex.split(r"[\s/-]+", item[0])[-1] != words[-1], -item[1], item[0]))
                context["similar_types"] = similar[:12]
                site = (lot.get("category") or {}).get("label", "")
                choices = sorted(
                    context["settings"]["tlxCustomCategories"],
                    key=lambda item: (not item["name"].startswith(site + " - "), item["name"].casefold()),
                )
                context["category_choices"] = choices
                available = {item["name"] for item in choices}
                last_category = context["browser"].get("tlxLastCategory")
                context["preferred_category"] = (
                    last_category
                    if last_category in available
                    else parent
                    if parent in available
                    else choices[0]["name"]
                    if choices
                    else ""
                )
        elif kind not in ("login", "conditions"):
            raise ValueError("Unknown dialog")

    @staticmethod
    def return_query(data: dict[str, list[str]]) -> dict[str, list[str]]:
        url = urlsplit(first(data, "return", "/tlx"))
        if url.scheme or url.netloc or url.path != "/tlx":
            raise ValueError("Invalid return URL")
        return parse_qs(url.query)

    def save_categories(self, categories: list[dict[str, Any]], renames: dict[str, str | None], browser: dict[str, Any]) -> None:
        names = {category["name"] for category in categories}
        if len(names) != len(categories) or len({name.casefold() for name in names}) != len(names):
            raise ValueError("Category names must be unique")
        for category in categories:
            name = category["name"]
            if not name or len(name) > 200:
                raise ValueError("Category names must be 1 to 200 characters")
            if not category["types"] and not any(other.startswith(name + " - ") for other in names):
                raise ValueError(f"Add item types to {name}, or give it a child category")
        settings = self.settings()
        changes: dict[str, str | None] = {row["name"]: None for row in settings["tlxCustomCategories"] if row["name"] not in names}
        changes.update({old: new for old, new in renames.items() if old != new})

        def fix(values: list[str]) -> list[str]:
            output = []
            for value in values:
                name = value.removeprefix("custom:")
                if value.startswith("custom:") and name in changes:
                    if changes[name] is not None:
                        output.append("custom:" + str(changes[name]))
                else:
                    output.append(value)
            return output

        self.store.put_setting("tlxCustomCategories", categories)
        if changes:
            view = browser.get("tlxView")
            if view:
                view["categories"] = fix(view.get("categories", []))
            defaults = settings["tlxDefaultFilters"]
            self.store.put_setting("tlxDefaultFilters", {**defaults, "categories": fix(defaults["categories"])})
            searches = settings["tlxSavedSearches"]
            for search in searches:
                search["view"]["categories"] = fix(search["view"].get("categories", []))
            self.store.put_setting("tlxSavedSearches", searches)
            if browser.get("tlxLastCategory") in changes:
                browser["tlxLastCategory"] = changes[browser["tlxLastCategory"]]

    @staticmethod
    def category_drafts(data: dict[str, list[str]]) -> tuple[list[dict[str, Any]], dict[str, str | None]]:
        categories, renames = [], {}
        for key in data.get("cat-key", []):
            name = first(data, f"name-{key}").strip()
            old = first(data, f"from-{key}")
            types = list(dict.fromkeys(clean_type(value.strip()) for value in first(data, f"types-{key}").splitlines() if value.strip()))
            if any(not item or len(item) > MAX_TYPE_LENGTH for item in types):
                raise ValueError(f"Item types must be 1 to {MAX_TYPE_LENGTH} characters")
            categories.append({"name": name, "types": types})
            if old:
                renames[old] = name
        return categories, renames

    def category_plan(self, data: dict[str, list[str]], settings: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
        lot = self.store.lot(int(first(data, "id")))
        if not lot or not lot.get("itemType"):
            raise ValueError("No item type to categorize")
        types = list(dict.fromkeys([lot["itemType"], *data.get("extra", [])]))
        mode = first(data, "mode", "new")
        if mode not in ("new", "add"):
            raise ValueError("Invalid category mode")
        name = first(data, "name" if mode == "new" else "existing").strip()
        if not name:
            raise ValueError("Name is required")
        categories = settings["tlxCustomCategories"]
        existing = next((item for item in categories if item["name"] == name), None)
        if mode == "new" and any(item["name"].casefold() == name.casefold() for item in categories):
            raise ValueError("There is already a category with this name; use Add to existing.")
        if mode == "add" and not existing:
            raise ValueError("Pick a category")
        target = {"name": name, "types": list(dict.fromkeys([*(existing or {}).get("types", []), *types]))}
        planned = [
            {"name": item["name"], "types": [value for value in item.get("types", []) if value not in types]}
            for item in categories
            if item is not existing
        ] + [target]
        return [item for item in planned if item["types"] or any(child["name"].startswith(item["name"] + " - ") for child in planned)], name

    def preview(self, action: str, data: dict[str, list[str]], browser: dict[str, Any]) -> dict[str, Any]:
        context = self.context(self.return_query(data), browser)
        if action == "categories-preview":
            categories, _ = self.category_drafts(data)
            selected = first(data, "selected", first(data, "cat-key"))
            name = first(data, f"name-{selected}").strip()
            preview_id = "category-preview"
        else:
            categories, name = self.category_plan(data, context["settings"])
            preview_id = "type-preview"
        settings = {**context["settings"], "tlxCustomCategories": categories}
        rows = [
            make_row(lot, context["pickup"], settings)
            for lot in self.store.all_lots().values()
            if (lot.get("endsAt") or 0) > context["now"]
        ]
        context.update(
            preview_name=name or "New category",
            preview_id=preview_id,
            preview_error="",
            preview_rows=[row for row in rows if (row["category"] or {}).get("value") == "custom:" + name],
        )
        return context

    def blocker(self, row: dict[str, Any]) -> str | None:
        lot = row["lot"]
        if row["hidden"]:
            return "Bidding is disabled for hidden lots."
        if row["matched"]:
            return f"Bidding is disabled for filtered lots ({row['matched']})."
        if lot["status"] != "live" or (lot.get("endsAt") or 0) <= now_ms():
            return "This lot has closed."
        if not self.gateway.session.logged_in:
            return "Log in to bid."
        return None

    def bid_preview(self, data: dict[str, list[str]], browser: dict[str, Any], browser_id: str) -> dict[str, Any]:
        context = self.context(self.return_query(data), browser)
        lot = self.store.lot(int(first(data, "id")))
        if not lot:
            raise ValueError("No such lot")
        row = make_row(lot, context["pickup"], context["settings"])
        if error := self.blocker(row):
            raise ValueError(error)
        kind = first(data, "type", "next_increment")
        if kind not in ("next_increment", "max_bid"):
            raise ValueError("Invalid bid type")
        amount = number(first(data, "amount", str(quick_bid(lot))))
        minimum = min_max_bid(lot) if kind == "max_bid" else quick_bid(lot)
        if amount < minimum:
            raise ValueError(f"The minimum bid is now {money(minimum)}. Review the lot and try again.")
        nonce = secrets.token_urlsafe(24)
        with self._confirmation_lock:
            now = now_ms()
            self._confirmations = {key: value for key, value in self._confirmations.items() if now - value[4] < 300_000}
            self._confirmations[nonce] = (browser_id, lot["id"], amount, kind, now)
        context.update(dialog="bid", bid_row=row, bid_amount=amount, bid_type=kind, nonce=nonce)
        return context

    def submit_bid(self, data: dict[str, list[str]], browser_id: str, context: dict[str, Any]) -> str:
        with self._confirmation_lock:
            confirmation = self._confirmations.pop(first(data, "nonce"), None)
        if not confirmation or confirmation[0] != browser_id or now_ms() - confirmation[4] > 300_000:
            raise ValueError("This confirmation expired or was already submitted. Check the lot before bidding again.")
        _, lot_id, amount, kind, _ = confirmation
        with self.gateway.bid_lock:
            lot = self.store.lot(lot_id)
            if not lot:
                raise ValueError("This lot is no longer open")
            row = make_row(lot, context["pickup"], context["settings"])
            if error := self.blocker(row):
                raise ValueError(error)
            minimum = min_max_bid(lot) if kind == "max_bid" else quick_bid(lot)
            if amount < minimum:
                raise ValueError(f"The price moved. The minimum bid is now {money(minimum)}. Review and confirm again.")
            if is_leading(lot) and (lot.get("yourStanding") or {}).get("yourMaxBid") == amount:
                raise ValueError("Your max bid is already set to this amount.")
            since = self.store.seq()
            try:
                result = self.gateway.request(
                    f"/v1/auctions/lots/{lot_id}/bids", "POST", {"amount": amount}, {"X-Bid-Surface": "other", "X-Bid-Type": kind}
                )
            finally:
                self.gateway.clear()
            patch: dict[str, Any] = {"hasBid": True, "yourStanding": {"isLeading": bool(result.get("is_leading")), "yourMaxBid": amount}}
            if result.get("version") is not None:
                patch["version"] = result["version"]
                if result.get("current_price") is not None:
                    patch["currentPrice"] = result["current_price"]
                if result.get("min_next_bid") is not None:
                    patch["nextMinIncrement"] = result["min_next_bid"]
            current = self.store.merge_lot(lot_id, patch, account=True, since=since)
            if current is None:
                return "Bid accepted; the lot is no longer in the live catalog."
            return "Bid placed - you are winning." if is_leading(current) else "Bid placed, but you are outbid by another bidder's maximum."

    def action(self, action: str, data: dict[str, list[str]], browser: dict[str, Any], browser_id: str) -> tuple[str, str]:
        query = self.return_query(data)
        context = self.context(query, browser)
        settings, view = context["settings"], context["view"]
        url, message = context["url"], ""
        key = first(data, "id")
        if action == "clear":
            view = {**DEFAULT_VIEW, **settings["tlxDefaultFilters"], "sort": view["sort"]}
            browser["tlxView"] = view
            url = view_url(view)
        elif action == "defaults":
            if "sort" in data:
                view = view_from_query(data)
                browser["tlxView"] = view
                url = view_url(view)
            self.store.put_setting("tlxDefaultFilters", {"categories": view["categories"], "conditions": view["conditions"]})
            message = "Category and condition defaults saved."
        elif action == "visit":
            self.visit(browser, settings)
        elif action == "refresh":
            result = self.api.catalog.request_pull()
            message = {
                "started": "Refresh requested.",
                "busy": "A refresh is already running.",
                "not-due": "The refresh interval has not passed.",
            }[result]
        elif action in ("hide", "unhide", "watch", "item-type"):
            lot = self.store.lot(int(key))
            if action == "unhide":
                hidden = settings["hiddenLots"]
                hidden.pop(key, None)
                self.store.put_setting("hiddenLots", hidden)
            elif not lot:
                raise ValueError("No such catalog lot")
            elif action == "hide":
                hidden = settings["hiddenLots"]
                hidden[str(lot["id"])] = {"title": lot["title"], "href": lot_href(lot), "ts": now_ms()}
                self.store.put_setting("hiddenLots", hidden)
            elif action == "watch":
                if not self.gateway.session.logged_in:
                    raise ValueError("Log in to use your watchlist.")
                from urllib.parse import quote

                path = f"/v1/auctions/control-panel/lots/{quote(str(lot['auctionPeriod']), safe='')}/{lot['id']}/watchlist/"
                on = not lot["isWatchlisted"]
                since = self.store.seq()
                self.gateway.request(path, "POST" if on else "DELETE", {} if on else None)
                self.store.merge_lot(lot["id"], {"isWatchlisted": on}, account=True, since=since)
            else:
                item_type = clean_type(first(data, "itemType"))
                if not item_type or len(item_type) > MAX_TYPE_LENGTH:
                    raise ValueError(f"Item type must be 1 to {MAX_TYPE_LENGTH} characters")
                self.store.save_item_types({lot["title"]: (item_type, (lot.get("category") or {}).get("value"))}, manual=True)
                message = "Item type saved for every listing with this exact title."
        elif action in ("search-save", "search-open", "search-delete", "search-rename"):
            searches = settings["tlxSavedSearches"]
            search = next((item for item in searches if item["id"] == key), None)
            if action == "search-save":
                name = first(data, "name").strip()
                if not name:
                    raise ValueError("Name is required")
                if not any(same_filters(view, item["view"]) for item in searches):
                    searches.append({
                        "id": secrets.token_hex(8),
                        "name": name,
                        "view": {k: v for k, v in view.items() if k != "newSince"},
                        "lastViewedAt": now_ms(),
                    })
            elif not search:
                raise ValueError("Saved search no longer exists")
            elif action == "search-open":
                since = search["lastViewedAt"]
                browser["highlight"] = {"id": key, "since": since}
                view = {**normalize_view(search["view"]), "newSince": since if first(data, "newOnly") else None}
                search["lastViewedAt"] = now_ms()
                browser["tlxView"] = view
                url = view_url(view)
            elif action == "search-delete":
                searches.remove(search)
            else:
                name = first(data, "name").strip()
                if not name:
                    raise ValueError("Name is required")
                search["name"] = name
            self.store.put_setting("tlxSavedSearches", searches)
        elif action.startswith("regex-"):
            words = settings["filterWords"]
            old, value = first(data, "old"), first(data, "pattern").strip()
            if action != "regex-delete":
                if not value:
                    raise ValueError("Pattern is required")
                try:
                    regex.compile(r"\b(?:" + value + r")\b", regex.I | regex.ASCII)
                except regex.error as error:
                    raise ValueError(f"Invalid regex: {error}") from error
            if action == "regex-add":
                words = list(dict.fromkeys([*words, value]))
            elif action == "regex-edit":
                words = [value if word == old else word for word in words]
            elif action == "regex-delete":
                words = [word for word in words if word != old]
            else:
                raise ValueError("Unknown regex action")
            self.store.put_setting("filterWords", words)
        elif action == "settings":
            minutes = number(first(data, "tlxSyncMinutes", "5"), minimum=1)
            match = name_match_pct(number(first(data, "tlxNameMatch", "90"), minimum=50))
            title_lines = min(100, int(number(first(data, "tlxTitleLines", "6"))))
            for setting in ("filterEnabled", "showHidden", "removeFiltered"):
                self.store.put_setting(setting, first(data, setting) == "on")
            self.store.put_setting("tlxPickup", first(data, "tlxPickup").strip() or None)
            self.store.put_setting("tlxSyncMinutes", minutes)
            self.store.put_setting("tlxNameMatch", match)
            browser["tlxTitleLines"] = title_lines
            self.api.catalog.history.wake()
        elif action == "categories":
            categories, renames = self.category_drafts(data)
            self.save_categories(categories, renames, browser)
            url = view_url(browser["tlxView"])
        elif action == "type-category":
            next_categories, name = self.category_plan(data, settings)
            self.save_categories(next_categories, {}, browser)
            browser["tlxLastCategory"] = name
            url = view_url(browser["tlxView"])
        elif action == "bid":
            message = self.submit_bid(data, browser_id, context)
        elif action == "site-login":
            error = self.gateway.session.login(first(data, "email").strip(), first(data, "password"))
            if error:
                raise ValueError(error)
            browser.pop("accountPickup", None)
            self.api.live.reconnect()
            self.api.catalog.request_pull()
        elif action == "site-logout":
            self.gateway.session.logout()
            browser.pop("accountPickup", None)
            self.api.live.reconnect()
        else:
            raise ValueError("Unknown action")
        browser["searchEntry"] = False
        return url, message
