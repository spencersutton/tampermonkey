# tampermonkey

Personal userscripts.

## Triangle Liquidators – Hide, Filter & Bid Confirm

Adds to [triangleliquidators.com](https://triangleliquidators.com/):

### Catalog view – [`/tlx`](https://triangleliquidators.com/tlx)

A separate, faster catalog that replaces the site's interface on that one URL. Everything else on the site is unchanged.

- **Every live lot, cached locally** (IndexedDB). Filtering and sorting run locally, so they make no requests.
- **Sort** by ending time, newly listed, title (A–Z / Z–A, leading specs moved to the end), estimated total cost, % of retail, retail price, or bid count.
- **Filters:** search, category, condition, location, "available at my pickup location", bid / total / retail ranges, ending window, and *my lots* (bid on / winning / outbid / watchlist).
- **Hide lots and regex filters** shared with the site pages below. Filters are listed one per line with how many lots each matches; click a pattern to edit it (Enter saves, Esc cancels).
- **Saved searches:** save the current filters and search, then see at a glance how many matching lots were listed since you last opened each one (also shown in the tab title, e.g. “(3) TL Catalog”). Opening a search badges the new lots; “Show only new” narrows to them. Hidden and regex-filtered lots never count. A lot is new if it first appears in a full catalog refresh, so new listings show up within one refresh interval.
- **Live prices** for the lots on screen over the site's own websocket, plus outbid/winning updates when logged in.
- **Lot details** (images, description, bid history) in a popup; bidding links to the real lot page.

**Server load:** the full catalog (~50 requests) is pulled at most once per interval (default 5 minutes, configurable under Settings down to 1 minute). The interval is measured from the start of the last pull, failed or not. Pulls only run while a `/tlx` tab is visible and has been used in the last 10 minutes, and only one tab pulls at a time. Pages are fetched one at a time. Opening a lot fetches only that lot (cached 2 minutes). Live updates subscribe only to the lots on screen, like the site does.

### On the site's own pages

- **Hide lots**: eye button on each card; hidden lots are listed (collapsible) in the Filters panel.
- **Regex filters**: lots whose title matches are grayed out with bidding disabled. Patterns are case-insensitive and always match whole words (`\b(?:pattern)\b`).
- **Bid confirmation**: optional confirm dialog for Max bid / Raise max bid / Set max bid and quick `+$N` bids.
- **Estimated total cost** next to the current bid: `(bid × 1.15 + $1 [+ $5 for Anderson/Transferable]) × 1.0725`.
- **Catalog view →** link next to “All Auctions”.

**Install:** with Tampermonkey installed, open
[triangle-liquidators.user.js (raw)](https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js).
Tampermonkey auto-updates from that URL whenever `@version` increases.

### Development

Source is in `src/` (TypeScript + Preact, bundled with Vite and `vite-plugin-monkey`). The built
`triangle-liquidators.user.js` at the repo root is committed so the install/update URL keeps working.

```bash
npm install
npm run build   # typecheck, bundle, copy to ./triangle-liquidators.user.js
```

- `src/main.ts`: routes `/tlx` to the catalog app, everything else to the site enhancements.
- `src/legacy/`: enhancements for the site's own pages.
- `src/app/`: the catalog view (`catalog.ts` holds the caching and rate-limit rules).
- `src/shared/`: filters, cost formula, title sort key and settings keys used by both.
