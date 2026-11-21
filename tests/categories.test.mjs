import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());

const { categorizeLot, groupCategories, groupValues, isCustomCategory } = await vite.ssrLoadModule(
  '/src/app/logic/categories.ts',
);
const { chipsFor } = await vite.ssrLoadModule('/src/app/logic/refinements.ts');
const { DEFAULT_VIEW, computeFacets, computeView, suggestName } =
  await vite.ssrLoadModule('/src/app/logic/view.ts');

const now = Date.now();
let nextId = 1;
const makeLot = (itemType, siteValue = 'home', siteLabel = 'Home') => ({
  id: nextId++,
  title: itemType ?? 'Mystery lot',
  lot_number: `${nextId}`,
  auction_period: 'test',
  category: { value: siteValue, label: siteLabel },
  condition: { value: 1, display_name: 'New' },
  location: { id: 1, name: 'Raleigh' },
  itemType,
  ends_at: new Date(now + 2 * 3_600_000).toISOString(),
  current_price: 10,
  estimated_retail_price: 0,
  transfer_fee: 0,
  is_transferable: false,
  images: [],
  bid_count: 0,
});

test('categorizeLot maps item types to logical custom categories and resolves ordering edge cases', () => {
  const cases = [
    ['cordless drill', 'tools', 'tools/power-tools'],
    ['drill bit set', 'tools', 'tools/accessories'],
    ['torque wrench', 'tools', 'tools/hand-measuring'],
    ['tool box', 'tools', 'tools/shop-storage'],
    ['bathroom exhaust fan', 'plumbing-bath', 'hvac/ventilation'],
    ['ceiling fan', 'lighting-electrical', 'hvac/heating-cooling'],
    ['garden hose', 'garden', 'outdoor/lawn-garden'],
    ['air hose', 'tools', 'tools/shop-storage'],
    ['doormat', 'home', 'home/rugs-mats'],
    ['floor mat', 'automotive', 'automotive/interior-tech'],
    ['floor mat', 'home', 'home/rugs-mats'],
    ['battery', 'tools', 'tools/batteries-chargers'],
    ['phone case', 'electronics-appliances', 'electronics/phones-wearables'],
    ['flat iron', 'health-beauty', 'health/personal-care'],
    ['steam iron', 'home', 'appliances/laundry'],
    ['christmas tree', 'home', 'seasonal/holiday-decor'],
    ['dog bed', 'home', 'pets/supplies'],
    ['stroller', 'home', 'baby-kids/gear'],
    ['mattresses', 'home', 'home/bedding-linens'],
    ['storage boxes', 'home', 'home/storage-organization'],
    ['espresso machine', 'electronics-appliances', 'appliances/kitchen'],
    ['patio umbrella', 'garden', 'outdoor/patio-grills-pools'],
  ];

  for (const [itemType, site, expected] of cases) {
    const got = categorizeLot({ itemType, category: { value: site, label: site } });
    assert.equal(
      got.value,
      expected,
      `expected ${itemType} (${site}) -> ${expected}, got ${got.value}`,
    );
    assert.equal(isCustomCategory(got.value), true);
  }
});

test('categorizeLot falls back to the site category for missing or unmapped item types', () => {
  const fallback = { value: 'miscellaneous', label: 'Miscellaneous' };
  assert.deepEqual(categorizeLot({ itemType: null, category: fallback }), fallback);
  assert.deepEqual(categorizeLot({ itemType: '   ', category: fallback }), fallback);
  assert.deepEqual(categorizeLot({ itemType: 'flux capacitor', category: fallback }), fallback);
  assert.equal(isCustomCategory('miscellaneous'), false);
});

test('groupCategories nests subcategories under parents and keeps single-sub and fallback categories top-level', () => {
  const lots = [
    makeLot('cordless drill', 'tools', 'Tools'),
    makeLot('impact driver', 'tools', 'Tools'),
    makeLot('hammer', 'tools', 'Tools'),
    makeLot('dog bed', 'home', 'Home'),
    makeLot('flux capacitor', 'miscellaneous', 'Miscellaneous'),
  ];
  const facets = computeFacets(lots, now);
  const groups = groupCategories(facets.categories);

  const tools = groups.find(g => g.id === 'Tools');
  assert.ok(tools);
  assert.equal(tools.count, 3);
  assert.deepEqual(
    tools.subs.map(s => [s.value, s.count]),
    [
      ['tools/hand-measuring', 1],
      ['tools/power-tools', 2],
    ],
  );
  assert.deepEqual(groupValues(tools), ['tools/hand-measuring', 'tools/power-tools']);

  const pets = groups.find(g => g.id === 'pets/supplies');
  assert.ok(pets);
  assert.equal(pets.subs.length, 0);
  assert.equal(pets.count, 1);
  assert.deepEqual(groupValues(pets), ['pets/supplies']);

  const misc = groups.find(g => g.id === 'miscellaneous');
  assert.ok(misc);
  assert.equal(misc.subs.length, 0);
  assert.equal(misc.count, 1);
});

test('refinements and suggestName collapse a parent category when all its subcategories are selected', () => {
  const lots = [
    makeLot('cordless drill', 'tools', 'Tools'),
    makeLot('hammer', 'tools', 'Tools'),
    makeLot('espresso machine', 'electronics-appliances', 'Electronics'),
  ];
  const facets = computeFacets(lots, now);

  // Selecting all Tools subcategories produces one parent chip.
  const allToolsView = {
    ...DEFAULT_VIEW,
    categories: ['tools/power-tools', 'tools/hand-measuring'],
  };
  const allChips = chipsFor(allToolsView, facets, 'Raleigh');
  assert.equal(allChips.length, 1);
  assert.equal(allChips[0].label, 'Tools');
  assert.deepEqual(allChips[0].remove, { categories: [] });
  assert.equal(suggestName(allToolsView, facets), 'Tools');

  // Selecting only one subcategory produces the subcategory chip.
  const oneToolView = { ...DEFAULT_VIEW, categories: ['tools/power-tools'] };
  const oneChips = chipsFor(oneToolView, facets, 'Raleigh');
  assert.equal(oneChips.length, 1);
  assert.equal(oneChips[0].label, 'Power Tools');
  assert.deepEqual(oneChips[0].remove, { categories: [] });

  // Filtering by custom category filters the computed view.
  const res = computeView(lots, oneToolView, 'Raleigh', { filterOn: false, words: [] }, now);
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].category.value, 'tools/power-tools');
});
