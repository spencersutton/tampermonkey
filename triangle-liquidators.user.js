// ==UserScript==
// @name         Triangle Liquidators – Hide, Filter & Bid Confirm
// @namespace    https://triangleliquidators.com/
// @version      1.2.0
// @description  Hide individual lots, gray out lots matching filter words, confirm bids, and show estimated total cost.
// @match        https://triangleliquidators.com/*
// @match        https://www.triangleliquidators.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
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
    collapsed: 'collapsedLists', // { words: boolean, hidden: boolean }
  };
  const DEFAULTS = {
    [KEYS.hidden]: {},
    [KEYS.words]: [],
    [KEYS.filterOn]: true,
    [KEYS.confirm]: true,
    [KEYS.showHidden]: false,
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

  function save(key, value) {
    state[key] = value;
    GM_setValue(key, value);
    if (key === KEYS.words) wordRegexes = buildRegexes(value);
    scheduleScan();
  }

  if (typeof GM_addValueChangeListener === 'function') {
    for (const k of Object.values(KEYS)) {
      GM_addValueChangeListener(k, (_name, _old, val, remote) => {
        if (!remote) return;
        state[k] = val;
        if (k === KEYS.words) wordRegexes = buildRegexes(val);
        scheduleScan();
      });
    }
  }

  // Each filter is a case-insensitive regex tested against the lot title.
  // Patterns without whitespace are implicitly whole-word: \b(?:pattern)\b.
  // Returns null for an invalid pattern.
  function compileFilter(pattern) {
    const src = /\s/.test(pattern) ? pattern : `\\b(?:${pattern})\\b`;
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
    .tlx-slot-hidden { display: none !important; }
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
    .tlx-chip {
      display: inline-flex; align-items: center; gap: 2px; height: 24px; padding: 0 4px 0 10px;
      border-radius: 16px; font-size: 13px; box-sizing: border-box;
      border: 1px solid var(--mui-palette-divider); color: var(--mui-palette-text-primary);
    }
    .tlx-chip button {
      display: inline-flex; padding: 0; border: 0; background: none; cursor: pointer;
      color: var(--mui-palette-text-secondary); opacity: .7;
    }
    .tlx-chip button:hover { opacity: 1; }
    .tlx-chip > span { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
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

  let pageStats = { filtered: 0, hidden: 0 };

  function processCards() {
    const seen = new Set();
    const stats = { filtered: 0, hidden: 0 };
    for (const link of document.querySelectorAll(TITLE_SEL)) {
      const href = link.getAttribute('href');
      const id = lotIdFromHref(href);
      if (!id) continue;
      const slot = slotFor(link);
      if (seen.has(slot)) continue;
      seen.add(slot);

      const title = link.textContent.trim();
      const isHidden = !!state[KEYS.hidden][id];
      const matched = matchFilter(title);
      const showHidden = state[KEYS.showHidden];

      slot.dataset.tlxLot = id;
      slot.classList.toggle('tlx-slot-hidden', isHidden && !showHidden);
      const dim = !!matched || (isHidden && showHidden);
      slot.classList.toggle('tlx-dim', dim);

      // Filtered lots and revealed-hidden lots both get their controls disabled.
      setControlsDisabled(slot, dim);

      ensureHideButton(slot, id, title, href, isHidden);
      setBadge(slot, isHidden && showHidden ? 'Hidden' : matched ? `Filtered: ${matched}` : null);

      const priceEl = slot.querySelector('p.MuiTypography-h6');
      if (priceEl) setTotal(priceEl, locationIn(slot));

      if (isHidden) stats.hidden++;
      else if (matched) stats.filtered++;
    }

    // Clean up slots that are no longer lot cards (React reused the node).
    for (const slot of document.querySelectorAll('[data-tlx-lot]')) {
      if (seen.has(slot)) continue;
      delete slot.dataset.tlxLot;
      slot.classList.remove('tlx-slot-hidden', 'tlx-dim');
      setControlsDisabled(slot, false);
      slot.querySelectorAll('.tlx-hide-btn, .tlx-badge, .tlx-total').forEach((n) => n.remove());
    }

    pageStats = stats;
  }

  // ---------------------------------------------------------------------------
  // "Hide & Filter" section injected into the native Filters sidebar
  // ---------------------------------------------------------------------------
  function switchRow(labelText, key, extraClass = '') {
    const input = el('input', { type: 'checkbox', role: 'switch' });
    input.checked = !!state[key];
    input.addEventListener('change', () => save(key, input.checked));
    const row = el(
      'label',
      { class: `tlx-switch-row ${extraClass}`.trim(), 'data-tlx-key': key },
      el('span', { text: labelText }),
      el('span', { class: 'tlx-switch' }, input, el('span', { class: 'tlx-track' }), el('span', { class: 'tlx-thumb' }))
    );
    return row;
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
      if (!compileFilter(pattern)) {
        setError('Invalid regex');
        return;
      }
      const existing = state[KEYS.words];
      wordInput.value = '';
      if (!existing.includes(pattern)) save(KEYS.words, [...existing, pattern]);
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
      switchRow('Gray out filtered lots', KEYS.filterOn),
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
          onclick: () => {
            if (confirm('Unhide all hidden lots?')) save(KEYS.hidden, {});
          },
        })
      )
    );
    return section;
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
              ? { class: 'tlx-chip', title: /\s/.test(w) ? `/${w}/i` : `/\\b(?:${w})\\b/i` }
              : { class: 'tlx-chip tlx-error', title: 'Invalid regex – ignored' },
            el('span', { text: w }),
            el(
              'button',
              {
                type: 'button',
                'aria-label': `Remove ${w}`,
                onclick: () => save(KEYS.words, state[KEYS.words].filter((x) => x !== w)),
              },
              icon('cancel', 16)
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
      ? `${pageStats.filtered} lot${pageStats.filtered === 1 ? '' : 's'} filtered on this page.`
      : 'Case-insensitive regex on the lot title. Patterns without spaces match whole words only.';
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
      const cur = document.querySelector('[aria-label^="Current bid"]');
      current = cur?.textContent.trim() ?? '';
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
    if (btn.hasAttribute('data-tlx-disabled') || btn.closest('.tlx-dim [data-tlx-disabled]')) {
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
  // Tampermonkey menu
  // ---------------------------------------------------------------------------
  GM_registerMenuCommand('Toggle bid confirmation', () => {
    save(KEYS.confirm, !state[KEYS.confirm]);
    alert(`Bid confirmation is now ${state[KEYS.confirm] ? 'ON' : 'OFF'}.`);
  });
  GM_registerMenuCommand('Add filter regex…', () => {
    const v = prompt('Filter regex (case-insensitive; no spaces = whole word):', '');
    const pattern = v?.trim();
    if (!pattern) return;
    if (!compileFilter(pattern)) return alert(`Invalid regex: ${pattern}`);
    if (!state[KEYS.words].includes(pattern)) save(KEYS.words, [...state[KEYS.words], pattern]);
  });
  GM_registerMenuCommand('Unhide all lots', () => {
    if (confirm('Unhide all hidden lots?')) save(KEYS.hidden, {});
  });

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
  observer.observe(document.body, OBSERVE);
  scheduleScan();
})();
