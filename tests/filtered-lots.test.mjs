import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = { scrollTo() {} };
const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { applySetting } = await vite.ssrLoadModule('/src/app/server/settings.ts');
const { lots, updateLot } = await vite.ssrLoadModule('/src/app/server/catalog.ts');
const { DEFAULT_VIEW } = await vite.ssrLoadModule('/src/app/logic/view.ts');
const { filteredOnly, gridView, openFiltered, openClosed, closed, page, setView, sidebarOpen } =
  await vite.ssrLoadModule('/src/app/ui/state.ts');
const { navFromUrl, startHistory } = await vite.ssrLoadModule('/src/app/ui/history.ts');

const now = Date.now();
const lot = (id, title, extra = {}) => ({
  id,
  title,
  lot_number: `${id}`,
  auction_period: 'test',
  category: { value: 'tools', label: 'Tools' },
  condition: { value: 1, display_name: 'New' },
  location: { id: 1, name: 'Raleigh' },
  ends_at: new Date(now + 2 * 3_600_000).toISOString(),
  current_price: 10,
  estimated_retail_price: 0,
  transfer_fee: 0,
  is_transferable: false,
  images: [],
  bid_count: 0,
  ...extra,
});
const ids = () => gridView.value.rows.map(row => row.lot.id);

beforeEach(() => {
  filteredOnly.value = false;
  closed.value = null;
  applySetting(KEYS.view, DEFAULT_VIEW);
  applySetting(KEYS.words, ['drill', 'saw']);
  applySetting(KEYS.filterOn, true);
  applySetting(KEYS.removeFiltered, true);
  lots.value = new Map([
    [1, lot(1, 'Cordless drill')],
    [2, lot(2, 'Garden rake')],
    [3, lot(3, 'Circular saw')],
    [4, lot(4, 'Old drill', { ends_at: new Date(now - 1 * 3_600_000).toISOString() })],
  ]);
});

test('filtered page shows only rule matches, including removed and hidden lots, and restores the catalog', () => {
  assert.deepEqual(ids(), [2]);
  page.value = 4;
  sidebarOpen.value = true;
  openFiltered();
  assert.equal(page.value, 1);
  assert.equal(sidebarOpen.value, false);
  assert.deepEqual(ids(), [1, 3]);
  assert.deepEqual(
    gridView.value.rows.map(row => row.matched),
    ['drill', 'saw'],
  );
  openFiltered(false);
  assert.deepEqual(ids(), [2]);
});

test('reviewing rule matches works while Apply filters is off and updates when rules change', () => {
  applySetting(KEYS.filterOn, false);
  openFiltered();
  assert.deepEqual(ids(), [1, 3]);
  applySetting(KEYS.words, ['saw']);
  assert.deepEqual(ids(), [3]);
  applySetting(KEYS.words, []);
  assert.deepEqual(ids(), []);
});

test('search and sort stay on the filtered page and My lots never admits nonmatching lots', () => {
  lots.value = new Map([...lots.peek()].map(([id, item]) => [id, { ...item, has_bid: true }]));
  openFiltered();
  setView({ sort: 'newly-listed', mine: 'bid' });
  assert.equal(filteredOnly.value, true);
  assert.deepEqual(ids(), [3, 1]);
  setView({ search: 'drill' });
  assert.deepEqual(ids(), [1]);
  openClosed('won');
  assert.equal(filteredOnly.value, false);
  assert.equal(closed.value, 'won');
  openFiltered();
  assert.equal(closed.value, null);
});

test('watchlist excludes bid-on lots even when the site watchlist flag remains set', () => {
  lots.value = new Map([
    [1, lot(1, 'Watched drill', { is_watchlisted: true, bid_count: 3 })],
    [2, lot(2, 'Bid-on rake', { is_watchlisted: true, has_bid: true })],
    [
      3,
      lot(3, 'Winning saw', {
        is_watchlisted: true,
        your_standing: { is_leading: true, your_max_bid: 20 },
      }),
    ],
    [
      4,
      lot(4, 'Outbid wrench', {
        is_watchlisted: true,
        your_standing: { is_leading: false, your_max_bid: 15 },
      }),
    ],
    [5, lot(5, 'Unwatched hammer', { is_watchlisted: false })],
  ]);
  setView({ mine: 'watch' });
  assert.deepEqual(ids(), [1]);

  updateLot(1, { has_bid: true });
  assert.deepEqual(ids(), [], 'a newly placed bid immediately leaves the watchlist');
  setView({ mine: 'bid' });
  assert.deepEqual(ids().toSorted(), [1, 2, 3, 4]);
});

test('filtered page round-trips through URLs and browser back/forward', () => {
  assert.equal(navFromUrl('?filtered=1').filteredOnly, true);
  assert.equal(navFromUrl('?filtered=0').filteredOnly, false);
  assert.equal(navFromUrl('?closed=won&filtered=1').filteredOnly, false);
  const entries = [];
  const listeners = {};
  globalThis.location = { pathname: '/tlx' };
  globalThis.history = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      entries.push({ state, url });
    },
    pushState(state, _title, url) {
      this.state = state;
      entries.push({ state, url });
    },
  };
  globalThis.window = {
    scrollTo() {},
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
  };
  globalThis.requestAnimationFrame = fn => fn();
  startHistory();
  const catalog = history.state;
  openFiltered();
  const filtered = history.state;
  assert.equal(entries.at(-1).url, '/tlx?filtered=1');
  listeners.popstate({ state: catalog });
  assert.equal(filteredOnly.value, false);
  assert.deepEqual(ids(), [2]);
  listeners.popstate({ state: filtered });
  assert.equal(filteredOnly.value, true);
  assert.deepEqual(ids(), [1, 3]);
});
