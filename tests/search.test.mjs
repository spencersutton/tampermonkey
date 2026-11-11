import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const { DEFAULT_VIEW, makeMatcher, makeRow, savedFilters, normalizeView } =
  await vite.ssrLoadModule('/src/app/view.ts');
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { applySetting } = await vite.ssrLoadModule('/src/app/settings.ts');
const { lots, lotBrands, lotModels, loadDetail } = await vite.ssrLoadModule('/src/app/catalog.ts');
const { gridView, searchStats, setView, storedView } =
  await vite.ssrLoadModule('/src/app/state.ts');
const { applyCatalog } = await vite.ssrLoadModule('/src/app/source.ts');
const { navFromUrl } = await vite.ssrLoadModule('/src/app/history.ts');

const now = Temporal.Now.instant();
const ex = {
  words: [],
  filterOn: false,
  removeFiltered: false,
  hidden: {},
  showHidden: false,
  customCategories: [],
};
const fixture = (patch = {}) => ({
  id: 1,
  title: 'Cordless drill',
  lotNumber: 'A-123',
  auctionPeriod: 'test',
  category: { value: 'tools', label: 'Tools' },
  condition: null,
  location: null,
  endsAt: now.add({ hours: 2 }),
  firstSeenAt: now,
  currentPrice: 20,
  estimatedRetailPrice: null,
  transferFee: 0,
  isTransferable: false,
  images: [],
  bidCount: 0,
  version: 2,
  brand: 'Black & Decker',
  model: 'BCD-700 XL',
  ...patch,
});
const matches = (search, lot = fixture(), view = {}, details) =>
  makeMatcher({ ...DEFAULT_VIEW, search, ...view }, now, details)(makeRow(lot, '', ex));

beforeEach(() => {
  storage.clear();
  applySetting(KEYS.view, DEFAULT_VIEW);
  applySetting(KEYS.defaultFilters, { categories: [], conditions: [] });
  applySetting(KEYS.customCategories, []);
  applySetting(KEYS.words, []);
  applySetting(KEYS.hidden, {});
  applySetting(KEYS.savedSearches, []);
  lots.value = new Map();
  lotBrands.value = new Map();
  lotModels.value = new Map();
});

test('ordinary search spans title, lot number, brand and model with AND semantics', () => {
  for (const query of [
    'drill',
    'A-123',
    'decker',
    'bcd-700',
    'black XL drill 123',
    '  ',
    '"cordless drill"',
  ]) {
    assert.equal(matches(query), true, query);
  }
  assert.equal(matches('black missing'), false);
  assert.equal(matches('"drill cordless"'), false);
  assert.equal(matches('"drill"missing'), false, 'text after a quote must not be discarded');
  assert.equal(matches('undefined', fixture({ brand: undefined, model: undefined })), false);
  assert.equal(matches('null', fixture({ brand: null, model: null })), false);
  assert.equal(matches('drill', fixture({ brand: null, model: undefined })), true);
});

test('brand/model qualifiers restrict matching to their fields, with optional spaces and quotes', () => {
  for (const query of [
    'brand:black',
    'BRAND: BLACK',
    'model:bcd-700',
    'model: "BCD-700 XL"',
    'brand:"Black & Decker" model:700 drill',
    'drill brand: "Black & Decker" model: XL',
    'brand:black brand:decker',
  ]) {
    assert.equal(matches(query), true, query);
  }
  for (const query of [
    'brand:drill',
    'model:black',
    'brand:700',
    'brand:',
    'model:',
    'brand:""',
    'brand:"Unknown Brand"',
  ]) {
    assert.equal(matches(query), false, query);
  }
  assert.equal(matches('brand:dewalt', fixture({ title: 'DeWalt drill', brand: null })), false);
  assert.equal(matches('model:700', fixture({ title: 'BCD-700 drill', model: null })), false);
  assert.equal(
    matches('ratio:1:2', fixture({ title: 'Mix ratio:1:2' })),
    true,
    'unknown qualifiers remain literal',
  );
  assert.equal(matches('brand:.*'), false, 'ordinary search does not interpret regex syntax');
});

test('regex searches known details and retains invalid-pattern and literal-qualifier behavior', () => {
  for (const query of ['black.*decker', 'bcd-\\d+', 'drill.*A-123', '']) {
    assert.equal(matches(query, fixture(), { searchRegex: true }), true, query);
  }
  assert.equal(matches('[', fixture(), { searchRegex: true }), false);
  assert.equal(matches('brand:black', fixture(), { searchRegex: true }), false);
  assert.equal(
    matches('brand:black', fixture({ title: 'brand:black' }), { searchRegex: true }),
    true,
  );
});

