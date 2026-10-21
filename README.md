# tampermonkey

Personal userscripts.

## Triangle Liquidators – Hide, Filter & Bid Confirm

A separate, faster catalog for [triangleliquidators.com](https://triangleliquidators.com/) at [`/tlx`](https://triangleliquidators.com/tlx). It replaces the site's interface on that one URL; the script doesn't run on any other page.

- **Every live lot, cached locally** (IndexedDB). Filtering and sorting run locally, so they make no requests.
- **Sort** by ending time, newly listed, title (A–Z / Z–A, leading specs moved to the end), estimated total cost, % of retail, retail price, or bid count.
- **Filters:** search, category, condition, location, "available at my pickup location", bid / total / retail ranges, ending window, and *my lots* (bid on / winning / outbid / watchlist).
- **Custom categories:** under *Category*, “Add / Edit custom categories” opens an editor where each category gets a name and a title regex (same rules as the filters below). Matching lots move out of their site category into yours, e.g. “Pressure Washer” = `pressure washers?` pulls them out of Tools. A lot goes in the first matching category, so order matters: drag rows or use the arrows to reorder. Each row shows how many open lots it takes, and the selected one lists them. Renaming keeps your current filters and saved searches pointed at the category. Changes apply on Save.
- **Hide lots and regex filters** (case-insensitive, whole-word: `\b(?:pattern)\b`). Filters are listed one per line with how many lots each matches; click a pattern to edit it (Enter saves, Esc cancels).
- **Saved searches:** save the current filters and search, then see at a glance how many matching lots were listed since you last opened each one (also shown in the tab title, e.g. “(3) TL Catalog”). Opening a search badges the new lots; “Show only new” narrows to them. Hidden and regex-filtered lots never count. A lot is new if it first appears in a full catalog refresh, so new listings show up within one refresh interval.
- **Stays logged in** like the site does: since `/tlx` doesn't load the site's own code, it makes the site's session check itself (on load, on tab focus, before the token expires, and after a rejected request), which keeps the login cookie fresh. Logging in or out in another tab is picked up without a reload.
- **Live prices** for the lots on screen over the site's own websocket, plus outbid/winning updates when logged in.
- **Lot details** (images, description, bid history) in a popup.
- **Shareable URLs:** the view lives in the address, e.g. `/tlx?search=dewalt&sort=price-low&category=tools&page=2&lot=123` (only non-default values appear; filters are `category`, `condition`, `location`, `reachable`, `priceMin`, `priceMax`, `totalMax`, `retailMin`, `ending`, `mine`). Opening such a URL loads that search, page and lot.
- **Back / forward buttons** step through filter, sort, search and page changes and opened lots, putting the scroll position back. Back closes an open lot popup; typing in the search box makes one history entry, not one per keystroke.
- **Watchlist:** star a lot on its card or in the popup to add or remove it from your site watchlist (the “Watchlist” filter under *my lots* shows them). As on the site, lots you've bid on can't be toggled.
- **Bidding** without leaving `/tlx`: a quick “Bid $N” (next increment) button on each card, and quick bid or max bid (or raise your max while winning) in the lot popup. Every bid asks to confirm first, showing the estimated total cost if you win and a warning when the lot is pickup-only elsewhere or needs a transfer. If the price moves while the confirmation is open, it won't send an amount the site would now reject. Bidding is disabled for hidden and filtered lots, closed lots, and when you're not logged in. Bids use the same request as the site's own bid buttons (`POST /v1/auctions/lots/{id}/bids`).

**Server load:** the full catalog (~50 requests) is pulled at most once per interval (default 5 minutes, configurable under Settings down to 1 minute). The interval is measured from the start of the last pull, failed or not. Pulls only run while a `/tlx` tab is visible and has been used in the last 10 minutes, and only one tab pulls at a time. Pages are fetched one at a time. Opening a lot fetches only that lot (cached 2 minutes). Live updates subscribe only to the lots on screen, like the site does.

**Install:** with Tampermonkey installed, open
[triangle-liquidators.user.js (raw)](https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js).
Tampermonkey auto-updates from that URL whenever `@version` increases.

### Server version

A second build, [triangle-liquidators-server.user.js (raw)](https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators-server.user.js), gets the catalog from your own small server (`server/`, Python 3.12+, standard library only). Install this script **or** the standalone one, not both, since both take over `/tlx`.

The page works the same way, with these differences:

- **The server pulls the catalog** and stores it in SQLite, with the same load rules: at most once per interval, measured from the start of the last pull, and pages fetched one at a time. It also pulls only while some `/tlx` tab is visible and in use. Each tab fetches only the lots that changed since its last check, about every 15 seconds.
- **Shared history.** A lot's first-seen time, which drives the saved-search "new" counts, is recorded once on the server, so it agrees across browsers and devices.
- **Synced settings.** The server stores hidden lots, regex filters, custom categories, saved searches, your pickup location and the refresh interval. Every browser using that server shares them. The current filters and collapsed panels stay per browser. On the first connection, any setting the server doesn't have yet is copied up from this browser.
- **Optional background pulls.** With `--background-minutes N`, the server also pulls every N minutes when no tab is open, so saved searches keep counting new lots.
- **Login.** To include your standing and watchlist, the page passes the site login token to the server with each check. The server keeps the token in memory only. If the token has expired, for example during a background pull, the server pulls anonymously and keeps the account fields from the previous pull.
- **What stays in the page.** Bidding, the watchlist star, lot details and live prices still go straight from the page to the site, as before.

```bash
cd server
python3 -m tlx_server                  # http://127.0.0.1:8765, data in ~/.local/share/tlx-server/
python3 -m tlx_server --help           # --port, --db, --background-minutes, --key, --allow-host
```

If the server runs somewhere other than this machine, start it with `--host 0.0.0.0 --allow-host <its name> --key <secret>`. Then set the address and key under *Settings* on `/tlx`, and Tampermonkey will ask once to allow the connection. The server accepts only requests that carry the userscript's `X-TLX-Client` header and a known `Host`, and it sends no CORS headers, so other websites can't use it.

### Development

Source is in `src/` (TypeScript + Preact, bundled with Vite and `vite-plugin-monkey`). The built
`triangle-liquidators.user.js` at the repo root is committed so the install/update URL keeps working.

```bash
npm install
npm run build   # typecheck, bundle both builds, copy them to the repo root
```

- `src/main.ts`: takes over `/tlx` with the catalog app.
- `src/app/`: the catalog view. `catalog.ts` holds the shared in-memory catalog. `@source` is where pulls come from: `source-local.tsx` (IndexedDB, rate-limit rules) in the standalone build, `source-server.tsx` in the server build (`vite build --mode server`).
- `server/tlx_server/`: the Python server (`site.py` API client, `catalog.py` pulls, `store.py` SQLite, `server.py` HTTP).
- `src/shared/`: filters, cost formula, title sort key and settings keys.
