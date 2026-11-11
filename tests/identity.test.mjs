import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const { brandModelKey, itemsMatch, sameItemType, groupItems, groupNames } =
  await vite.ssrLoadModule('/src/shared/names.ts');
const { computeView, DEFAULT_VIEW, normalizeView, savedFilters } =
  await vite.ssrLoadModule('/src/app/view.ts');
const { lots, lotBrands, lotModels, updateItemType } =
  await vite.ssrLoadModule('/src/app/catalog.ts');
const { gridView, setView } = await vite.ssrLoadModule('/src/app/state.ts');
const { applyCatalog, setItemType } = await vite.ssrLoadModule('/src/app/source.ts');
const { fetchClosed } = await vite.ssrLoadModule('/src/app/api.ts');
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
const lot = (id, fields = {}) => ({
  id,
  auctionPeriod: 'test',
  title: 'Cordless drill',
  lotNumber: `${id}`,
  brand: 'Acme',
  model: 'D-100',
  endsAt: now.add({ hours: 2 }),
  currentPrice: 10,
  category: null,
  condition: null,
  location: null,
  transferFee: 0,
  isTransferable: false,
  estimatedRetailPrice: null,
  bidCount: 0,
  images: [],
  version: 1,
  ...fields,
});
const view = (items, changes = {}, details) =>
  computeView(items, { ...DEFAULT_VIEW, ...changes }, '', ex, now, details);

test('identity matches ignore titles, case and whitespace but not model punctuation or order', () => {
  const first = lot(1);
  assert.equal(
    itemsMatch(
      first,
      lot(2, { title: 'Completely different 99-pack', brand: ' ACME ', model: ' d-100 ' }),
      100,
    ),
    true,
  );
  for (const change of [
    { model: 'D-101' },
    { brand: 'Other' },
    { model: 'D100' },
    { model: '100-D' },
  ]) {
    assert.equal(itemsMatch(first, lot(2, change), 50), false);
  }
  assert.equal(
    brandModelKey(lot(1, { brand: ' Acme   Tools ', model: ' D  100 ' })),
    '["acme tools","d 100"]',
  );
  for (const change of [{ brand: null }, { model: undefined }, { brand: '   ' }]) {
    const partial = lot(2, change);
    assert.equal(itemsMatch(first, partial, 100), true);
    assert.equal(itemsMatch(partial, first, 100), true);
    assert.equal(brandModelKey(partial), null);
  }
  assert.equal(
    itemsMatch(lot(1, { brand: null, title: 'Drill Qty 2' }), lot(2, { title: 'Drill Qty 3' }), 50),
    false,
  );
  assert.equal(
    sameItemType(first, lot(2, { title: 'drill Cordless', brand: null })),
    false,
    'item-type fallback remains exact',
  );
});

test('grouping keeps known models separate, even when an unknown title matches both', () => {
  const items = [
    lot(1),
    lot(2, { model: null }),
    lot(3, { model: 'D-200' }),
    lot(4, { title: 'Other wording' }),
  ];
  for (const ordering of [items, [...items].reverse(), [items[1], items[2], items[0], items[3]]]) {
    const groups = groupItems(ordering, 90);
    assert.equal(groups.get(1), groups.get(4));
    assert.notEqual(groups.get(1), groups.get(3));
    assert.ok(groups.get(2) === groups.get(1) || groups.get(2) === groups.get(3));
  }
  const fallback = groupNames(['Cordless drill', 'drill CORDLESS', 'Cordless drill Qty 2'], 90);
  assert.equal(fallback.get('Cordless drill'), fallback.get('drill CORDLESS'));
  assert.notEqual(fallback.get('Cordless drill'), fallback.get('Cordless drill Qty 2'));
});

test('catalog title fallback uses a fixed 90% threshold', () => {
  const title = 'Cordless drill with battery charger case bits belt clip';
  const items = [
    lot(1, { title: `${title} manual`, brand: null, model: null }),
    lot(2, { title, brand: null, model: null }),
    lot(3, { title: 'Cordless drill with battery charger', brand: null, model: null }),
  ];
  const result = view(items);
  assert.equal(result.combined, 1);
  assert.deepEqual(
    result.groups.get(1).map((row) => row.lot.id),
    [1, 2],
  );
  assert.deepEqual(
    result.rows.map((row) => row.lot.id),
    [1, 3],
  );
});