test('search still intersects with category and price filters', () => {
  assert.equal(matches('brand:black', fixture(), { categories: ['tools'], priceMax: 20 }), true);
  assert.equal(matches('brand:black', fixture(), { categories: ['garden'] }), false);
  assert.equal(matches('brand:black', fixture(), { priceMax: 19 }), false);
  assert.equal(matches('brand:black', fixture(), { noCategories: true }), false);
});

test('newer detail maps override stale lot fields, including explicitly missing values', () => {
  const details = { brands: new Map([[1, 'DeWalt']]), models: new Map([[1, null]]) };
  assert.equal(matches('brand:dewalt', fixture(), {}, details), true);
  assert.equal(matches('brand:black', fixture(), {}, details), false);
  assert.equal(matches('model:700', fixture(), {}, details), false);
  assert.equal(matches('brand:black', fixture({ id: 2 }), {}, details), true);
});

test('cached details and subsequent changes update grid and saved-search counts without fetching', (t) => {
  t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Searching must not fetch');
  });
  const search = 'brand:"Black & Decker" model:700';
  setView({ search });
  applySetting(KEYS.savedSearches, [
    {
      id: 'drills',
      view: savedFilters(storedView.value),
      lastViewedAt: now.subtract({ hours: 1 }),
    },
  ]);
  const reply = (lot, seq) => ({
    now: Date.now(),
    nextPullAt: Date.now() + 60_000,
    meta: { fetchedAt: Date.now() },
    progress: null,
    error: null,
    seq,
    full: seq === 1,
    ids: [1],
    lots: [
      {
        ...lot,
        endsAt: lot.endsAt.epochMilliseconds,
        firstSeenAt: lot.firstSeenAt.epochMilliseconds,
      },
    ],
  });
  applyCatalog(reply(fixture(), 1));
  assert.deepEqual(
    gridView.value.rows.map((r) => r.lot.id),
    [1],
  );
  assert.deepEqual(searchStats.value.get('drills'), { total: 1, fresh: 1 });
  // Metadata changes even if the cached price version is newer.
  applyCatalog(reply(fixture({ version: 1, model: null }), 2));
  assert.equal(gridView.value.rows.length, 0);
  assert.deepEqual(searchStats.value.get('drills'), { total: 0, fresh: 0 });
  lotModels.value = new Map([[1, 'BCD-700']]);
  assert.equal(gridView.value.rows.length, 1);
  assert.deepEqual(searchStats.value.get('drills'), { total: 1, fresh: 1 });
});

test('newly loaded details become searchable without a price-version update', async (t) => {
  lots.value = new Map([[50, fixture({ id: 50, brand: undefined, model: undefined })]]);
  setView({ search: 'brand:acme model:d-50' });
  applySetting(KEYS.savedSearches, [
    {
      id: 'new-details',
      view: savedFilters(storedView.value),
      lastViewedAt: now.subtract({ hours: 1 }),
    },
  ]);
  assert.equal(gridView.value.rows.length, 0);
  assert.equal(searchStats.value.get('new-details').total, 0);
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      id: 50,
      auction_period: 'test',
      title: 'Cordless drill',
      lot_number: 'A-123',
      brand: 'Acme',
      model: 'D-50',
      ends_at: now.add({ hours: 2 }).toString(),
      images: [],
      version: 1,
    }),
  );
  await loadDetail(lots.value.get(50));
  assert.deepEqual(
    gridView.value.rows.map((r) => r.lot.id),
    [50],
  );
  assert.deepEqual(searchStats.value.get('new-details'), { total: 1, fresh: 1 });
  assert.equal(lots.value.get(50).currentPrice, 20);
});

test('qualifiers survive stored views, saved searches and shared URLs unchanged', () => {
  const search = 'brand: "Black & Decker" model:700 drill';
  setView({ search });
  const stored = normalizeView(JSON.parse(storage.get(`tlx:${KEYS.view}`)));
  const saved = normalizeView(savedFilters(stored));
  const shared = navFromUrl(`?${new URLSearchParams({ search })}`).view;
  for (const view of [stored, saved, shared]) {
    assert.equal(view.search, search);
    assert.equal(makeMatcher(view, now)(makeRow(fixture(), '', ex)), true);
  }
});
