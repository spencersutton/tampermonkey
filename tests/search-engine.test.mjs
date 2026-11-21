import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const search = await vite.ssrLoadModule('/src/shared/search.ts');
const { DEFAULT_VIEW, computeView, computeFacets, contextualFacets, normalizeView, savedFilters } =
  await vite.ssrLoadModule('/src/app/logic/view.ts');
const { suggest } = await vite.ssrLoadModule('/src/app/logic/suggest.ts');
const { navFromUrl } = await vite.ssrLoadModule('/src/app/ui/history.ts');
const { numericOrder } = await vite.ssrLoadModule('/src/app/logic/util.ts');
const { tagMenuOptions, toggleFilterOption } = await vite.ssrLoadModule(
  '/src/app/logic/filterOptions.ts',
);

const now = Date.now();
const ex = {
  words: [],
  filterOn: false,
  removeFiltered: false,
  hidden: {},
  showHidden: false,
  customCategories: [],
};
let nextId = 1;
const lot = (title, patch = {}) => ({
  id: nextId++,
  title,
  lot_number: `L-${nextId}`,
  auction_period: 'test',
  category: { value: 'tools', label: 'Tools' },
  condition: { value: 1, display_name: 'New' },
  location: { id: 1, name: 'Raleigh' },
  ends_at: new Date(now + 2 * 3_600_000).toISOString(),
  firstSeenAt: now,
  current_price: 20,
  estimated_retail_price: 0,
  transfer_fee: 0,
  is_transferable: false,
  images: [],
  bid_count: 0,
  version: 1,
  ...patch,
});
const run = (items, view = {}) =>
  computeView(items, { ...DEFAULT_VIEW, ...view }, 'Raleigh', ex, now);
const titles = result => result.rows.map(r => r.lot.title);

beforeEach(() => {
  storage.clear();
  nextId = 1;
});

test('parseQuery reads negation, field qualifiers and phrases', () => {
  assert.deepEqual(search.parseQuery('-used type:"pressure washer" brand:ryobi drill'), [
    { field: null, value: 'used', phrase: false, negate: true },
    { field: 'type', value: 'pressure washer', phrase: true, negate: false },
    { field: 'brand', value: 'ryobi', phrase: false, negate: false },
    { field: null, value: 'drill', phrase: false, negate: false },
  ]);
  assert.deepEqual(search.parseQuery('a-123 -'), [
    { field: null, value: 'a-123', phrase: false, negate: false },
    { field: null, value: '-', phrase: false, negate: false },
  ]);
  const q = 'brand:"Black & Decker" -"open box" saw';
  assert.equal(search.formatQuery(search.parseQuery(q)), q.toLowerCase());
});

test('plural, singular and synonym forms match; short synonyms only as whole words', () => {
  const items = [
    lot('Cordless Drill'),
    lot('Lithium Batteries 2-Pack'),
    lot('Mini Refrigerator'),
    lot('Back Pack Sprayer'),
    lot('Window Air Conditioner'),
  ];
  assert.deepEqual(titles(run(items, { search: 'drills' })), ['Cordless Drill']);
  assert.deepEqual(titles(run(items, { search: 'battery' })), ['Lithium Batteries 2-Pack']);
  assert.deepEqual(titles(run(items, { search: 'fridge' })), ['Mini Refrigerator']);
  assert.deepEqual(titles(run(items, { search: 'ac' })), ['Window Air Conditioner']);
  assert.deepEqual(titles(run(items, { search: '"drills"' })), [], 'phrases match exactly');
});

test('item types are searchable, with a type: qualifier', () => {
  const items = [
    lot('Ryobi 2000 PSI Electric Washer', { itemType: 'pressure washer' }),
    lot('Pressure Washer Surface Cleaner', { itemType: 'surface cleaner' }),
    lot('Dishwasher'),
  ];
  assert.deepEqual(titles(run(items, { search: 'type:"pressure washer"' })), [
    'Ryobi 2000 PSI Electric Washer',
  ]);
  assert.deepEqual(titles(run(items, { search: 'type:cleaners' })), [
    'Pressure Washer Surface Cleaner',
  ]);
});