test('dedupe preserves condition, cost ordering, and independent bid/hidden/filtered cards', () => {
  const items = [
    lot(1, { title: 'Expensive kit', currentPrice: 30 }),
    lot(2, { title: 'Cheap tool', currentPrice: 5 }),
    lot(3, { condition: { value: 1, label: 'New' } }),
    lot(4, { hasBid: true }),
    lot(5, { title: 'Hide me' }),
    lot(6, { title: 'Excluded item' }),
  ];
  const result = computeView(
    items,
    DEFAULT_VIEW,
    '',
    {
      ...ex,
      hidden: { 5: {} },
      showHidden: true,
      words: ['Excluded'],
      filterOn: true,
    },
    now,
  );
  assert.equal(result.combined, 1);
  const combined = result.rows.find((row) => row.others.length);
  assert.equal(combined.lot.id, 2);
  assert.deepEqual(
    combined.others.map((row) => row.lot.id),
    [1],
  );
  assert.deepEqual(
    result.groups.get(1).map((row) => row.lot.id),
    [2, 1],
  );
  assert.equal(result.rows.length, 5);
});

test('live identity changes invalidate dedupe and brand/model sorting without a price update', () => {
  lots.value = new Map([
    [10, lot(10, { title: 'Zebra tool', brand: undefined, model: undefined })],
    [11, lot(11, { title: 'Apple tool', brand: undefined, model: undefined })],
  ]);
  lotBrands.value = new Map();
  lotModels.value = new Map();
  setView({ ...DEFAULT_VIEW, sort: 'brand-model-asc' });
  assert.deepEqual(
    gridView.value.rows.map((row) => row.lot.id),
    [11, 10],
  );
  lotBrands.value = new Map([
    [10, 'Acme'],
    [11, 'Zeta'],
  ]);
  lotModels.value = new Map([
    [10, 'D-2'],
    [11, 'D-3'],
  ]);
  assert.deepEqual(
    gridView.value.rows.map((row) => row.lot.id),
    [10, 11],
  );
  lotBrands.value = new Map([
    [10, 'Acme'],
    [11, 'Acme'],
  ]);
  lotModels.value = new Map([
    [10, 'D-2'],
    [11, 'D-2'],
  ]);
  assert.equal(gridView.value.combined, 1);
  lotModels.value = new Map([
    [10, 'D-2'],
    [11, null],
  ]);
  assert.equal(gridView.value.combined, 0);
});

test('brand/model sort uses natural model order, title fallback, and persists in views and URLs', () => {
  const items = [
    lot(1, { title: 'Z', model: 'D-10' }),
    lot(2, { title: 'Y', model: 'D-2' }),
    lot(3, { title: 'Aardvark', model: null }),
    lot(4, { title: 'A', brand: 'Zeta' }),
  ];
  const settings = { sort: 'brand-model-asc' };
  assert.deepEqual(
    view(items, settings).rows.map((row) => row.lot.id),
    [3, 2, 1, 4],
  );
  assert.deepEqual(
    view(items, { sort: 'title-asc' }).rows.map((row) => row.lot.id),
    [4, 3, 2, 1],
  );
  const saved = normalizeView(savedFilters({ ...DEFAULT_VIEW, ...settings }));
  assert.equal(saved.sort, settings.sort);
  assert.equal(navFromUrl('?sort=brand-model-asc').view.sort, settings.sort);
});

test('item-type corrections use latest cached identity with exact-title fallback', () => {
  lots.value = new Map([
    [20, lot(20)],
    [21, lot(21, { title: 'Different title' })],
    [22, lot(22, { model: 'D-200' })],
    [23, lot(23, { brand: undefined, model: undefined })],
  ]);
  lotBrands.value = new Map([[21, 'Acme']]);
  lotModels.value = new Map([[21, 'D-300']]);
  updateItemType(lot(20), 'driver');
  assert.equal(lots.value.get(20).itemType, 'driver');
  assert.equal(
    lots.value.get(21).itemType,
    undefined,
    'newer cached identity wins over the base lot',
  );
  assert.equal(lots.value.get(22).itemType, undefined);
  assert.equal(lots.value.get(23).itemType, 'driver');
});

