# tampermonkey

## Triangle Liquidators – Hide, Filter & Bid Confirm

A separate, faster catalog for [triangleliquidators.com](https://triangleliquidators.com/), run as a web app (phones included) from a small server you run yourself.

- **Every live lot, held in the page.** Filtering and sorting run locally, so they make no requests.
- **Lot cards** show each lot's brand (when provided), location, condition, and assigned category, including custom categories. Brands already in the server's saved lot details arrive with the catalog, including after a refresh or on another device. For uncached items, brands load automatically as cards approach the viewport, two detail requests at a time, without opening the lot. Items known to have no brand are not fetched again just for their brand. Failed brand loads offer a retry on the card.
  Click the hide icon beside the category name to uncheck that category in the sidebar without changing other filters or individually hiding lots. This affects the displayed category only, not its subcategories (a parent's directly assigned lots are its “Other” row). With no category filter, it selects all other categories; hiding the last selected category shows no results. Check a category, choose “Show all categories”, or Clear to resume browsing. The selection is retained on reload, in shared URLs, and in saved searches and defaults.
- **Sort** by ending time, newly listed, title (A–Z / Z–A, grouped by item type, leading specs moved to the end), estimated total cost, % of retail, retail price, or bid count.
- **Item types:** the server names what each lot is (“pressure washer”, “area rug”) with an LLM, shown as a chip on each card. Click the chip to create a category of that type, with a suggested name and similar types to include. “New category” is always the default. If the lot already belongs to a custom category, the suggested full name creates a child under it (for example, “Tools - Drills - Cordless Drills”); otherwise the name defaults to the lot's site category and pluralized item type. Edit the full name to change where it nests. The parent is retained even if its last item type moves to the child. “Add to existing” defaults to the last category used or created in this browser, with nearby categories listed first; search by name to filter the list. See *Item types* under the server below for setup.
  Use the pencil beside the item type on a card or in its details to correct it, or “Set item type” if none is assigned. Pick an existing type from the suggestions or enter a short singular name. It saves in lowercase, updates sorting and category matching immediately, and applies to every listing with the exact same title, including future relistings. Corrections live on the server and automatic labelling cannot replace them; the explicit `itemtypes reset` command still clears all types, including corrections.
- **Filters:** search, category, condition, location, "available at my pickup location", bid / total / retail ranges, ending window, and *my lots* (bid on / winning / outbid / watchlist; picking one clears the other filters and also shows hidden and regex-filtered lots).
  Use “Expand all” or “Collapse all” under *Category* to open or close every level without changing selections. Click the focus icon (a dot inside four corners, with a “Show only…” tooltip) beside a category to replace your category selections with that one (including its subcategories for a parent). The focus icon beside a parent's “Other” row selects just its directly assigned lots. Search, condition, location and other filters stay unchanged; checkboxes still add or remove categories as before.
- **Default filters:** select categories and conditions, then use “Save category & condition defaults” under the filters. Clear restores those selections and clears the other filters while keeping the sort. To remove the defaults, uncheck all categories and conditions and save again (use “Show all categories” first if hiding the last category left no results). Defaults sync across devices and apply when a browser has no saved view; an existing view or a shared URL takes precedence.
- **Custom categories:** under *Category*, “Add / Edit custom categories” opens the editor. Edit category names and item types directly in each row, or add and delete categories. Item type suggestions omit types already in that category. Select a row to preview the open lots assigned to it. Categories are displayed alphabetically. Name a category “Parent - Name” to nest it under a site or custom category. A parent with children may be a group with no item types of its own and is retained when its last item type moves to a new child. Renames and deletions update current filters, defaults, and saved searches. Changes apply on Save.
  Categories match exact item types across all site categories; the first matching category alphabetically wins. Previously saved site restrictions are ignored, so lots may move to a different category. Previously saved title regexes no longer match, so add item types to any affected categories. In the filter, parents expand independently and select their whole branch; “Other” selects only directly assigned lots.
- **Duplicate listings combined:** listings of the same item in the same condition, at any location, show as one card with the cheapest total cost and a “+N more” badge; the popup lists them all. Titles count as the same item when they share enough of their words (*Settings* → *Same item when titles share*: from all words, ignoring case, punctuation and order, down to 60%; default 90%, which mostly catches a brand left off one title). A number only one title has (a size, pack count or “Qty 4”) never matches.
- **Past closing prices:** each card says what lots with the same name (matched the same way) sold for before, e.g. “Sold before for $12 (median of 4)”, counting only those in the same condition when there are any; hover for the recent ones. The popup lists every past close with its condition, location, bids and date. Starts empty and fills as lots close (see *Closed lots* below).
- **Hide lots and regex filters** (case-insensitive, whole-word: `\b(?:pattern)\b`). Filters are listed one per line with how many lots each matches; click a pattern to edit it (Enter saves, Esc cancels).
- **Saved searches:** save the current filters and search, then see at a glance how many matching lots were listed since you last opened each one (also shown in the tab title, e.g. “(3) TL Catalog”). Opening a search badges the new lots; “Show only new” narrows to them. Hidden and regex-filtered lots never count. A lot is new if it first appears in a full catalog refresh, so new listings show up within one refresh interval.
- **New badges everywhere:** outside a saved search, every lot listed since your previous visit gets a *New* badge, with a count and “Show only new” above the grid. A visit starts when the app loads, or when you come back to its tab after 30 minutes away; it's shared by all your devices. The first time, lots with more than 2 days left count as new.
- **Live prices** for the lots on screen over the site's own websocket, plus outbid/winning updates when logged in.
- **Infinite scrolling:** the grid shows 60 lots and adds 60 more each time you scroll near the end.
- **Lot details** (images, description, bid history) in a popup, with the site's *Similar auctions* that are still open along the bottom (a lot in the catalog opens in the popup, any other on the site).
- **Won / Lost pages:** *Closed: Won · Lost* under *my lots* shows the lots you won or lost, as the site's control panel lists them (the site keeps lost lots for 14 days), with each one's final price; for won lots also the estimated total with premium, lot fee and tax, and the sum. A filter box narrows the list. Click a lot for its details in the popup. Lots listed again under the same name (matched like duplicate listings) show as “N listings open now”, which opens the list of them, cheapest total first.
- **Condition descriptions:** hover a condition (filter, card or popup) for the site's description of it, or open *About conditions* under the Condition filter.
- **Shareable URLs:** the view lives in the address, e.g. `/tlx?search=dewalt&sort=price-low&category=tools&page=2&lot=123` (only non-default values appear; filters are `category`, `noCategories`, `condition`, `location`, `reachable`, `priceMin`, `priceMax`, `totalMax`, `retailMin`, `ending`, `mine`; `noCategories=1` explicitly shows no categories; `closed=won` or `closed=lost` shows that page). `page=N` means N batches of 60 lots were scrolled in. Opening such a URL loads that search, that many lots and the lot.
- **Back / forward buttons** step through filter, sort and search changes and opened lots, putting back the scroll position and the lots scrolled in so far (scrolling in more lots doesn't add an entry). Back closes an open lot popup; typing in the search box makes one history entry, not one per keystroke.
- **Watchlist:** star a lot on its card or in the popup to add or remove it from your site watchlist (the “Watchlist” filter under *my lots* shows them). As on the site, lots you've bid on can't be toggled.
- **Bidding** without leaving the app: a quick “Bid $N” (next increment) button on each card, and quick bid or max bid (or raise your max while winning) in the lot popup. Every bid asks to confirm first, showing the estimated total cost if you win and a warning when the lot is pickup-only elsewhere or needs a transfer. If the price moves while the confirmation is open, it won't send an amount the site would now reject. Bidding is disabled for hidden and filtered lots, closed lots, and when you're not logged in. Bids use the same request as the site's own bid buttons (`POST /v1/auctions/lots/{id}/bids`).

**Server load:** the full catalog (~50 requests) is pulled at most once per interval (default 5 minutes, configurable under Settings down to 1 minute). The interval is measured from the start of the last pull, failed or not. Pulls only run while an app tab is visible and has been used in the last 10 minutes. Pages are fetched one at a time. Opening a lot fetches only that lot (cached 2 minutes). Live updates subscribe only to the lots on screen, like the site does.

### Running the server

The app is served by a small server you run yourself (`server/`, Python 3.12+, standard library only). It works in any browser, phones included; "Add to Home Screen" gives it an app icon.

Build the web app once first (and again after pulling changes to `src/` or `web/`); it needs Node:

```bash
npm install && npm run build
```

Run `npm test` for the web app's regression tests.

### Client structure

The client uses Preact for rendering and signals for shared state and derived
views. One-shot startup waits for the first unlocked session. DOM setup and
cleanup belong to element refs; effects remain for ongoing synchronization and
data loading. Dialog refs are stable per instance, so opening a bid confirmation
above a lot never closes the underlying popup. Lot dialogs keep their outer dialog mounted while keyed contents
reset when switching lots, so image selection, details and scroll position do
not leak between listings.

Catalog replies merge in one place: newer live prices win, server metadata stays
authoritative, and pending item-type corrections survive older in-flight polls.

### Starting the server

```bash
cd server
python3 -m tlx_server                                             # this computer only: http://127.0.0.1:8765
TLX_PASSWORD='pick-one' python3 -m tlx_server --host 0.0.0.0      # also your phone: http://<computer's address>:8765
python3 -m tlx_server --help                                      # --port, --db, --background-minutes, --llm-key, --tls-cert/--tls-key, ...
```

The app can't call the site directly, because the site's API doesn't allow other origins and its websocket only accepts its own pages. So the server stands in for the site:

- **Your login.** Use *Log in* (in the banner, the lot popup, or *Settings*) to have the server sign in to Triangle Liquidators. Your password is sent to the site once and isn't stored. The server keeps the site's session cookies, so you stay logged in, and refreshes the API token as needed. *Log out* signs the server out.
- **The site's API.** Lot details, bids and the watchlist go through the server at `/backend/...`, with your token added. A rejected token is refreshed and the request retried once, as the site's own client does.
- **Live prices.** The server relays the site's websocket byte for byte, presenting itself with the site's Origin.
- **The catalog.** The server pulls the catalog and stores it in SQLite, with the load rules above: at most once per interval, measured from the start of the last pull, pages fetched one at a time, and only while some open app tab is visible and in use. Each tab fetches only what changed since its last check, about every 15 seconds. With `--background-minutes N` it also pulls every N minutes when no one has the app open, so saved searches keep counting new lots.
- **Item types.** With an API key for an OpenAI-compatible LLM (`--llm-key` or `TLX_LLM_KEY`), the server names each new lot title's item type after every pull, in batches of 40 titles from one site category with the types that category already uses, so the same kind of item gets the same name. Types are stored by title, so relisted lots cost nothing. The default is Ministral 3 14B on [nano-gpt.com](https://nano-gpt.com) (`--llm-url`, `--llm-model` or `TLX_LLM_URL`, `TLX_LLM_MODEL` to change it); labelling the whole catalog once costs a few cents. Without a key lots have no item type, and everything else works as before.
- **Closed lots.** When a lot leaves the catalog, the server keeps a small row of it (title, price, bids, condition, location; about 200 bytes, so well under 100 MB a year) and, after the pull, asks the site once for its final price and whether it sold, one lot at a time with a short pause between. Lots get most of their bids in the last minutes, so the last price a pull saw is often low; a popup marks with * any price the site couldn't confirm. Closed lots are kept for good.
- **Synced settings.** Hidden lots, regex filters, custom categories, default category and condition filters, saved searches, your pickup location, name matching and the refresh interval live on the server, so your phone and computer share them. The current filters and collapsed panels stay per device.
  Legacy numeric timestamps in browser-local settings are discarded; synced timestamps are restored from the server. Without a server copy, saved-search timestamps start at the Unix epoch and the current “new only” filter is cleared.

**Security.** The server is logged in as you and can bid, so treat it like a password:

- **Password.** Listening anywhere but this computer requires `--password` (or `TLX_PASSWORD`). Each device enters it once and gets a 90-day session cookie (`HttpOnly`, `SameSite=Strict`). *Lock app* in *Settings* forgets it on that device.
- **Other websites.** State-changing requests must carry a header that other websites can't add, and websocket connections must come from the app's own address. Without a password, only `localhost` addresses are accepted.
- **Encryption.** On your home Wi‑Fi the connection is plain HTTP. For HTTPS, either pass `--tls-cert`/`--tls-key`, or put it behind something like `tailscale serve`, which also reaches it away from home. The server honors `X-Forwarded-Proto: https` from such a proxy.
- **Data.** The SQLite file (default `~/.local/share/tlx-server/tlx.db`, mode 600) holds the catalog, closed lots, item types, settings and the site session. Each lot is a row of `lots`, with its category, condition and location in lookup tables, its images in `lot_images` and its recent past closes in `lot_past_closes` (pointing at `closed_lots`); its item type comes from `item_types` by title. The last detail the server fetched for each lot (when you open it in the app, or when it asks for a closed lot's final price) is kept in `lot_details`: description, brand, model, lot fee and bid history (JSON), with `fetched_at`; it stays after the lot closes. A database from before this layout is converted on start.

### Development

Source is in `src/` (TypeScript + Preact, bundled with Vite). The build goes to
`server/tlx_server/static/`, which git ignores.

```bash
npm install
npm run build     # lint, typecheck, then build the web app
npm run typecheck # check TypeScript and included JavaScript with strict compiler options
npm run lint      # disallow explicit TypeScript any types
npm run dev       # web app with hot reload; API calls go to a tlx server on 127.0.0.1:8765
```

The type check also validates declaration files and enables additional checks for
optional properties, indexed access, unused code, and control flow.

Python is formatted with [ruff](https://docs.astral.sh/ruff/) (`pipx install ruff`). A
pre-commit hook in `githooks/` runs `ruff format` on the Python files being committed and
re-stages them; enable it once per clone:

```bash
git config core.hooksPath githooks
```

- `src/web.tsx` and `web/`: the web app entry, page and icons.
- `src/app/`: the catalog view. `catalog.ts` holds the in-memory catalog, `source.ts` fetches it from the server, `auth.tsx` handles the server's login and the app password, and `settings.ts` keeps settings in `localStorage` (and syncs some to the server).
- `server/tlx_server/`: the Python server: `site.py` API client, `session.py` site login, `catalog.py` pulls, `itemtypes.py` item types, `history.py` closed lots and past prices, `store.py` SQLite, `server.py` HTTP (app, proxy, websocket relay).
- `src/shared/`: filters, cost formula, title sort key, name matching (mirrored in `history.py`) and settings keys.
