# tampermonkey

Personal userscripts.

## Triangle Liquidators – Hide, Filter & Bid Confirm

A separate, faster catalog for [triangleliquidators.com](https://triangleliquidators.com/) at [`/tlx`](https://triangleliquidators.com/tlx). It replaces the site's interface on that one URL; the script doesn't run on any other page.

- **Every live lot, cached locally** (IndexedDB). Filtering and sorting run locally, so they make no requests.
- **Sort** by ending time, newly listed, title (A–Z / Z–A, leading specs moved to the end), estimated total cost, % of retail, retail price, or bid count.
- **Filters:** search, category, condition, location, "available at my pickup location", bid / total / retail ranges, ending window, and *my lots* (bid on / winning / outbid / watchlist; picking one clears the other filters and also shows hidden and regex-filtered lots).
- **Custom categories:** under *Category*, “Add / Edit custom categories” opens an editor where each category gets a name and a title regex (same rules as the filters below). Matching lots move out of their site category into yours, e.g. “Pressure Washer” = `pressure washers?` pulls them out of Tools. Set *Only within* to a site category to take lots from that one only, e.g. `corded.*` within Tools. A lot goes in the first matching category, so order matters: drag rows or use the arrows to reorder. Each row shows how many open lots it takes, and the selected one lists them. Renaming keeps your current filters and saved searches pointed at the category. Changes apply on Save.
- **Hide lots and regex filters** (case-insensitive, whole-word: `\b(?:pattern)\b`). Filters are listed one per line with how many lots each matches; click a pattern to edit it (Enter saves, Esc cancels).
- **Saved searches:** save the current filters and search, then see at a glance how many matching lots were listed since you last opened each one (also shown in the tab title, e.g. “(3) TL Catalog”). Opening a search badges the new lots; “Show only new” narrows to them. Hidden and regex-filtered lots never count. A lot is new if it first appears in a full catalog refresh, so new listings show up within one refresh interval.
- **Stays logged in** like the site does: since `/tlx` doesn't load the site's own code, it makes the site's session check itself (on load, on tab focus, before the token expires, and after a rejected request), which keeps the login cookie fresh. Logging in or out in another tab is picked up without a reload.
- **Live prices** for the lots on screen over the site's own websocket, plus outbid/winning updates when logged in.
- **Infinite scrolling:** the grid shows 60 lots and adds 60 more each time you scroll near the end.
- **Lot details** (images, description, bid history) in a popup.
- **Shareable URLs:** the view lives in the address, e.g. `/tlx?search=dewalt&sort=price-low&category=tools&page=2&lot=123` (only non-default values appear; filters are `category`, `condition`, `location`, `reachable`, `priceMin`, `priceMax`, `totalMax`, `retailMin`, `ending`, `mine`). `page=N` means N batches of 60 lots were scrolled in. Opening such a URL loads that search, that many lots and the lot.
- **Back / forward buttons** step through filter, sort and search changes and opened lots, putting back the scroll position and the lots scrolled in so far (scrolling in more lots doesn't add an entry). Back closes an open lot popup; typing in the search box makes one history entry, not one per keystroke.
- **Watchlist:** star a lot on its card or in the popup to add or remove it from your site watchlist (the “Watchlist” filter under *my lots* shows them). As on the site, lots you've bid on can't be toggled.
- **Bidding** without leaving `/tlx`: a quick “Bid $N” (next increment) button on each card, and quick bid or max bid (or raise your max while winning) in the lot popup. Every bid asks to confirm first, showing the estimated total cost if you win and a warning when the lot is pickup-only elsewhere or needs a transfer. If the price moves while the confirmation is open, it won't send an amount the site would now reject. Bidding is disabled for hidden and filtered lots, closed lots, and when you're not logged in. Bids use the same request as the site's own bid buttons (`POST /v1/auctions/lots/{id}/bids`).

**Server load:** the full catalog (~50 requests) is pulled at most once per interval (default 5 minutes, configurable under Settings down to 1 minute). The interval is measured from the start of the last pull, failed or not. Pulls only run while a `/tlx` tab is visible and has been used in the last 10 minutes, and only one tab pulls at a time. Pages are fetched one at a time. Opening a lot fetches only that lot (cached 2 minutes). Live updates subscribe only to the lots on screen, like the site does.

**Install:** with Tampermonkey installed, open
[triangle-liquidators.user.js (raw)](https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js).
Tampermonkey auto-updates from that URL whenever `@version` increases.

### Web app (no Tampermonkey: phones, any browser)

The same catalog also runs as an ordinary web app, served by a small server you run yourself (`server/`, Python 3.12+, standard library only). That's the way to use it on a phone, where Tampermonkey isn't available. It has the same filters, sorting, saved searches, lot popup, live prices and confirmed bidding. "Add to Home Screen" gives it an app icon.

```bash
cd server
python3 -m tlx_server                                             # this computer only: http://127.0.0.1:8765
TLX_PASSWORD='pick-one' python3 -m tlx_server --host 0.0.0.0      # also your phone: http://<computer's address>:8765
python3 -m tlx_server --help                                      # --port, --db, --background-minutes, --tls-cert/--tls-key, ...
```

The app can't call the site directly, because the site's API doesn't allow other origins and its websocket only accepts its own pages. So the server stands in for the site:

- **Your login.** Use *Log in* (in the banner, the lot popup, or *Settings*) to have the server sign in to Triangle Liquidators. Your password is sent to the site once and isn't stored. The server keeps the site's session cookies, so you stay logged in, and refreshes the API token as needed. *Log out* signs the server out.
- **The site's API.** Lot details, bids and the watchlist go through the server at `/backend/...`, with your token added. A rejected token is refreshed and the request retried once, as the site's own client does.
- **Live prices.** The server relays the site's websocket byte for byte, presenting itself with the site's Origin.
- **The catalog.** The server pulls the catalog and stores it in SQLite, with the same load rules as the userscript: at most once per interval, measured from the start of the last pull, pages fetched one at a time, and only while some open app tab is visible and in use. Each tab fetches only what changed since its last check, about every 15 seconds. With `--background-minutes N` it also pulls every N minutes when no one has the app open, so saved searches keep counting new lots.
- **Synced settings.** Hidden lots, regex filters, custom categories, saved searches, your pickup location and the refresh interval live on the server, so your phone and computer share them. The current filters and collapsed panels stay per device.

**Security.** The server is logged in as you and can bid, so treat it like a password:

- **Password.** Listening anywhere but this computer requires `--password` (or `TLX_PASSWORD`). Each device enters it once and gets a 90-day session cookie (`HttpOnly`, `SameSite=Strict`). *Lock app* in *Settings* forgets it on that device.
- **Other websites.** State-changing requests must carry a header that other websites can't add, and websocket connections must come from the app's own address. Without a password, only `localhost` addresses are accepted.
- **Encryption.** On your home Wi‑Fi the connection is plain HTTP. For HTTPS, either pass `--tls-cert`/`--tls-key`, or put it behind something like `tailscale serve`, which also reaches it away from home. The server honors `X-Forwarded-Proto: https` from such a proxy.
- **Data.** The SQLite file (default `~/.local/share/tlx-server/tlx.db`, mode 600) holds the catalog, settings and the site session.

### Development

Source is in `src/` (TypeScript + Preact, bundled with Vite and `vite-plugin-monkey`). Both builds are
committed: `triangle-liquidators.user.js` at the repo root, so the install/update URL keeps working, and the
web app in `server/tlx_server/static/`, so the server runs without Node.

```bash
npm install
npm run build     # typecheck, then build the userscript and the web app
npm run dev:web   # web app with hot reload; API calls go to a tlx server on 127.0.0.1:8765
```

- `src/main.ts`: the userscript entry; takes over `/tlx` with the catalog app. `src/web.tsx` and `web/`: the web app entry, page and icons.
- `src/app/`: the catalog view. `catalog.ts` holds the shared in-memory catalog. Modules that differ between the builds are imported by alias: `@source` (where pulls come from: `source-local.tsx` with IndexedDB and the rate-limit rules, or `source-web.tsx`), `@auth` (`auth-site.tsx`, the site's own login cookie, or `auth-web.tsx`, the server's login and the app password) and `@storage` (GM storage or `localStorage`).
- `server/tlx_server/`: the Python server: `site.py` API client, `session.py` site login, `catalog.py` pulls, `store.py` SQLite, `server.py` HTTP (app, proxy, websocket relay).
- `src/shared/`: filters, cost formula, title sort key and settings keys.