test('negated words exclude lots', () => {
  const items = [lot('Drill Bit Set'), lot('Cordless Drill'), lot('Drill Press')];
  assert.deepEqual(titles(run(items, { search: 'drill -bit -press' })), ['Cordless Drill']);
  assert.deepEqual(titles(run(items, { search: '-drill' })), []);
});

test('best match ranks item type and whole-word matches above incidental ones', () => {
  const items = [
    lot('Drill Bit Set 100pc', { itemType: 'drill bit set' }),
    lot('Sawhorse Pair', { ends_at: new Date(now + 5 * 60_000).toISOString() }),
    lot('20V Compact Saw Kit', { itemType: 'circular saw' }),
    lot('Miter Saw', { itemType: 'miter saw' }),
  ];
  const result = run(items, { search: 'saw' });
  assert.equal(DEFAULT_VIEW.sort, 'relevance');
  assert.deepEqual(titles(result), ['20V Compact Saw Kit', 'Miter Saw', 'Sawhorse Pair']);
  // Without a search, best match falls back to ending soonest.
  assert.equal(titles(run(items))[0], 'Sawhorse Pair');
  // Explicit sorts still win.
  assert.equal(titles(run(items, { search: 'saw', sort: 'title-asc' }))[0], '20V Compact Saw Kit');
});

test('a misspelt search that matches nothing runs the corrected search instead', () => {
  const items = [lot('Cordless Drill'), lot('Drill Press'), lot('Circular Saw')];
  const result = run(items, { search: 'cordelss drlil' });
  assert.equal(result.correctedSearch, 'cordless drill');
  assert.deepEqual(titles(result), ['Cordless Drill']);
  const exact = run(items, { search: 'drill' });
  assert.equal(exact.correctedSearch, null);
  const hopeless = run(items, { search: 'xylophone' });
  assert.equal(run(items, { search: 'cordles' }).correctedSearch, null, 'prefixes already match');
  assert.equal(hopeless.correctedSearch, null);
  assert.equal(hopeless.rows.length, 0);
  assert.equal(run(items, { search: 'dril', searchRegex: true }).correctedSearch, null);
});

test('facet counts follow the results, each ignoring its own selection', () => {
  const items = [
    lot('Drill A', { brand: 'DeWalt', itemType: 'drill driver', current_price: 5 }),
    lot('Drill B', { brand: 'DEWALT ', itemType: 'drill driver', current_price: 30 }),
    lot('Drill C', { brand: 'Ryobi', itemType: 'drill driver', current_price: 30 }),
    lot('Saw D', {
      brand: 'Ryobi',
      itemType: 'miter saw',
      condition: { value: 2, display_name: 'Used' },
    }),
  ];
  const view = { ...DEFAULT_VIEW, search: 'drill', brands: ['dewalt'] };
  const result = run(items, view);
  assert.deepEqual(titles(result).toSorted(), ['Drill A', 'Drill B']);
  const all = computeFacets(items, now);
  assert.deepEqual(
    all.brands.map(f => [f.value, f.label, f.count]),
    [
      ['dewalt', 'DeWalt', 2],
      ['ryobi', 'Ryobi', 2],
    ],
  );
  const facets = contextualFacets(all, result.facetCounts, view);
  // Other brands still count (so you can add them), limited by the search.
  assert.deepEqual(
    facets.brands.map(f => [f.value, f.count]),
    [
      ['dewalt', 2],
      ['ryobi', 1],
    ],
  );
  assert.deepEqual(
    facets.types.map(f => [f.value, f.count]),
    [['drill driver', 2]],
  );
  assert.deepEqual(
    facets.conditions.map(f => [f.label, f.count]),
    [
      ['New', 2],
      ['Used', 0],
    ],
  );
  assert.deepEqual(
    facets.prices.slice(0, 3).map(f => f.count),
    [1, 0, 1],
  );
});

