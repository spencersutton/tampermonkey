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
const { computeView, DEFAULT_VIEW, normalizeView, savedFilters } =
  await vite.ssrLoadModule('/src/app/view.ts');
const { lots, lotBrands, lotModels, updateItemType } =
  await vite.ssrLoadModule('/src/app/catalog.ts');
const { gridView, setView } = await vite.ssrLoadModule('/src/app/state.ts');
const { applyCatalog, setItemType } = await vite.ssrLoadModule('/src/app/source.ts');
const { fetchClosed } = await vite.ssrLoadModule('/src/app/api.ts');
const { navFromUrl } = await vite.ssrLoadModule('/src/app/history.ts');

const now = Date.now();
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
  auction_period: 'test',
  title: 'Cordless drill',
  lot_number: `${id}`,
  brand: 'Acme',
  model: 'D-100',
  ends_at: new Date(now + 2 * 3_600_000).toISOString(),
  current_price: 10,
  category: { value: 'tools', label: 'Tools' },
  condition: { value: 3, display_name: 'Used' },
  location: { id: 1, name: 'Raleigh' },
  transfer_fee: 0,
  is_transferable: false,
  estimated_retail_price: 0,
  bid_count: 0,
  images: [],
  version: 1,
  ...fields,
});
const view = (items, changes = {}, details) =>
  computeView(items, { ...DEFAULT_VIEW, ...changes }, 'Raleigh', ex, now, details);

test('lots the server grouped fold into one card; ungrouped lots keep their own', () => {
  const items = [
    lot(1, { title: 'Cordless drill kit', groupId: 1 }),
    lot(2, { title: 'Cordless drill', groupId: 1 }),
    lot(3, { title: 'Cordless drill', model: 'D-200' }),
  ];
  const result = view(items);
  assert.equal(result.combined, 1);
  assert.deepEqual(
    result.groups.get(1).map(row => row.lot.id),
    [1, 2],
  );
  assert.deepEqual(
    result.rows.map(row => row.lot.id),
    [1, 3],
  );
});

test('dedupe preserves condition, cost ordering, and independent bid/hidden/filtered cards', () => {
  const items = [
    lot(1, { title: 'Expensive kit', current_price: 30, groupId: 1 }),
    lot(2, { title: 'Cheap tool', current_price: 5, groupId: 1 }),
    lot(3, { condition: { value: 1, display_name: 'New' } }),
    lot(4, { has_bid: true, groupId: 1 }),
    lot(5, { title: 'Hide me', groupId: 1 }),
    lot(6, { title: 'Excluded item', groupId: 1 }),
  ];
  const result = computeView(
    items,
    DEFAULT_VIEW,
    'Raleigh',
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
  const combined = result.rows.find(row => row.others.length);
  assert.equal(combined.lot.id, 2);
  assert.deepEqual(
    combined.others.map(row => row.lot.id),
    [1],
  );
  assert.deepEqual(
    result.groups.get(1).map(row => row.lot.id),
    [2, 1],
  );
  assert.equal(result.rows.length, 5);
});

test('live identity changes re-sort by brand/model without a price update', () => {
  lots.value = new Map([
    [10, lot(10, { title: 'Zebra tool', brand: undefined, model: undefined })],
    [11, lot(11, { title: 'Apple tool', brand: undefined, model: undefined })],
  ]);
  lotBrands.value = new Map();
  lotModels.value = new Map();
  setView({ ...DEFAULT_VIEW, sort: 'brand-model-asc' });
  assert.deepEqual(
    gridView.value.rows.map(row => row.lot.id),
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
    gridView.value.rows.map(row => row.lot.id),
    [10, 11],
  );
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
    view(items, settings).rows.map(row => row.lot.id),
    [3, 2, 1, 4],
  );
  assert.deepEqual(
    view(items, { sort: 'title-asc' }).rows.map(row => row.lot.id),
    [4, 3, 2, 1],
  );
  const saved = normalizeView(savedFilters({ ...DEFAULT_VIEW, ...settings }));
  assert.equal(saved.sort, settings.sort);
  assert.equal(navFromUrl('?sort=brand-model-asc').view.sort, settings.sort);
});

test('item-type corrections apply to exactly the lots the server names', () => {
  lots.value = new Map([
    [20, lot(20)],
    [21, lot(21)],
    [23, lot(23, { brand: undefined, model: undefined })],
  ]);
  updateItemType([20, 23, 99], 'driver');
  assert.equal(lots.value.get(20).itemType, 'driver');
  assert.equal(lots.value.get(21).itemType, undefined);
  assert.equal(lots.value.get(23).itemType, 'driver');
  assert.equal(lots.value.has(99), false);
});

test('item-type sort groups types case-insensitively, uses ending time for ties, and puts unassigned lots last', () => {
  const items = [
    lot(1, { itemType: 'Saw' }),
    lot(2, { itemType: 'drill', ends_at: new Date(now + 3 * 3_600_000).toISOString() }),
    lot(3, { itemType: 'Drill', ends_at: new Date(now + 1 * 3_600_000).toISOString() }),
    lot(4, { ends_at: new Date(now + 1 * 60_000).toISOString() }),
    lot(5, { itemType: '', ends_at: new Date(now + 2 * 60_000).toISOString() }),
  ].map(item => ({ ...item, model: `D-${item.id}` }));
  const settings = { sort: 'item-type-asc' };
  assert.deepEqual(
    view(items, settings).rows.map(row => row.lot.id),
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
    gridView.value.rows.map(row => row.lot.id),
    [61, 60],
  );
  updateItemType([60], 'battery');
  assert.deepEqual(
    gridView.value.rows.map(row => row.lot.id),
    [60, 61],
  );
});

test('identity correction survives stale polls without leaking to another model', async t => {
  const items = [lot(30), lot(31, { title: 'Another listing' }), lot(32, { model: 'D-200' })];
  lots.value = new Map(items.map(item => [item.id, item]));
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ lotIds: [30, 31], itemType: 'driver', seq: 5 }),
  );
  await setItemType(30, 'driver');
  const poll = seq =>
    applyCatalog({
      seq,
      full: true,
      ids: null,
      now: Date.now(),
      nextPullAt: Date.now(),
      meta: { fetchedAt: 0 },
      progress: null,
      error: null,
      lots: items,
    });
  poll(4);
  assert.equal(lots.value.get(31).itemType, 'driver');
  assert.equal(lots.value.get(32).itemType, undefined);
  poll(5);
});

test('closed pages keep cached identity and past-price updates beat stale price versions', async t => {
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      count: 1,
      results: [
        {
          lot_id: 50,
          title: 'Different description',
          brand: 'Acme',
          model: 'D-100',
          relisted: [1],
        },
      ],
    }),
  );
  const [closed] = await fetchClosed('lost', () => {});
  assert.deepEqual([closed.brand, closed.model, closed.relisted], ['Acme', 'D-100', [1]]);
  lots.value = new Map([[1, lot(1, { version: 10, current_price: 50 })]]);
  applyCatalog({
    seq: 10,
    full: true,
    ids: null,
    now: Date.now(),
    nextPullAt: Date.now(),
    meta: { fetchedAt: 0 },
    progress: null,
    error: null,
    lots: [{ ...lot(1), ends_at: new Date(now).toISOString(), pastCloses: { n: 1, recent: [] } }],
  });
  assert.equal(lots.value.get(1).current_price, 50);
  assert.equal(lots.value.get(1).pastCloses.n, 1);
});
