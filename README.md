# tampermonkey

Personal userscripts.

## Triangle Liquidators – Hide, Filter & Bid Confirm

Adds to [triangleliquidators.com](https://triangleliquidators.com/):

- **Hide lots**: eye button on each card; hidden lots are listed (collapsible) in the Filters panel.
- **Regex filters**: lots whose title matches are grayed out with bidding disabled. Patterns are case-insensitive and always match whole words (`\b(?:pattern)\b`).
- **Bid confirmation**: optional confirm dialog for Max bid / Raise max bid / Set max bid and quick `+$N` bids.
- **Estimated total cost** next to the current bid: `(bid × 1.15 + $1 [+ $5 for Anderson/Transferable]) × 1.0725`.

**Install:** with Tampermonkey installed, open
[triangle-liquidators.user.js (raw)](https://raw.githubusercontent.com/spencersutton/tampermonkey/main/triangle-liquidators.user.js).
Tampermonkey auto-updates from that URL whenever `@version` increases.