test('type and brand filters combine with categories and survive URLs and saved searches', () => {
  const items = [
    lot('Drill A', { brand: 'DeWalt', itemType: 'drill driver' }),
    lot('Drill B', { brand: 'Ryobi', itemType: 'drill driver' }),
    lot('Saw', { brand: 'DeWalt', itemType: 'miter saw' }),
  ];
  const nav = navFromUrl('?type=drill+driver&brand=dewalt&category=tools');
  assert.deepEqual(nav.view.types, ['drill driver']);
  assert.deepEqual(nav.view.brands, ['dewalt']);
  assert.deepEqual(titles(run(items, nav.view)), ['Drill A']);
  const saved = normalizeView(JSON.parse(JSON.stringify(savedFilters(nav.view))));
  assert.deepEqual(titles(run(items, saved)), ['Drill A']);
  // Views saved before these filters existed still load.
  assert.deepEqual(normalizeView({ search: 'x', types: 'bad' }).types, []);
  assert.deepEqual(normalizeView({ search: 'x' }).brands, []);
});

test('typeahead suggests matching item types, brands, categories and top lots', () => {
  const items = [
    lot('Ryobi Pressure Washer 2000', { brand: 'Ryobi', itemType: 'pressure washer' }),
    lot('Greenworks Pressure Washer', { itemType: 'pressure washer', groupId: 9 }),
    lot('Greenworks Pressure Washer copy', { itemType: 'pressure washer', groupId: 9 }),
    lot('Pressure Washer Hose', { itemType: 'pressure washer hose' }),
    lot('Hidden washer', { itemType: 'pressure washer' }),
  ];
  const facets = computeFacets(items, now);
  const s = suggest('press', facets, items, now, { 5: {} });
  assert.deepEqual(
    s.types.map(f => [f.label, f.count]),
    [
      ['pressure washer', 4],
      ['pressure washer hose', 1],
    ],
  );
  assert.equal(s.lots.length, 3, 'one lot per duplicate group, hidden lots left out');
  assert.ok(!s.lots.some(l => l.title === 'Hidden washer'));
  assert.deepEqual(
    suggest('ryo', facets, items, now, {}).brands.map(f => f.label),
    ['Ryobi'],
  );
  assert.deepEqual(suggest('brand:ryobi', facets, items, now, {}).lots, []);
  assert.deepEqual(suggest('  ', facets, items, now, {}).types, []);
});

test('filter values that are all numbers sort by value', () => {
  const label = x => x;
  assert.deepEqual(numericOrder(['10', '2.5', '8', '.5', '-1', '12'], label), [
    '-1',
    '.5',
    '2.5',
    '8',
    '10',
    '12',
  ]);
  assert.equal(numericOrder(['10', '8 in', '2'], label), null);
  assert.equal(numericOrder(['1/2', '3'], label), null);
  assert.equal(numericOrder([], label), null);
});

test('a combined card leads with the best condition and notes a cheaper worse one', () => {
  const cond = (value, label) => ({ condition: { value, display_name: label } });
  const items = [
    lot('Drill as-is', { ...cond(4, 'As-is'), current_price: 2, groupId: 1 }),
    lot('Drill used', { ...cond(3, 'Used'), current_price: 5, groupId: 1 }),
    lot('Drill like new', { ...cond(2, 'Like New'), current_price: 30, groupId: 1 }),
    lot('Drill new', { ...cond(1, 'New'), current_price: 40, groupId: 1 }),
    lot('Drill new cheap', { ...cond(1, 'New'), current_price: 35, groupId: 1 }),
  ];
  const [card] = run(items).rows;
  assert.equal(card.lot.title, 'Drill new cheap', 'New first, cheapest within it');
  assert.deepEqual(
    card.others.map(r => r.lot.title),
    ['Drill new', 'Drill like new', 'Drill used', 'Drill as-is'],
  );
  assert.equal(card.cheaper.lot.title, 'Drill as-is', 'the cheapest worse-condition listing');

  const [alone] = run([
    lot('Saw new', { ...cond(1, 'New'), current_price: 10, groupId: 7 }),
    lot('Saw used', { ...cond(3, 'Used'), current_price: 15, groupId: 7 }),
  ]).rows;
  assert.equal(alone.lot.title, 'Saw new');
  assert.equal(alone.cheaper, null, 'no note when the worse condition costs more');
});
