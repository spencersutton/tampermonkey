// Enhancements for the site's own pages (everything except /tlx): hide lots,
// regex filters, bid confirmation, title sort and estimated total cost.
export function runLegacy() {
  'use strict';

  // ---------------------------------------------------------------------------
  // Settings (persisted via GM storage, synced across tabs)
  // ---------------------------------------------------------------------------
  const KEYS = {
    hidden: 'hiddenLots',        // { [lotId]: { title, href, ts } }
    words: 'filterWords',        // string[]
    filterOn: 'filterEnabled',   // boolean
    confirm: 'confirmBids',      // boolean
    showHidden: 'showHidden',    // boolean
    removeFiltered: 'removeFiltered', // boolean – drop filtered lots from the page entirely
    titleSort: 'titleSort',      // null | 'asc' | 'desc' – sort all matching lots by title
    collapsed: 'collapsedLists', // { words: boolean, hidden: boolean }
  };
  const DEFAULTS = {
    [KEYS.hidden]: {},
    [KEYS.words]: [],
    [KEYS.filterOn]: true,
    [KEYS.confirm]: true,
    [KEYS.showHidden]: false,
    [KEYS.removeFiltered]: false,
    [KEYS.titleSort]: null,
    [KEYS.collapsed]: { words: false, hidden: false },
  };

  // Estimated total cost = (bid + buyer's premium + lot fee [+ transfer fee]) × (1 + sales tax)
  const FEES = {
    premium: 0.15,     // 15% buyer's premium
    lotFee: 1,         // $1 per lot
    transferFee: 5,    // $5 for Anderson / Transferable lots
    salesTax: 0.0725,  // 7.25% NC sales tax
  };

  const state = {};
  for (const k of Object.values(KEYS)) state[k] = GM_getValue(k, DEFAULTS[k]);

  function apply(key, value) {
    state[key] = value;
    if (key === KEYS.words) wordRegexes = buildRegexes(value);
    scheduleScan();
  }

  function save(key, value) {
    GM_setValue(key, value);
    apply(key, value);
  }

  if (typeof GM_addValueChangeListener === 'function') {
    for (const k of Object.values(KEYS)) {
      GM_addValueChangeListener(k, (_name, _old, val, remote) => {
        if (remote) apply(k, val);
      });
    }
  }

  // Each filter is a case-insensitive regex tested against the lot title.
  // Every pattern is implicitly whole-word: \b(?:pattern)\b.
  // Returns null for an invalid pattern.
  function compileFilter(pattern) {
    const src = `\\b(?:${pattern})\\b`;
    try {
      return new RegExp(src, 'i');
    } catch {
      return null;
    }
  }

  function buildRegexes(words) {
    return words
      .filter((w) => w.trim())
      .map((w) => ({ word: w, re: compileFilter(w) }));
  }
  let wordRegexes = buildRegexes(state[KEYS.words]);

  // Split a comma-separated filter list. Commas inside (...), [...], {...} or
  // escaped as \, stay part of the pattern, so quantifiers like {1,3} survive.
  function splitFilters(text) {
    const out = [];
    let cur = '';
    let depth = 0;
    let inClass = false;
    let escaped = false;
    for (const ch of text) {
      if (escaped) {
        cur += ch;
        escaped = false;
      } else if (ch === '\\') {
        cur += ch;
        escaped = true;
      } else if (inClass) {
        if (ch === ']') inClass = false;
        cur += ch;
      } else if (ch === '[') {
        inClass = true;
        cur += ch;
      } else if (ch === ',' && depth === 0) {
        out.push(cur);
        cur = '';
      } else {
        if (ch === '(' || ch === '{') depth++;
        else if ((ch === ')' || ch === '}') && depth > 0) depth--;
        cur += ch;
      }
    }
    out.push(cur);
    return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
  }

  // Adds a pattern; returns false if it isn't a valid regex.
  function addFilter(pattern) {
    if (!compileFilter(pattern)) return false;
    if (!state[KEYS.words].includes(pattern)) save(KEYS.words, [...state[KEYS.words], pattern]);
    return true;
  }

  function matchFilter(title) {
    if (!state[KEYS.filterOn]) return null;
    for (const { word, re } of wordRegexes) if (re && re.test(title)) return word;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Small DOM helpers
  // ---------------------------------------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    visibilityOff:
      'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7M2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2m4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3z',
    visibility:
      'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5M12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5m0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3',
    cancel:
      'M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2m5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12z',
    filter: 'M10 18h4v-2h-4zM3 6v2h18V6zm3 7h12v-2H6z',
    expandMore: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
  };

  function icon(name, size = 16) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONS[name]);
    p.setAttribute('fill', 'currentColor');
    svg.appendChild(p);
    return svg;
  }

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  // Stop the event from reaching the site's own handlers (carousel drag, card link, etc.)
  function swallow(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // ---------------------------------------------------------------------------
  // Styles – built on the site's MUI CSS variables so light/dark both work
  // ---------------------------------------------------------------------------
  GM_addStyle(`
    .tlx-slot-hidden, .tlx-native-hidden { display: none !important; }

    /* Title sort */
    .tlx-sort-toggle {
      display: inline-flex; margin-left: 12px; vertical-align: middle; overflow: hidden;
      border: 1px solid var(--mui-palette-divider); border-radius: var(--mui-shape-borderRadius, 4px);
    }
    .tlx-sort-toggle button {
      padding: 3px 10px; border: 0; background: none; cursor: pointer;
      font: 500 13px/1.75 Roboto, Helvetica, Arial, sans-serif; letter-spacing: .02857em;
      color: var(--mui-palette-text-secondary);
    }
    .tlx-sort-toggle button + button { border-left: 1px solid var(--mui-palette-divider); }
    .tlx-sort-toggle button:hover { background: var(--mui-palette-action-hover); }
    .tlx-sort-toggle button[aria-pressed="true"] {
      color: var(--mui-palette-primary-main); background: rgba(var(--mui-palette-primary-mainChannel) / .08);
    }
    .tlx-sorted-bar {
      display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 16px;
      font: 400 14px/1.43 Roboto, Helvetica, Arial, sans-serif; color: var(--mui-palette-text-secondary);
    }
    .tlx-sorted-error { color: var(--mui-palette-error-main); }
    .tlx-progress {
      flex-basis: 100%; height: 4px; border-radius: 2px; overflow: hidden;
      background: rgba(var(--mui-palette-primary-mainChannel) / .2);
    }
    .tlx-progress > span { display: block; height: 100%; background: var(--mui-palette-primary-main); transition: width .2s; }
    .tlx-view-btn {
      display: flex; align-items: center; justify-content: center; min-height: 36px; padding: 6px 16px;
      border-radius: var(--mui-shape-borderRadius, 4px); text-decoration: none; box-sizing: border-box;
      font: 500 14px/1.75 Roboto, Helvetica, Arial, sans-serif; letter-spacing: .02857em; text-transform: uppercase;
      background: var(--mui-palette-primary-main); color: var(--mui-palette-primary-contrastText, #fff);
      box-shadow: var(--mui-shadows-2, 0 1px 3px rgba(0,0,0,.3));
    }
    .tlx-view-btn:hover { box-shadow: var(--mui-shadows-4, 0 2px 6px rgba(0,0,0,.3)); filter: brightness(1.1); }
    .tlx-pager { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 4px; margin-top: 32px; }
    .tlx-pager button {
      min-width: 40px; height: 40px; padding: 0 10px; border: 0; border-radius: 20px; background: none; cursor: pointer;
      font: 400 15px/1 Roboto, Helvetica, Arial, sans-serif; color: var(--mui-palette-text-primary);
    }
    .tlx-pager button:hover:not(:disabled) { background: var(--mui-palette-action-hover); }
    .tlx-pager button[aria-current="page"] { background: var(--mui-palette-action-selected, rgba(0,0,0,.08)); }
    .tlx-pager button:disabled { opacity: .38; cursor: default; }
    .tlx-pager-gap { min-width: 32px; text-align: center; color: var(--mui-palette-text-primary); }

    /* Compact grid: the catalog grid separates rows with full-width <hr>s at
       fixed DOM positions (one set per breakpoint). Once cards are removed
       those leave partial rows, so hide them and draw our own separators
       between the rows of cards that are still visible. */
    .tlx-compact > hr { display: none !important; }
    .tlx-compact > .tlx-later-row { margin-top: var(--tlx-row-sep); }
    .tlx-compact > .tlx-row-start { position: relative; }
    .tlx-compact > .tlx-row-start::before {
      content: ''; position: absolute; left: 0; pointer-events: none;
      top: calc((var(--tlx-row-gap) + var(--tlx-row-sep)) / -2);
      width: calc(var(--tlx-cols) * 100% + (var(--tlx-cols) - 1) * var(--tlx-col-gap));
      border-top: 1px solid var(--mui-palette-divider);
    }
    .tlx-dim { opacity: .45; filter: grayscale(1); transition: opacity .15s; }
    .tlx-dim:hover { opacity: .7; }
    .tlx-dim [data-tlx-disabled] { pointer-events: none !important; cursor: default !important; }

    .tlx-hide-btn {
      position: absolute; top: 46px; left: 8px; z-index: 2;
      width: 32px; height: 32px; padding: 0; border: 0; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
      background: var(--mui-palette-background-paper, #fff);
      color: var(--mui-palette-action-active, rgba(0,0,0,.54));
      transition: box-shadow .15s, color .15s;
    }
    .tlx-hide-btn:hover { box-shadow: var(--mui-shadows-3, 0 2px 4px rgba(0,0,0,.25)); color: var(--mui-palette-text-primary); }
    .tlx-hide-btn:focus-visible { outline: 2px solid var(--mui-palette-primary-main, #0E3A7E); outline-offset: 2px; }

    .tlx-badge {
      position: absolute; left: 8px; bottom: 8px; z-index: 2; max-width: calc(100% - 16px);
      display: inline-flex; align-items: center; gap: 4px;
      height: 24px; padding: 0 8px; border-radius: 16px; box-sizing: border-box;
      font: 500 12px/1 var(--mui-font-family, Roboto, Helvetica, Arial, sans-serif);
      background: var(--mui-palette-background-paper, #fff);
      color: var(--mui-palette-text-primary);
      border: 1px solid var(--mui-palette-divider);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
    }

    /* Sidebar section */
    .tlx-section {
      padding-bottom: 16px; border-bottom: 1px solid var(--mui-palette-divider);
      font-family: Roboto, Helvetica, Arial, sans-serif; color: var(--mui-palette-text-primary);
      display: flex; flex-direction: column; gap: 10px;
    }
    .tlx-section-title { margin: 0; font-size: 14px; line-height: 1.43; font-weight: 500; }
    .tlx-caption { margin: 0; font-size: 12px; line-height: 1.66; color: var(--mui-palette-text-secondary); }

    .tlx-input-wrap {
      position: relative; display: flex; align-items: center; height: 40px; box-sizing: border-box;
      border: 1px solid var(--mui-palette-action-disabled, rgba(0,0,0,.23)); border-radius: var(--mui-shape-borderRadius, 4px);
      padding: 0 8px 0 14px; background: var(--mui-palette-background-paper);
    }
    .tlx-input-wrap:hover { border-color: var(--mui-palette-text-primary); }
    .tlx-input-wrap:focus-within { border: 2px solid var(--mui-palette-primary-main); padding: 0 7px 0 13px; }
    .tlx-input-wrap input {
      flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
      font: 400 14px/1.4 Roboto, Helvetica, Arial, sans-serif; color: var(--mui-palette-text-primary);
    }
    .tlx-input-wrap label {
      position: absolute; top: -9px; left: 10px; padding: 0 4px; font-size: 12px;
      color: var(--mui-palette-text-secondary); background: var(--mui-palette-background-paper);
    }
    .tlx-input-wrap:focus-within label { color: var(--mui-palette-primary-main); }

    .tlx-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    /* Short patterns render as pills; long ones grow to the panel width and wrap
       (preferably after "|", see patternText) instead of overflowing. */
    .tlx-chip {
      display: inline-flex; align-items: flex-start; gap: 4px; max-width: 100%; min-height: 24px;
      padding: 2px 3px 2px 10px; border-radius: 12px; font-size: 13px; box-sizing: border-box;
      border: 1px solid var(--mui-palette-divider); color: var(--mui-palette-text-primary);
    }
    .tlx-chip button {
      flex: none; display: inline-flex; padding: 0; border: 0; background: none; cursor: pointer;
      color: var(--mui-palette-text-secondary); opacity: .7;
    }
    .tlx-chip button:hover { opacity: 1; }
    .tlx-chip > span {
      flex: 1 1 auto; min-width: 0; padding: 1px 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px;
      overflow-wrap: anywhere;
    }
    .tlx-chip .tlx-seg { display: inline-block; max-width: 100%; }
    .tlx-chip.tlx-error { border-color: var(--mui-palette-error-main, #d32f2f); color: var(--mui-palette-error-main, #d32f2f); text-decoration: line-through; }
    .tlx-input-wrap.tlx-error, .tlx-input-wrap.tlx-error:focus-within { border-color: var(--mui-palette-error-main, #d32f2f); }
    .tlx-input-wrap.tlx-error label { color: var(--mui-palette-error-main, #d32f2f); }

    .tlx-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; cursor: pointer; font-size: 14px; }
    .tlx-switch { position: relative; flex: none; width: 34px; height: 14px; }
    .tlx-switch input { position: absolute; inset: -12px; opacity: 0; margin: 0; cursor: pointer; z-index: 1; }
    .tlx-switch .tlx-track {
      position: absolute; inset: 0; border-radius: 7px; background: var(--mui-palette-text-primary); opacity: .38; transition: .15s;
    }
    .tlx-switch .tlx-thumb {
      position: absolute; top: -3px; left: -3px; width: 20px; height: 20px; border-radius: 50%;
      background: var(--mui-palette-common-white, #fff); box-shadow: var(--mui-shadows-1, 0 1px 3px rgba(0,0,0,.3)); transition: .15s;
    }
    .tlx-switch input:checked ~ .tlx-track { background: var(--mui-palette-primary-main); opacity: .5; }
    .tlx-switch input:checked ~ .tlx-thumb { left: 17px; background: var(--mui-palette-primary-main); }
    .tlx-switch input:focus-visible ~ .tlx-thumb { outline: 2px solid var(--mui-palette-primary-main); outline-offset: 3px; }

    .tlx-text-btn {
      align-self: flex-start; padding: 4px 5px; border: 0; border-radius: 4px; background: none; cursor: pointer;
      font: 500 13px/1.75 Roboto, Helvetica, Arial, sans-serif; letter-spacing: .02857em; text-transform: uppercase;
      color: var(--mui-palette-primary-main);
    }
    .tlx-text-btn:hover { background: var(--mui-palette-action-hover); }
    .tlx-text-btn:disabled { color: var(--mui-palette-text-disabled); cursor: default; background: none; }

    .tlx-hidden-list { list-style: none; margin: 0; padding: 0; max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
    .tlx-hidden-list li { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    .tlx-hidden-list a { flex: 1; min-width: 0; color: inherit; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tlx-hidden-list a:hover { text-decoration: underline; }
    .tlx-hidden-list button { flex: none; display: inline-flex; padding: 2px; border: 0; background: none; cursor: pointer; color: var(--mui-palette-text-secondary); border-radius: 50%; }
    .tlx-hidden-list button:hover { background: var(--mui-palette-action-hover); color: var(--mui-palette-text-primary); }

    .tlx-inline-confirm { margin-top: 2px; font-size: 13px; color: var(--mui-palette-text-secondary); }

    .tlx-collapse-head {
      display: flex; align-items: center; justify-content: space-between; width: 100%;
      padding: 0; border: 0; background: none; cursor: pointer; text-align: left;
      font: 500 14px/1.43 Roboto, Helvetica, Arial, sans-serif; color: var(--mui-palette-text-primary);
    }
    .tlx-collapse-head svg { color: var(--mui-palette-action-active, rgba(0,0,0,.54)); transition: transform .15s; }
    .tlx-collapse-head[aria-expanded="true"] svg { transform: rotate(180deg); }
    .tlx-collapse-head:focus-visible { outline: 2px solid var(--mui-palette-primary-main); outline-offset: 2px; border-radius: 2px; }
    .tlx-collapse-body[hidden] { display: none !important; }
    .tlx-collapse-body { display: flex; flex-direction: column; gap: 6px; }

    .tlx-total {
      font: 400 12px/1.66 Roboto, Helvetica, Arial, sans-serif; letter-spacing: .03333em;
      color: var(--mui-palette-text-secondary); white-space: nowrap;
    }
    .tlx-total b { font-weight: 500; color: var(--mui-palette-text-primary); }

    /* Confirmation dialog */
    .tlx-backdrop {
      position: fixed; inset: 0; z-index: 1400; display: flex; align-items: center; justify-content: center; padding: 16px;
      background: rgba(0,0,0,.5); font-family: Roboto, Helvetica, Arial, sans-serif;
    }
    .tlx-dialog {
      width: 100%; max-width: 420px; border-radius: var(--mui-shape-borderRadius, 4px); overflow: hidden;
      background: var(--mui-palette-background-paper, #fff); color: var(--mui-palette-text-primary);
      box-shadow: var(--mui-shadows-24, 0 11px 15px -7px rgba(0,0,0,.2));
    }
    .tlx-dialog h2 { margin: 0; padding: 16px 24px 8px; font-size: 20px; font-weight: 500; line-height: 1.6; }
    .tlx-dialog-body { padding: 0 24px 12px; display: flex; flex-direction: column; gap: 8px; font-size: 15px; }
    .tlx-dialog-lot { font-weight: 500; }
    .tlx-dialog-amount { font-size: 22px; font-weight: 500; color: var(--mui-palette-primary-main); }
    .tlx-dialog-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 8px 16px 16px; }
    .tlx-dialog-actions .tlx-skip { margin-right: auto; display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--mui-palette-text-secondary); cursor: pointer; }
    .tlx-contained-btn {
      padding: 6px 16px; border: 0; border-radius: var(--mui-shape-borderRadius, 4px); cursor: pointer;
      font: 500 14px/1.75 Roboto, Helvetica, Arial, sans-serif; letter-spacing: .02857em; text-transform: uppercase;
      background: var(--mui-palette-primary-main); color: var(--mui-palette-primary-contrastText, #fff);
      box-shadow: var(--mui-shadows-2, 0 1px 3px rgba(0,0,0,.3));
    }
    .tlx-contained-btn:hover { box-shadow: var(--mui-shadows-4, 0 2px 6px rgba(0,0,0,.3)); filter: brightness(1.1); }
    .tlx-dialog button:focus-visible { outline: 2px solid var(--mui-palette-primary-main); outline-offset: 2px; }
  `);

  // ---------------------------------------------------------------------------
  // Lot cards
  // ---------------------------------------------------------------------------
  // Every card (catalog grid, Featured carousel, Similar auctions carousel) has a
  // title <a class="MuiLink-root" href="/lots/<date>/<id>">. The card "slot" is
  // the largest ancestor that contains only that one title link, i.e. the grid
  // cell / carousel slide we can hide.
  const TITLE_SEL = 'a.MuiLink-root[href^="/lots/"]';

  function lotIdFromHref(href) {
    const m = href.match(/\/lots\/[^/]+\/(\d+)/);
    return m ? m[1] : null;
  }

  function slotFor(link) {
    let node = link;
    while (node.parentElement && node.parentElement !== document.body) {
      if (node.parentElement.querySelectorAll(TITLE_SEL).length > 1) break;
      node = node.parentElement;
    }
    return node;
  }

  function imageAreaFor(slot) {
    const fav = slot.querySelector('[aria-label="Add to watchlist"], [aria-label="Remove from watchlist"]');
    if (fav?.parentElement?.parentElement) return fav.parentElement.parentElement;
    return slot.querySelector('[aria-label="Lot images"]')?.parentElement ?? null;
  }

  function hideLot(id, title, href) {
    save(KEYS.hidden, { ...state[KEYS.hidden], [id]: { title, href, ts: Date.now() } });
  }

  function unhideAll() {
    if (confirm('Unhide all hidden lots?')) save(KEYS.hidden, {});
  }

  function unhideLot(id) {
    const next = { ...state[KEYS.hidden] };
    delete next[id];
    save(KEYS.hidden, next);
  }

  function ensureHideButton(slot, id, title, href, isHidden) {
    const area = imageAreaFor(slot);
    if (!area) return;
    let btn = area.querySelector(':scope > .tlx-hide-btn');
    if (!btn) {
      btn = el('button', { type: 'button', class: 'tlx-hide-btn', 'data-tlx-own': '' });
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        swallow(e);
        const { tlxId, tlxTitle, tlxHref } = btn.dataset;
        if (state[KEYS.hidden][tlxId]) unhideLot(tlxId);
        else hideLot(tlxId, tlxTitle, tlxHref);
      });
      area.appendChild(btn);
    }
    btn.dataset.tlxId = id;
    btn.dataset.tlxTitle = title;
    btn.dataset.tlxHref = href;
    const mode = isHidden ? 'unhide' : 'hide';
    if (btn.dataset.mode !== mode) {
      btn.dataset.mode = mode;
      btn.replaceChildren(icon(isHidden ? 'visibility' : 'visibilityOff'));
      const label = isHidden ? 'Unhide this lot' : 'Hide this lot';
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }

  function setBadge(slot, text) {
    const area = imageAreaFor(slot);
    if (!area) return;
    let badge = area.querySelector(':scope > .tlx-badge');
    if (!text) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = el('span', { class: 'tlx-badge', 'data-tlx-own': '' });
      area.appendChild(badge);
    }
    if (badge.textContent !== text) badge.textContent = text;
  }

  // Disable every native control in a card (bid buttons, max-bid input, watchlist,
  // image arrows). We only touch elements we marked, so restoring is exact.
  function setControlsDisabled(slot, disabled) {
    if (disabled) {
      for (const c of slot.querySelectorAll('button, input')) {
        if (c.closest('[data-tlx-own]') || c.hasAttribute('data-tlx-disabled')) continue;
        if (c.disabled) continue; // already disabled by the site – leave it alone
        c.setAttribute('data-tlx-disabled', '');
        c.disabled = true;
        c.setAttribute('aria-disabled', 'true');
        c.classList.add('Mui-disabled');
        c.tabIndex = -1;
      }
    } else {
      for (const c of slot.querySelectorAll('[data-tlx-disabled]')) {
        c.removeAttribute('data-tlx-disabled');
        c.disabled = false;
        c.removeAttribute('aria-disabled');
        c.classList.remove('Mui-disabled');
        c.tabIndex = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Estimated total cost
  // ---------------------------------------------------------------------------
  // Location appears as an icon + caption ("Raleigh", "Anderson", "Transferable").
  // Captions belonging to other lot cards inside `root` are skipped.
  function locationIn(root) {
    for (const cap of root.querySelectorAll('svg + span.MuiTypography-caption')) {
      const owner = cap.closest('[data-tlx-lot]');
      if (owner && owner !== root) continue;
      const t = cap.textContent.trim();
      if (/anderson|transferable/i.test(t)) return 'transfer';
      if (/raleigh/i.test(t)) return 'raleigh';
    }
    return null;
  }

  function parseDollars(text) {
    const n = parseFloat((text || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  function totalCost(bid, loc) {
    const fees = FEES.lotFee + (loc === 'transfer' ? FEES.transferFee : 0);
    return (bid * (1 + FEES.premium) + fees) * (1 + FEES.salesTax);
  }

  const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  // Insert/update a "≈ $X total" caption right after `anchor` (defaults to the price element).
  function setTotal(priceEl, loc, anchor = priceEl) {
    let tag = anchor.nextElementSibling?.classList.contains('tlx-total') ? anchor.nextElementSibling : null;
    const bid = parseDollars(priceEl.textContent);
    if (bid == null || !loc) {
      tag?.remove();
      return;
    }
    if (!tag) {
      tag = el('span', { class: 'tlx-total', 'data-tlx-own': '' }, '≈ ', el('b'), ' total');
      anchor.after(tag);
    }
    const value = money(totalCost(bid, loc));
    const b = tag.querySelector('b');
    if (b.textContent !== value) b.textContent = value;
    const tip =
      `${money(bid)} + ${+(FEES.premium * 100).toFixed(2)}% premium + ${money(FEES.lotFee)} lot fee` +
      (loc === 'transfer' ? ` + ${money(FEES.transferFee)} transfer` : '') +
      `, then ${(FEES.salesTax * 100).toFixed(2)}% sales tax`;
    if (tag.title !== tip) tag.title = tip;
  }

  let filteredCount = 0;

  function compactGrids(slots) {
    const grids = new Set();
    for (const slot of slots) {
      const parent = slot.parentElement;
      if (parent && getComputedStyle(parent).display === 'grid') grids.add(parent);
    }
    for (const grid of document.querySelectorAll('.tlx-compact')) grids.add(grid);

    for (const grid of grids) {
      const cards = [...grid.children].filter((c) => c.dataset.tlxLot);
      const visible = cards.filter((c) => !c.classList.contains('tlx-slot-hidden'));
      // The sorted view's grid has no native dividers, so it always draws its own.
      const compact = grid.hasAttribute('data-tlx-sorted-grid') || visible.length < cards.length;
      grid.classList.toggle('tlx-compact', compact);
      if (!compact) {
        cards.forEach((c) => c.classList.remove('tlx-row-start', 'tlx-later-row'));
        continue;
      }
      const cs = getComputedStyle(grid);
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      // Native rows are separated by gap + <hr> (with its margins) + gap; reproduce that spacing.
      const hr = grid.querySelector(':scope > hr');
      const hcs = hr && getComputedStyle(hr);
      const hrSpace = hcs
        ? ['marginTop', 'marginBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((n, k) => n + (parseFloat(hcs[k]) || 0), 0)
        : 0;
      const rowGap = parseFloat(cs.rowGap) || 0;
      const vars = {
        '--tlx-cols': String(cols),
        '--tlx-row-gap': `${rowGap}px`,
        '--tlx-row-sep': `${rowGap + hrSpace}px`,
        '--tlx-col-gap': cs.columnGap,
      };
      for (const [k, v] of Object.entries(vars)) if (grid.style.getPropertyValue(k) !== v) grid.style.setProperty(k, v);
      cards.forEach((c) => {
        const i = visible.indexOf(c);
        c.classList.toggle('tlx-later-row', i >= cols);
        c.classList.toggle('tlx-row-start', i >= cols && i % cols === 0);
      });
    }
  }

  function processCards() {
    const seen = new Set();
    let filtered = 0;
    for (const link of document.querySelectorAll(TITLE_SEL)) {
      const href = link.getAttribute('href');
      const id = lotIdFromHref(href);
      if (!id) continue;
      const slot = slotFor(link);
      if (seen.has(slot)) continue;
      seen.add(slot);

      const title = link.textContent.trim();
      // Card titles are line-clamped; expose the full name as a tooltip.
      if (link.title !== title) link.title = title;
      const isHidden = !!state[KEYS.hidden][id];
      const matched = matchFilter(title);
      const showHidden = state[KEYS.showHidden];

      slot.dataset.tlxLot = id;
      const removed = (isHidden && !showHidden) || (!!matched && state[KEYS.removeFiltered]);
      slot.classList.toggle('tlx-slot-hidden', removed);
      const dim = !!matched || (isHidden && showHidden);
      slot.classList.toggle('tlx-dim', dim);

      // Filtered lots and revealed-hidden lots both get their controls disabled.
      setControlsDisabled(slot, dim);

      ensureHideButton(slot, id, title, href, isHidden);
      setBadge(slot, isHidden && showHidden ? 'Hidden' : matched ? `Filtered: ${matched}` : null);

      const priceEl = slot.querySelector('p.MuiTypography-h6');
      if (priceEl) setTotal(priceEl, locationIn(slot));

      if (matched && !isHidden) filtered++;
    }

    // Clean up slots that are no longer lot cards (React reused the node).
    for (const slot of document.querySelectorAll('[data-tlx-lot]')) {
      if (seen.has(slot)) continue;
      delete slot.dataset.tlxLot;
      slot.classList.remove('tlx-slot-hidden', 'tlx-dim', 'tlx-row-start', 'tlx-later-row');
      setControlsDisabled(slot, false);
      slot.querySelectorAll('.tlx-hide-btn, .tlx-badge, .tlx-total').forEach((n) => n.remove());
    }

    compactGrids(seen);
    filteredCount = filtered;
  }

  // ---------------------------------------------------------------------------
  // "Hide & Filter" section injected into the native Filters sidebar
  // ---------------------------------------------------------------------------
  function switchRow(labelText, key, extraClass = '') {
    const input = el('input', { type: 'checkbox', role: 'switch' });
    input.checked = !!state[key];
    input.addEventListener('change', () => save(key, input.checked));
    return el(
      'label',
      { class: `tlx-switch-row ${extraClass}`.trim(), 'data-tlx-key': key },
      el('span', { text: labelText }),
      el('span', { class: 'tlx-switch' }, input, el('span', { class: 'tlx-track' }), el('span', { class: 'tlx-thumb' }))
    );
  }

  // Header button + body; open/closed state is persisted per list.
  function collapsible(name, ...children) {
    const head = el(
      'button',
      { type: 'button', class: 'tlx-collapse-head', 'data-tlx-collapse': name },
      el('span', { 'data-tlx-collapse-label': '' }),
      icon('expandMore', 20)
    );
    head.addEventListener('click', () => {
      const cur = state[KEYS.collapsed] || {};
      save(KEYS.collapsed, { ...cur, [name]: !cur[name] });
    });
    const body = el('div', { class: 'tlx-collapse-body', 'data-tlx-collapse-body': name }, ...children);
    return [head, body];
  }

  function buildSection() {
    const section = el('section', { class: 'tlx-section', 'data-tlx-own': '', 'data-tlx-panel': '' });

    const wordInput = el('input', {
      type: 'text',
      placeholder: 'e.g. batter(y|ies)',
      'aria-label': 'Add filter regex',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const inputLabel = el('label', { text: 'Filter regex' });
    const inputWrap = el('div', { class: 'tlx-input-wrap' }, inputLabel, wordInput);
    const setError = (msg) => {
      inputWrap.classList.toggle('tlx-error', !!msg);
      inputLabel.textContent = msg || 'Filter regex';
    };
    const addWords = () => {
      const pattern = wordInput.value.trim();
      if (!pattern) return;
      if (addFilter(pattern)) wordInput.value = '';
      else setError('Invalid regex');
    };
    wordInput.addEventListener('input', () => setError(null));
    wordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addWords();
      }
    });
    inputWrap.append(el('button', { type: 'button', class: 'tlx-text-btn', onclick: addWords, text: 'Add' }));

    section.append(
      el('p', { class: 'tlx-section-title', text: 'Hide & Filter' }),
      inputWrap,
      ...collapsible('words', el('div', { class: 'tlx-chips', 'data-tlx-chips': '' })),
      el('p', { class: 'tlx-caption', 'data-tlx-stats': '' }),
      switchRow('Apply filters', KEYS.filterOn),
      switchRow('Remove filtered lots instead of graying out', KEYS.removeFiltered),
      switchRow('Confirm before bidding', KEYS.confirm),
      switchRow('Show hidden lots', KEYS.showHidden),
      ...collapsible(
        'hidden',
        el('ul', { class: 'tlx-hidden-list', 'data-tlx-hidden-list': '' }),
        el('button', {
          type: 'button',
          class: 'tlx-text-btn',
          'data-tlx-unhide-all': '',
          text: 'Unhide all',
          onclick: unhideAll,
        })
      )
    );
    return section;
  }

  // Each "alternative|" is its own inline-block, so long alternations wrap
  // between alternatives (with "|" ending the line) rather than mid-word.
  function patternText(pattern) {
    const parts = pattern.split('|');
    return el(
      'span',
      {},
      ...parts.map((part, i) => el('span', { class: 'tlx-seg', text: i < parts.length - 1 ? `${part}|` : part }))
    );
  }

  function renderSection(section) {
    // Chips
    const chips = section.querySelector('[data-tlx-chips]');
    const words = state[KEYS.words];
    const chipKey = words.join('\u0000');
    if (chips.dataset.key !== chipKey) {
      chips.dataset.key = chipKey;
      chips.replaceChildren(
        ...words.map((w) =>
          el(
            'span',
            compileFilter(w)
              ? { class: 'tlx-chip', title: `/\\b(?:${w})\\b/i` }
              : { class: 'tlx-chip tlx-error', title: 'Invalid regex – ignored' },
            patternText(w),
            el(
              'button',
              {
                type: 'button',
                'aria-label': `Remove ${w}`,
                onclick: () => save(KEYS.words, state[KEYS.words].filter((x) => x !== w)),
              },
              icon('cancel')
            )
          )
        )
      );
    }

    // Switches
    for (const row of section.querySelectorAll('[data-tlx-key]')) {
      const input = row.querySelector('input');
      const v = !!state[row.dataset.tlxKey];
      if (input.checked !== v) input.checked = v;
    }

    // Stats
    const stats = section.querySelector('[data-tlx-stats]');
    const statText = words.length
      ? `${filteredCount} lot${filteredCount === 1 ? '' : 's'} ${state[KEYS.removeFiltered] ? 'removed' : 'filtered'} on this page.`
      : 'Case-insensitive regex on the lot title, matched as whole words: \\b(?:pattern)\\b.';
    if (stats.textContent !== statText) stats.textContent = statText;

    // Hidden list
    const hidden = Object.entries(state[KEYS.hidden]).sort((a, b) => b[1].ts - a[1].ts);

    // Collapsible headers
    const labels = { words: `Filter patterns (${words.length})`, hidden: `Hidden lots (${hidden.length})` };
    const collapsed = state[KEYS.collapsed] || {};
    for (const head of section.querySelectorAll('[data-tlx-collapse]')) {
      const name = head.dataset.tlxCollapse;
      const label = head.querySelector('[data-tlx-collapse-label]');
      if (label.textContent !== labels[name]) label.textContent = labels[name];
      const open = !collapsed[name];
      if (head.getAttribute('aria-expanded') !== String(open)) head.setAttribute('aria-expanded', String(open));
      const body = section.querySelector(`[data-tlx-collapse-body="${name}"]`);
      if (body.hidden === open) body.hidden = !open;
    }

    const list = section.querySelector('[data-tlx-hidden-list]');
    const listKey = hidden.map(([id]) => id).join(',');
    if (list.dataset.key !== listKey) {
      list.dataset.key = listKey;
      list.replaceChildren(
        ...hidden.map(([id, info]) =>
          el(
            'li',
            {},
            el('a', { href: info.href, title: info.title, text: info.title || `Lot ${id}` }),
            el(
              'button',
              { type: 'button', title: 'Unhide', 'aria-label': `Unhide ${info.title}`, onclick: () => unhideLot(id) },
              icon('visibility', 18)
            )
          )
        )
      );
    }
    section.querySelector('[data-tlx-unhide-all]').disabled = hidden.length === 0;
  }

  // The filter sections live in a desktop <aside> and, on narrow screens, in a
  // bottom drawer with a different layout. Find the stack that holds the native
  // filter <section>s in either case.
  function filterStacks() {
    const stacks = new Set();
    for (const p of document.querySelectorAll('section p')) {
      if (!/^(Location|Categories|Time-to-end|Condition|Pricing)\b/.test(p.textContent.trim())) continue;
      const stack = p.closest('section')?.parentElement;
      if (stack && stack.querySelectorAll(':scope > section:not([data-tlx-panel])').length >= 3) stacks.add(stack);
    }
    return stacks;
  }

  function processSidebar() {
    for (const stack of filterStacks()) {
      let section = stack.querySelector(':scope > [data-tlx-panel]');
      if (!section) {
        section = buildSection();
        stack.prepend(section);
      }
      renderSection(section);
    }
  }

  // Lot detail page: small inline "Confirm before bidding" switch under the bid buttons.
  function processDetailPage() {
    if (!/^\/lots\//.test(location.pathname)) return;

    const current = document.querySelector('h2[aria-label^="Current bid"]');
    if (current && !current.closest('[data-tlx-lot]')) {
      // Place it after the "Current Bid" label that follows the price.
      const label = current.nextElementSibling?.classList.contains('MuiTypography-caption') ? current.nextElementSibling : current;
      setTotal(current, locationIn(document), label);
    }

    for (const btn of document.querySelectorAll('button.MuiButton-root')) {
      if (!/^(set|raise) max bid$/i.test(btn.textContent.trim())) continue;
      if (btn.closest('[data-tlx-lot]')) continue;
      const container = btn.parentElement?.parentElement;
      if (!container) continue;
      let row = container.querySelector(':scope > .tlx-inline-confirm');
      if (!row) {
        row = switchRow('Confirm before bidding', KEYS.confirm, 'tlx-inline-confirm');
        row.setAttribute('data-tlx-own', '');
        container.appendChild(row);
      }
      const input = row.querySelector('input');
      if (input.checked !== !!state[KEYS.confirm]) input.checked = !!state[KEYS.confirm];
    }
  }

  // ---------------------------------------------------------------------------
  // Bid interception
  // ---------------------------------------------------------------------------
  // The site's bid buttons (from its LotBidControls component):
  //   "Max bid" / "Raise max bid" / "Set max bid"  -> submits the value in the "Max bid amount" input
  //   "$N" with an arrow start-icon                -> straight bid at current price + $N increment
  function bidKind(btn) {
    if (!btn.classList.contains('MuiButton-root')) return null;
    const txt = btn.textContent.trim();
    if (/^(set |raise )?max bid$/i.test(txt)) return 'max';
    if (/^\$[\d,]+$/.test(txt) && btn.querySelector('.MuiButton-startIcon')) return 'straight';
    return null;
  }

  function bidContext(btn) {
    // Card slot, or the detail page's main column
    const slot = btn.closest('[data-tlx-lot]');
    let title = '';
    let current = '';
    if (slot) {
      title = slot.querySelector(TITLE_SEL)?.textContent.trim() ?? '';
      current = slot.querySelector('p.MuiTypography-h6')?.textContent.trim() ?? '';
    } else if (/^\/lots\//.test(location.pathname)) {
      title = document.querySelector('h1')?.textContent.trim() ?? '';
      current = document.querySelector('[aria-label^="Current bid"]')?.textContent.trim() ?? '';
    }
    // Nearest ancestor containing the max-bid input belongs to this button.
    let node = btn.parentElement;
    let input = null;
    while (node && node !== document.body) {
      input = node.querySelector('input[aria-label="Max bid amount"]');
      if (input) break;
      node = node.parentElement;
    }
    return { title, current, input };
  }

  const approved = new WeakSet();
  let dialogOpen = false;

  function onClickCapture(e) {
    const btn = e.target instanceof Element ? e.target.closest('button') : null;
    if (!btn || btn.closest('[data-tlx-own]')) return;

    // Block anything we disabled on filtered / revealed-hidden cards.
    if (btn.hasAttribute('data-tlx-disabled')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    const kind = bidKind(btn);
    if (!kind) return;

    if (approved.has(btn)) {
      approved.delete(btn);
      return; // let the site handle the confirmed click
    }

    // Safety net: never allow bids on filtered or hidden lots, even if the
    // site re-rendered the button and our disabled marker got lost.
    const slot = btn.closest('[data-tlx-lot]');
    if (slot && slot.classList.contains('tlx-dim')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    if (!state[KEYS.confirm] || btn.disabled) return;

    const ctx = bidContext(btn);
    // Empty max-bid field: let the site show its own "required" validation.
    if (kind === 'max' && ctx.input && ctx.input.value.trim() === '') return;

    e.preventDefault();
    e.stopImmediatePropagation();
    if (dialogOpen) return;

    const amount =
      kind === 'max'
        ? { label: 'Max bid', value: `$${Number(ctx.input?.value || 0).toLocaleString()}` }
        : { label: 'Quick bid', value: `+${btn.textContent.trim()}` };

    showConfirm({ ...ctx, ...amount }).then((ok) => {
      if (!ok) return;
      if (!btn.isConnected) {
        alert('The bid button changed while the confirmation was open. Please try again.');
        return;
      }
      approved.add(btn);
      btn.click();
    });
  }
  window.addEventListener('click', onClickCapture, true);

  function showConfirm({ title, current, label, value }) {
    dialogOpen = true;
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const skip = el('input', { type: 'checkbox' });
      const cancelBtn = el('button', { type: 'button', class: 'tlx-text-btn', text: 'Cancel' });
      const okBtn = el('button', { type: 'button', class: 'tlx-contained-btn', text: 'Place bid' });

      const dialog = el(
        'div',
        { class: 'tlx-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'tlx-dialog-title' },
        el('h2', { id: 'tlx-dialog-title', text: 'Confirm bid' }),
        el(
          'div',
          { class: 'tlx-dialog-body' },
          el('div', { class: 'tlx-dialog-lot', text: title || 'This lot' }),
          el('div', {}, el('span', { class: 'tlx-caption', text: `${label}  ` }), el('span', { class: 'tlx-dialog-amount', text: value })),
          current ? el('div', { class: 'tlx-caption', text: `Current bid: ${current}` }) : null
        ),
        el(
          'div',
          { class: 'tlx-dialog-actions' },
          el('label', { class: 'tlx-skip' }, skip, el('span', { text: 'Don’t ask again' })),
          cancelBtn,
          okBtn
        )
      );
      const backdrop = el('div', { class: 'tlx-backdrop', 'data-tlx-own': '' }, dialog);

      const close = (ok) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        dialogOpen = false;
        if (ok && skip.checked) save(KEYS.confirm, false);
        prevFocus?.focus?.();
        resolve(ok);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') {
          swallow(e);
          close(false);
        } else if (e.key === 'Tab') {
          // keep focus inside the dialog
          const items = [skip, cancelBtn, okBtn];
          const i = items.indexOf(document.activeElement);
          e.preventDefault();
          items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
        }
      };

      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      backdrop.addEventListener('mousedown', (e) => {
        if (e.target === backdrop) close(false);
      });
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(backdrop);
      cancelBtn.focus(); // default to the safe choice
    });
  }

  // ---------------------------------------------------------------------------
  // Sort all matching lots by title
  // ---------------------------------------------------------------------------
  // The API has no title ordering, so we fetch every lot matching the catalog's
  // current built-in filters and sort client-side. To stay exactly in sync with
  // the site (including account-dependent defaults like "Transferable only") and
  // to avoid touching auth tokens, a small bridge runs in the page's JS context
  // and uses the site's own React Query client: it reads the params of the
  // active lots query and fetches extra pages through the site's authenticated
  // API client.
  const SORT = { pageSize: 80, fetchSize: 100, concurrency: 4, cacheEntries: 3 };

  function pageBridge() {
    const KEY = '/v1/auctions/lots';
    let client = null;
    const findClient = () => {
      const root = document.getElementById('__next');
      const prop = root && Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
      const stack = prop ? [root[prop]] : [];
      for (let n = 0; stack.length && n < 50000; n++) {
        const f = stack.pop();
        if (!f) continue;
        const c = f.memoizedProps && f.memoizedProps.client;
        if (c && typeof c.getQueryCache === 'function') return c;
        if (f.child) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
      return null;
    };
    const getClient = () => client || (client = findClient());
    const ops = {
      active() {
        const c = getClient();
        if (!c) return null;
        const qs = c
          .getQueryCache()
          .findAll({ queryKey: [KEY] })
          .filter((q) => q.getObserversCount() > 0 && q.queryKey[1] && typeof q.queryKey[1] === 'object');
        const q = qs.find((x) => x.queryKey[1].perPage === 80) || qs[0];
        return q ? q.queryKey[1] : null;
      },
      async fetch({ params }) {
        const c = getClient();
        if (!c) throw new Error('Site query client not found');
        const d = await c.fetchQuery({ queryKey: [KEY, params], staleTime: 0, gcTime: 0 });
        return { count: d.count, results: d.results };
      },
    };
    document.addEventListener('tlx:req', async (e) => {
      let msg;
      try {
        msg = JSON.parse(e.detail);
      } catch {
        return;
      }
      const reply = (body) =>
        document.dispatchEvent(new CustomEvent('tlx:res', { detail: JSON.stringify({ id: msg.id, ...body }) }));
      try {
        reply({ ok: true, data: await ops[msg.op](msg.args || {}) });
      } catch (err) {
        reply({ ok: false, error: String((err && err.message) || err) });
      }
    });
  }

  const bridgeWaiters = new Map();
  let bridgeSeq = 0;
  document.addEventListener('tlx:res', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.detail);
    } catch {
      return;
    }
    const w = bridgeWaiters.get(msg.id);
    if (!w) return;
    bridgeWaiters.delete(msg.id);
    msg.ok ? w.resolve(msg.data) : w.reject(new Error(msg.error));
  });
  {
    const s = document.createElement('script');
    s.textContent = `(${pageBridge.toString()})();`;
    (document.head || document.documentElement).appendChild(s);
    s.remove();
  }

  function callBridge(op, args) {
    return new Promise((resolve, reject) => {
      const id = ++bridgeSeq;
      const timer = setTimeout(() => {
        bridgeWaiters.delete(id);
        reject(new Error('Timed out talking to the page'));
      }, 30000);
      bridgeWaiters.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      document.dispatchEvent(new CustomEvent('tlx:req', { detail: JSON.stringify({ id, op, args }) }));
    });
  }

  const stableKey = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  // Sort key: move leading specs (measurements, pack counts, "Set of 3",
  // parentheticals like "(2026 Upgraded)") to the end, so "1 in. Copper Tubing
  // Cutter" sorts with other "Copper Tubing Cutter"s. Bare numbers (years,
  // model numbers), "3-in-1"/"2 in 1", and brands like "3M" stay put.
  // Number: 1,200 / 2.5 / 5/8 / 1-3/8, optionally a range (33-39, 2500-5000).
  const SORT_ONE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:[- ]\d+\/\d+|\/\d+)?`;
  const SORT_NUM = String.raw`${SORT_ONE}(?:\s*[-–]\s*${SORT_ONE})?`;
  const SORT_UNIT = [
    String.raw`in(?:ch(?:es)?)?(?!\s*-|\s+\d)\.?`, // not "3-in-1" / "2 in 1"
    String.raw`ft\.?|feet|foot|yds?\.?|yards?|mm|cm|mil|ga\.?|gauge|awg`,
    String.raw`gal(?:lons?)?\.?|qts?\.?|quarts?|pints?|pt\.?|cups?|fl\.? ?oz\.?|oz\.?|lbs?\.?|pounds?|kg|tons?|ml|l|liters?|litres?|cc`,
    String.raw`(?:cu|sq)\.? ?(?:ft|in|yd)\.?`,
    String.raw`v|volts?|w|watts?|kw|amps?|a|ah|mah|wh|btus?|psi|gpm|cfm|mph|hp|lm|lumens?`,
    String.raw`[mg]bps|[gkm]?hz|rpm|db|deg(?:rees?)?|°|%`,
    String.raw`pcs?\.?|pieces?|pk|packs?|count|ct|pairs?|tiers?|panels?|channels?`,
  ].join('|');
  // Counts that only read as a spec when hyphenated ("4-Light", "2-Cycle", "2-Tools").
  const SORT_HYPHEN_UNIT = String.raw`(?:light|bulb|gang|outlet|port|drawer|shelf|shelves|cube|seat|person|burner|speed|blade|tool|bottle|door|zone|way|step|cutter|cycle|stroke|handle|row|tooth|teeth)s?`;
  const SORT_MARK = String.raw`(?:"|''|”|″|'|′)`; // inch / foot marks
  const SORT_MEASURE = String.raw`${SORT_NUM}\s*(?:${SORT_MARK}|-?\s*(?:${SORT_UNIT}))?`;
  const SORT_LEAD = new RegExp(
    '^(?:' +
      [
        String.raw`[(\[][^)\]]*[)\]]`, // (2026 Upgraded)
        String.raw`(?:set|pack|box|case|lot)\s+of\s+\d+`, // Set of 3
        // Dimensions: 24 x 36 / 12x12 in. / 56"x15" / 6FTx300FT
        `${SORT_MEASURE}(?:\\s*[x×]\\s*${SORT_MEASURE})+(?=[\\s,.)/]|$)`,
        `${SORT_NUM}\\s*${SORT_MARK}`, // 15" / 6'
        `${SORT_NUM}-${SORT_HYPHEN_UNIT}(?=[\\s,.)/]|$)`, // 4-Light
        `${SORT_NUM}[\\s-]?(?:${SORT_UNIT})(?=[\\s,.)/x×]|$)`, // 1 in. / 20V / 5-Pack / 80,000 BTU
        `${SORT_NUM}\\s*[x×](?=\\s*\\d)`, // multiplier: 2x180W
      ].join('|') +
      ')',
    'iu'
  );
  // "x" between measurements ("12 in. x 12 in."); only after a measurement was
  // moved, so model names like "X20" or "X2 Robotic Pool Vacuum" stay put.
  const SORT_SEP = /^[x×]\s*(?=\d)/i;

  function sortKey(title) {
    let rest = title.trim();
    const moved = [];
    for (let i = 0; i < 12; i++) {
      const m = rest.match(SORT_LEAD) || (moved.length ? rest.match(SORT_SEP) : null);
      if (!m || !m[0]) break;
      moved.push(m[0].trim());
      rest = rest.slice(m[0].length).replace(/^[\s,;:/–—-]+/, '');
    }
    const key = rest ? (moved.length ? `${rest} ${moved.join(' ')}` : rest) : title;
    return key.replace(/^[^\p{L}\p{N}]+/u, '');
  }

  const lotCache = new Map(); // filterKey -> { lots, fetchedAt }
  const sv = {
    filterKey: null,
    filters: null,
    orderBy: undefined,
    orderSeen: false,
    lots: null,
    fetchedAt: 0,
    loading: false,
    progress: null,
    error: null,
    gen: 0,
    page: 1,
    renderKey: null,
    sorted: null, // { lots, dir, arr }
  };
  let syncing = false;
  let resync = false;

  async function loadLots(filters, key, force = false) {
    const cached = lotCache.get(key);
    if (cached && !force) {
      Object.assign(sv, { lots: cached.lots, fetchedAt: cached.fetchedAt, loading: false, error: null });
      return;
    }
    const gen = ++sv.gen;
    Object.assign(sv, { lots: null, loading: true, error: null, progress: { done: 0, total: null } });
    scheduleScan();
    try {
      const fetchPage = (page) => callBridge('fetch', { params: { ...filters, page, perPage: SORT.fetchSize } });
      const first = await fetchPage(1);
      if (gen !== sv.gen) return;
      const byId = new Map(first.results.map((l) => [l.id, l]));
      const pages = Math.ceil(first.count / SORT.fetchSize);
      sv.progress = { done: byId.size, total: first.count };
      scheduleScan();
      let next = 2;
      const worker = async () => {
        while (next <= pages && gen === sv.gen) {
          const d = await fetchPage(next++);
          d.results.forEach((l) => byId.set(l.id, l));
          sv.progress = { done: byId.size, total: first.count };
          scheduleScan();
        }
      };
      await Promise.all(Array.from({ length: Math.min(SORT.concurrency, Math.max(pages - 1, 0)) }, worker));
      if (gen !== sv.gen) return;
      const entry = { lots: [...byId.values()], fetchedAt: Date.now() };
      lotCache.set(key, entry);
      while (lotCache.size > SORT.cacheEntries) lotCache.delete(lotCache.keys().next().value);
      Object.assign(sv, entry, { loading: false });
    } catch (err) {
      if (gen === sv.gen) Object.assign(sv, { loading: false, error: err.message || String(err) });
    }
    scheduleScan();
  }

  function sortedLots(dir) {
    if (!sv.lots) return [];
    if (sv.sorted && sv.sorted.lots === sv.lots && sv.sorted.dir === dir) return sv.sorted.arr;
    const arr = [...sv.lots].sort((a, b) => collator.compare(sortKey(a.title), sortKey(b.title)) || a.id - b.id);
    if (dir === 'desc') arr.reverse();
    sv.sorted = { lots: sv.lots, dir, arr };
    return arr;
  }

  // Lots shown in the sorted view: drop hidden lots (unless revealed) and, when
  // "remove filtered" is on, filtered lots – before paging, so pages stay full.
  function visibleSortedLots(dir) {
    return sortedLots(dir).filter((l) => {
      if (state[KEYS.hidden][l.id] && !state[KEYS.showHidden]) return false;
      if (state[KEYS.removeFiltered] && matchFilter(l.title)) return false;
      return true;
    });
  }

  const onCatalog = () => location.pathname === '/';

  function nativeLotsGrid() {
    for (const c of document.querySelectorAll('[data-lot-id]')) {
      if (c.closest('[aria-roledescription="carousel"], .tlx-sorted')) continue;
      return c.parentElement;
    }
    return null;
  }

  function resultsHeading() {
    return [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'All Auctions') || null;
  }

  function ensureSortToggle() {
    const h2 = onCatalog() ? resultsHeading() : null;
    if (!h2) return;
    let group = h2.parentElement.querySelector(':scope > .tlx-sort-toggle');
    if (!group) {
      const btn = (dir, text, label) =>
        el('button', {
          type: 'button',
          'data-dir': dir,
          title: label,
          'aria-label': label,
          text,
          onclick: () => {
            const next = state[KEYS.titleSort] === dir ? null : dir;
            sv.page = 1;
            sv.orderSeen = false;
            save(KEYS.titleSort, next);
          },
        });
      group = el(
        'span',
        { class: 'tlx-sort-toggle', role: 'group', 'aria-label': 'Sort all lots by title', 'data-tlx-own': '' },
        btn('asc', 'A–Z', 'Sort all matching lots by title, A to Z'),
        btn('desc', 'Z–A', 'Sort all matching lots by title, Z to A')
      );
      h2.parentElement.appendChild(group);
    }
    for (const b of group.querySelectorAll('button')) {
      const on = String(state[KEYS.titleSort] === b.dataset.dir);
      if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on);
    }
  }

  // Native siblings of the grid that the sorted view replaces: page status and pagination.
  function nativeExtras(grid) {
    return [...grid.parentElement.children].filter(
      (c) => c !== grid && !c.classList.contains('tlx-sorted') && (c.matches('[role="status"]') || c.querySelector('nav[aria-label="Auctions pages"]'))
    );
  }

  function teardownSorted() {
    document.querySelectorAll('.tlx-sorted').forEach((n) => n.remove());
    document.querySelectorAll('.tlx-native-hidden').forEach((n) => n.classList.remove('tlx-native-hidden'));
    sv.renderKey = null;
  }

  async function syncSortedView() {
    const dir = state[KEYS.titleSort];
    const grid = dir && onCatalog() ? nativeLotsGrid() : null;
    if (!grid) {
      if (document.querySelector('.tlx-sorted')) teardownSorted();
      return;
    }
    if (syncing) {
      resync = true;
      return;
    }
    syncing = true;
    try {
      const params = await callBridge('active');
      if (!params) return;
      const { page, perPage, orderBy, ...filters } = params;
      // Picking one of the site's own sort options turns title sort off. The site
      // omits orderBy for its default/relevance sort but sends it explicitly once
      // a search is active, so treat those as the same "default" sort.
      const sortChoice = !orderBy || orderBy === 'relevance' || orderBy === 'ending-soonest' ? 'default' : orderBy;
      if (sv.orderSeen && sortChoice !== sv.orderBy) {
        sv.orderBy = sortChoice;
        save(KEYS.titleSort, null);
        return;
      }
      sv.orderBy = sortChoice;
      sv.orderSeen = true;
      const key = stableKey(filters);
      if (key !== sv.filterKey) {
        sv.filterKey = key;
        sv.filters = filters;
        sv.page = 1;
        loadLots(filters, key);
      }
      renderSorted(grid, dir);
    } catch (err) {
      sv.error = err.message || String(err);
      renderSorted(grid, dir);
    } finally {
      syncing = false;
      if (resync) {
        resync = false;
        scheduleScan();
      }
    }
  }

  // Native cards label non-default-location transferable lots "Transferable".
  function defaultLocationName() {
    const counts = {};
    for (const c of document.querySelectorAll('[data-lot-id]:not(.tlx-sorted *) svg + span.MuiTypography-caption')) {
      const t = c.textContent.trim();
      if (/^(Raleigh|Anderson)$/i.test(t)) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Raleigh';
  }

  function timeLabel(endsAt) {
    const ms = new Date(endsAt).getTime() - Date.now();
    if (ms <= 0) return { text: 'Closed', soon: true };
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const soon = ms <= 3600000;
    if (ms >= 86400000) return { text: `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`, soon };
    if (m >= 60) return { text: `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`, soon };
    return { text: `${m}m ${String(s % 60).padStart(2, '0')}s`, soon };
  }

  function setTime(span, endsAt) {
    const { text, soon } = timeLabel(endsAt);
    if (span.textContent !== text) span.textContent = text;
    const color = soon ? 'var(--mui-palette-error-main)' : '';
    if (span.style.color !== color) {
      span.style.color = color;
      if (span.previousElementSibling) span.previousElementSibling.style.color = color;
    }
  }

  const CDN = 'https://cdn.triangleliquidators.com';

  // Build a card for `lot` by cloning a native card (exact styling at every
  // breakpoint) and filling in its fields. Bid controls, watchlist and image
  // navigation are dropped – their React handlers don't survive cloning – and
  // replaced by a link to the lot page.
  function buildCard(tpl, lot, defaultLoc) {
    const card = tpl.cloneNode(true);
    card.querySelectorAll('[data-tlx-own]').forEach((n) => n.remove());
    for (const n of [card, ...card.querySelectorAll('*')]) {
      for (const a of [...n.attributes]) if (a.name.startsWith('data-tlx') || a.name === 'data-lot-id' || a.name === 'data-position') n.removeAttribute(a.name);
      if (typeof n.className === 'string' && n.className.includes('tlx-')) n.className = n.className.replace(/\btlx-[\w-]+/g, '').trim();
    }
    const href = `/lots/${lot.auctionPeriod}/${lot.id}`;

    // Image: keep a single slide.
    const group = card.querySelector('[aria-label="Lot images"]');
    if (group) {
      const anchors = [...group.querySelectorAll('a')];
      anchors.slice(1).forEach((a) => a.remove());
      const a = anchors[0];
      if (a) {
        a.href = href;
        let img = a.querySelector('img');
        if (!img) {
          img = el('img', { loading: 'lazy', decoding: 'async', draggable: 'false' });
          img.style.cssText = 'position:absolute;height:100%;width:100%;inset:0;object-fit:contain;color:transparent';
          a.appendChild(img);
        }
        const first = [...(lot.images || [])].sort((x, y) => x.position - y.position)[0];
        img.removeAttribute('srcset');
        img.src = first ? `${CDN}/${first.imageCard}` : '';
        img.alt = lot.title;
      }
      group.querySelectorAll('button').forEach((b) => b.remove());
      group.querySelectorAll('[aria-live]').forEach((n) => n.remove());
      group.querySelectorAll('.MuiStack-root:empty').forEach((n) => n.remove());
    }
    card.querySelector('[aria-label="Add to watchlist"], [aria-label="Remove from watchlist"]')?.parentElement?.remove();

    // Condition chip
    const chip = card.querySelector('.MuiChip-root');
    if (chip) {
      const cond = lot.condition || {};
      const label = chip.querySelector('.MuiChip-label');
      if (label) label.textContent = cond.displayName || cond.display || '';
      const tone = { 1: 'primary', 2: 'success', 3: 'warning' }[cond.value];
      chip.style.color = tone ? `var(--mui-palette-${tone}-main)` : 'var(--mui-palette-text-secondary)';
      chip.style.borderColor = tone ? `var(--mui-palette-${tone}-main)` : 'var(--mui-palette-divider)';
      if (!label?.textContent) chip.remove();
    }

    // Location + time
    const caps = card.querySelectorAll('svg + span.MuiTypography-caption');
    const locName = lot.location?.name || '';
    if (caps[0]) caps[0].textContent = lot.isTransferable && locName !== defaultLoc ? 'Transferable' : locName;
    if (caps[1]) {
      caps[1].setAttribute('data-tlx-ends', lot.endsAt);
      setTime(caps[1], lot.endsAt);
    }

    // Title
    const link = card.querySelector(TITLE_SEL);
    if (link) {
      link.href = href;
      link.textContent = lot.title;
    }

    // Price + est. retail
    const price = card.querySelector('p.MuiTypography-h6');
    if (price) {
      price.textContent = `$${lot.currentPrice}`;
      const retail = price.nextElementSibling;
      if (retail) {
        if (lot.estimatedRetailPrice == null) retail.remove();
        else {
          const sep = retail.firstElementChild;
          retail.replaceChildren(...(sep ? [sep] : []), `est. retail $${lot.estimatedRetailPrice}`);
        }
      }
      const priceRow = price.parentElement;
      while (priceRow.nextElementSibling) priceRow.nextElementSibling.remove();
      priceRow.after(el('a', { class: 'tlx-view-btn', href, text: 'View lot' }));
    }
    return card;
  }

  function pagerItems(page, pages) {
    const items = new Set([1, pages, page - 1, page, page + 1]);
    const nums = [...items].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i && n - nums[i - 1] > 1) out.push('…');
      out.push(n);
    });
    return out;
  }

  function renderSorted(grid, dir) {
    // Copy the native grid's layout classes (not our own state classes).
    const gridClass = [...grid.classList].filter((c) => !c.startsWith('tlx-')).join(' ');
    grid.classList.add('tlx-native-hidden');
    nativeExtras(grid).forEach((n) => n.classList.add('tlx-native-hidden'));

    let box = grid.parentElement.querySelector(':scope > .tlx-sorted');
    if (!box) {
      box = el(
        'div',
        { class: 'tlx-sorted' },
        el('div', { class: 'tlx-sorted-bar' }),
        el('div', { class: gridClass, 'data-tlx-sorted-grid': '' }),
        el('nav', { class: 'tlx-pager', 'aria-label': 'Sorted lots pages' })
      );
      grid.after(box);
    }
    const bar = box.querySelector('.tlx-sorted-bar');
    const sgrid = box.querySelector('[data-tlx-sorted-grid]');
    const pager = box.querySelector('.tlx-pager');
    for (const c of gridClass.split(' ')) if (c && !sgrid.classList.contains(c)) sgrid.classList.add(c);

    if (sv.loading || sv.error || !sv.lots) {
      const key = `status|${sv.loading}|${sv.error}|${sv.progress?.done}|${sv.progress?.total}`;
      if (sv.renderKey === key) return;
      sv.renderKey = key;
      sgrid.replaceChildren();
      pager.replaceChildren();
      if (sv.error) {
        bar.replaceChildren(
          el('span', { class: 'tlx-sorted-error', text: `Couldn’t load lots for sorting: ${sv.error}` }),
          el('button', { type: 'button', class: 'tlx-text-btn', text: 'Retry', onclick: () => sv.filters && loadLots(sv.filters, sv.filterKey, true) })
        );
      } else {
        const { done = 0, total = null } = sv.progress || {};
        const pct = total ? Math.round((done / total) * 100) : 0;
        const bg = el('span');
        bg.style.width = `${pct}%`;
        bar.replaceChildren(
          el('span', { text: total ? `Loading lots for title sort… ${done.toLocaleString()} of ${total.toLocaleString()}` : 'Loading lots for title sort…' }),
          el('span', { class: 'tlx-progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, bg)
        );
      }
      return;
    }

    const list = visibleSortedLots(dir);
    const pages = Math.max(1, Math.ceil(list.length / SORT.pageSize));
    if (sv.page > pages) sv.page = pages;
    const excludedSig = JSON.stringify([
      Object.keys(state[KEYS.hidden]).length,
      state[KEYS.words],
      state[KEYS.filterOn],
      state[KEYS.removeFiltered],
      state[KEYS.showHidden],
      list.length,
    ]);
    const key = [sv.filterKey, dir, sv.page, sv.fetchedAt, excludedSig].join('|');
    if (sv.renderKey === key) return;
    sv.renderKey = key;

    const tpl = grid.querySelector(':scope > [data-lot-id]');
    const start = (sv.page - 1) * SORT.pageSize;
    const slice = list.slice(start, start + SORT.pageSize);
    const defaultLoc = defaultLocationName();
    const hr = grid.querySelector(':scope > hr');
    sgrid.replaceChildren(...(hr ? [hr.cloneNode(true)] : []), ...(tpl ? slice.map((l) => buildCard(tpl, l, defaultLoc)) : []));

    const excluded = sv.lots.length - list.length;
    const time = new Date(sv.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    bar.replaceChildren(
      el('span', {
        text:
          `Title ${dir === 'asc' ? 'A–Z' : 'Z–A'} · ` +
          (list.length ? `${(start + 1).toLocaleString()}–${(start + slice.length).toLocaleString()} of ${list.length.toLocaleString()}` : 'No lots') +
          (excluded ? ` (${excluded.toLocaleString()} hidden or filtered out)` : '') +
          ` · prices as of ${time}`,
      }),
      el('button', { type: 'button', class: 'tlx-text-btn', text: 'Refresh', onclick: () => loadLots(sv.filters, sv.filterKey, true) })
    );

    const go = (p) => {
      sv.page = p;
      scheduleScan();
      box.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -140);
    };
    const navBtn = (label, target, disabled, text) =>
      el('button', { type: 'button', 'aria-label': label, disabled: disabled || null, text, onclick: () => go(target) });
    pager.replaceChildren(
      ...(pages > 1
        ? [
            navBtn('Go to first page', 1, sv.page === 1, '«'),
            navBtn('Go to previous page', sv.page - 1, sv.page === 1, '‹'),
            ...pagerItems(sv.page, pages).map((n) =>
              n === '…'
                ? el('span', { class: 'tlx-pager-gap', text: '…' })
                : el('button', {
                    type: 'button',
                    'aria-label': `Go to page ${n}`,
                    'aria-current': n === sv.page ? 'page' : null,
                    text: String(n),
                    onclick: () => go(n),
                  })
            ),
            navBtn('Go to next page', sv.page + 1, sv.page === pages, '›'),
            navBtn('Go to last page', pages, sv.page === pages, '»'),
          ]
        : [])
    );
  }

  // Keep countdowns in the sorted view ticking.
  setInterval(() => {
    for (const span of document.querySelectorAll('.tlx-sorted [data-tlx-ends]')) setTime(span, span.dataset.tlxEnds);
  }, 1000);

  // ---------------------------------------------------------------------------
  // Tampermonkey menu
  // ---------------------------------------------------------------------------
  GM_registerMenuCommand('Toggle bid confirmation', () => {
    save(KEYS.confirm, !state[KEYS.confirm]);
    alert(`Bid confirmation is now ${state[KEYS.confirm] ? 'ON' : 'OFF'}.`);
  });
  GM_registerMenuCommand('Edit all filters…', () => {
    let text = state[KEYS.words].join(', ');
    for (;;) {
      const v = prompt('All filter regexes, comma separated (case-insensitive, whole words):', text);
      if (v === null) return;
      const list = splitFilters(v);
      const bad = list.filter((p) => !compileFilter(p));
      if (!bad.length) return save(KEYS.words, list);
      alert(`Invalid regex – fix and try again:\n\n${bad.join('\n')}`);
      text = v;
    }
  });
  GM_registerMenuCommand('Add filter regex…', () => {
    const v = prompt('Filter regex (case-insensitive, whole words):', '');
    const pattern = v?.trim();
    if (!pattern) return;
    if (!addFilter(pattern)) alert(`Invalid regex: ${pattern}`);
  });
  GM_registerMenuCommand('Unhide all lots', unhideAll);

  // ---------------------------------------------------------------------------
  // Main loop – the site is a Next.js/React SPA, so react to DOM changes.
  // ---------------------------------------------------------------------------
  let scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      observer.disconnect();
      try {
        ensureSortToggle();
        syncSortedView();
        processCards();
        processSidebar();
        processDetailPage();
      } finally {
        observer.observe(document.body, OBSERVE);
      }
    });
  }

  // characterData: React updates live prices by editing text nodes in place.
  const OBSERVE = { childList: true, subtree: true, characterData: true };
  const observer = new MutationObserver(scheduleScan);
  // Column count changes at breakpoints; recompute compact-grid row separators.
  window.addEventListener('resize', scheduleScan);
  observer.observe(document.body, OBSERVE);
  scheduleScan();
}