test('item-type sort groups types case-insensitively, uses ending time for ties, and puts unassigned lots last', () => {
  const items = [
    lot(1, { itemType: 'Saw' }),
    lot(2, { itemType: 'drill', endsAt: now.add({ hours: 3 }) }),
    lot(3, { itemType: 'Drill', endsAt: now.add({ hours: 1 }) }),
    lot(4, { endsAt: now.add({ minutes: 1 }) }),
    lot(5, { itemType: '', endsAt: now.add({ minutes: 2 }) }),
  ].map((item) => ({ ...item, model: `D-${item.id}` }));
  const settings = { sort: 'item-type-asc' };
  assert.deepEqual(
    view(items, settings).rows.map((row) => row.lot.id),
    [3, 2, 1, 4, 5],
  );
  assert.equal(normalizeView(savedFilters({ ...DEFAULT_VIEW, ...settings })).sort, settings.sort);
  assert.equal(navFromUrl('?sort=item-type-asc').view.sort, settings.sort);
});

test('item-type corrections immediately reorder the grid when sorting by item type', () => {
  lots.value = new Map([
    [60, lot(60, { itemType: 'saw' })],
    [61, lot(61, { itemType: 'drill', model: 'D-200' })],
  ]);
  setView({ ...DEFAULT_VIEW, sort: 'item-type-asc' });
  assert.deepEqual(
    gridView.value.rows.map((row) => row.lot.id),
    [61, 60],
  );
  updateItemType(lot(60), 'battery');
  assert.deepEqual(
    gridView.value.rows.map((row) => row.lot.id),
    [60, 61],
  );
});

test('identity correction survives stale polls without leaking to another model', async (t) => {
  const items = [lot(30), lot(31, { title: 'Another listing' }), lot(32, { model: 'D-200' })];
  lots.value = new Map(items.map((item) => [item.id, item]));
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      title: items[0].title,
      brand: 'Acme',
      model: 'D-100',
      itemType: 'driver',
      seq: 5,
    }),
  );
  await setItemType(30, 'driver');
  const poll = (seq) =>
    applyCatalog({
      seq,
      full: true,
      ids: null,
      now: Date.now(),
      nextPullAt: Date.now(),
      meta: { fetchedAt: 0 },
      progress: null,
      error: null,
      lots: items.map((item) => ({ ...item, endsAt: item.endsAt.epochMilliseconds })),
    });
  poll(4);
  assert.equal(lots.value.get(31).itemType, 'driver');
  assert.equal(lots.value.get(32).itemType, undefined);
  poll(5);
});

test('closed-page normalization preserves cached identity and past-price updates beat stale price versions', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      count: 1,
      results: [{ lot_id: 50, title: 'Different description', brand: 'Acme', model: 'D-100' }],
    }),
  );
  const [closed] = await fetchClosed('lost', () => {});
  assert.equal(itemsMatch(closed, lot(1), 100), true);
  lots.value = new Map([[1, lot(1, { version: 10, currentPrice: 50 })]]);
  applyCatalog({
    seq: 10,
    full: true,
    ids: null,
    now: Date.now(),
    nextPullAt: Date.now(),
    meta: { fetchedAt: 0 },
    progress: null,
    error: null,
    lots: [{ ...lot(1), endsAt: now.epochMilliseconds, pastCloses: { n: 1, recent: [] } }],
  });
  assert.equal(lots.value.get(1).currentPrice, 50);
  assert.equal(lots.value.get(1).pastCloses.n, 1);
});

test('duplicate-heavy catalogs collapse efficiently without changing known-model boundaries', () => {
  const items = Array.from({ length: 20000 }, (_, id) => lot(id, { model: `D-${id % 10}` }));
  const start = performance.now();
  const groups = groupItems(items, 90);
  assert.equal(new Set(groups.values()).size, 10);
  assert.ok(
    performance.now() - start < 2000,
    '20,000 listings should not require quadratic comparisons',
  );
});
