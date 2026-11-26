import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

import { Component, options } from 'preact';

import { createTestServer } from './vite.mjs';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const vite = await createTestServer();
after(() => vite.close());
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { applySetting, getSetting } = await vite.ssrLoadModule('/src/app/server/settings.ts');
const { lots } = await vite.ssrLoadModule('/src/app/server/catalog.ts');
const {
  hideCategory,
  hideItemType,
  storedView,
  page,
  rowOf,
  exclusionRules,
  unhideAllCategories,
  unhideCategory,
} = await vite.ssrLoadModule('/src/app/ui/state.ts');
const { DEFAULT_VIEW, computeFacets, computeView, activeFilterCount, savedSearchStats } =
  await vite.ssrLoadModule('/src/app/logic/view.ts');
const { suggest } = await vite.ssrLoadModule('/src/app/logic/suggest.ts');
const { navFromUrl } = await vite.ssrLoadModule('/src/app/ui/history.ts');
const { LotCard } = await vite.ssrLoadModule('/src/app/ui/LotCard.tsx');

const now = Date.now();
const fixture = (id, value, label, itemType) => ({
  id,
  title: `Fixture ${id}`,
  lot_number: `${id}`,
  auction_period: 'test',
  category: { value, label },
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
const fixtures = [
  fixture(1, 'tools', 'Tools', 'hammer'),
  fixture(2, 'tools', 'Tools', 'drill'),
  fixture(3, 'garden', 'Garden', 'rake'),
];

beforeEach(() => {
  storage.clear();
  applySetting(KEYS.view, DEFAULT_VIEW);
  applySetting(KEYS.hidden, {});
  applySetting(KEYS.customCategories, []);
  applySetting(KEYS.hiddenCategories, []);
  applySetting(KEYS.filterTypes, []);
  applySetting(KEYS.words, []);
  applySetting(KEYS.filterOn, true);
  applySetting(KEYS.removeFiltered, false);
  lots.value = new Map(fixtures.map(lot => [lot.id, lot]));
});

const visibleIds = () =>
  computeView(
    lots.peek().values(),
    storedView.value,
    'Raleigh',
    exclusionRules.value,
    now,
  ).rows.map(r => r.lot.id);

function nodes(node) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

function renderCard(lot) {
  const vnode = LotCard.call({}, { row: rowOf(lot) });
  vnode.__c = new Component(vnode.props);
  options.__r(vnode);
  const tree = vnode.type(vnode.props);
  options.diffed(vnode);
  return tree;
}

test('clicking a card category selects only its assigned category and preserves other filters', () => {
  applySetting(KEYS.customCategories, [{ name: 'Tools - Drills', types: ['drill'] }]);
  for (const [lot, category, expected] of [
    [fixtures[0], 'tools', [1]],
    [fixtures[1], 'custom:Tools - Drills', [2]],
    [fixtures[2], 'garden', [3]],
  ]) {
    const view = { ...DEFAULT_VIEW, search: 'Fixture', sort: 'total-desc', priceMax: 20 };
    applySetting(KEYS.view, { ...view, categories: ['garden'] });
    page.value = 4;
    const button = nodes(renderCard(lot)).find(n => n.props?.class === 'btn-text category-only');
    assert.equal(button.type, 'button');
    assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-label'], `Show only ${rowOf(lot).category.label}`);
    button.props.onClick();
    assert.deepEqual(storedView.value, { ...view, categories: [category] });
    assert.equal(page.value, 1);
    assert.deepEqual(visibleIds(), expected);
    assert.deepEqual(JSON.parse(storage.get(`tlx:${KEYS.view}`)), storedView.value);
  }
});

test('the card hide item type button adds to global filterTypes by default and uses temporary view exclusion with a modifier key', async () => {
  const { ItemTypeActions } = await vite.ssrLoadModule('/src/app/ui/ItemType.tsx');
  const itemTree = ItemTypeActions({ lot: fixtures[1] });
  const hideBtn = nodes(itemTree).find(n => n.props?.class === 'icon-btn item-type-hide');
  assert.ok(hideBtn);
  assert.equal(hideBtn.props['aria-label'], 'Hide item type: drill');
  assert.match(hideBtn.props.title, /^Hide item type: drill/);

  // Plain click adds to global permanent filterTypes (not view.excludedTypes).
  page.value = 3;
  hideBtn.props.onClick();
  assert.deepEqual(getSetting(KEYS.filterTypes), ['drill']);
  assert.deepEqual(storedView.value.excludedTypes, []);
  assert.equal(page.value, 3, 'keeps loaded cards so the grid does not jump');
  assert.equal(activeFilterCount(storedView.value), 0);

  // Adding the same type again (case-insensitive) is idempotent.
  hideItemType('DRILL');
  assert.deepEqual(getSetting(KEYS.filterTypes), ['drill']);

  // Modifier-key click adds to temporary search-scope excludedTypes instead of filterTypes.
  applySetting(KEYS.filterTypes, []);
  for (const mod of [{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    applySetting(KEYS.view, DEFAULT_VIEW);
    hideBtn.props.onClick(mod);
    assert.deepEqual(storedView.value.excludedTypes, ['drill']);
    assert.deepEqual(getSetting(KEYS.filterTypes), []);
    assert.equal(activeFilterCount(storedView.value), 1);
  }

  // Temporary hide is idempotent; URLs round-trip excludeType.
  hideItemType('DRILL', null, true);
  assert.deepEqual(storedView.value.excludedTypes, ['drill']);
  assert.deepEqual(navFromUrl('?excludeType=drill&excludeType=hammer').view.excludedTypes, [
    'drill',
    'hammer',
  ]);
});

test('regex filters match only lot titles, not item types', () => {
  applySetting(KEYS.words, ['drill']);
  applySetting(KEYS.filterOn, true);
  applySetting(KEYS.removeFiltered, true);
  // fixture(2) has title "Fixture 2" and itemType "drill" — regex filter must not match its itemType.
  assert.deepEqual(visibleIds(), [1, 2, 3]);
  applySetting(KEYS.words, ['Fixture 2']);
  assert.deepEqual(visibleIds(), [1, 3]);
  applySetting(KEYS.words, []);
});
test('random sort stays stable across recomputations and lot updates', () => {
  const many = Array.from({ length: 20 }, (_, i) => fixture(i + 1, 'tools', 'Tools', 'hammer'));
  const view = { ...DEFAULT_VIEW, sort: 'random' };
  const order = () =>
    computeView(many, view, 'Raleigh', exclusionRules.value, now).rows.map(r => r.lot.id);

  const first = order();
  assert.deepEqual(order(), first);
  many[0] = { ...many[0], current_price: 99 };
  assert.deepEqual(order(), first);
});

test('hiding a top-level category excludes its lots and subcategories from All categories, while allowing direct inspection', () => {
  const catalog = [
    fixture(1, 'tools', 'Tools', 'hammer'),
    fixture(2, 'baby', 'Baby & Kids', 'stroller'),
    fixture(3, 'baby', 'Baby & Kids', 'crib'),
    fixture(4, 'pets', 'Pets', 'dog food'),
    { ...fixture(5, 'pets', 'Pets', 'leash'), your_standing: { is_leading: true, max_bid: 15 } },
  ];
  applySetting(KEYS.customCategories, [
    { id: 'strollers', name: 'Strollers', parent: 'baby', types: ['stroller'] },
    { id: 'topcustom', name: 'Top Custom', types: ['dog food'] },
  ]);
  lots.value = new Map(catalog.map(l => [l.id, l]));

  // Hide "baby": excludes both direct site lots (crib) and custom subcategories (stroller),
  // while keeping accurate category counts so the sidebar still shows how many lots are in it.
  hideCategory('baby', ['baby', 'custom:strollers']);
  assert.deepEqual(getSetting(KEYS.hiddenCategories), ['baby']);
  const allResult = computeView(catalog, storedView.value, 'Raleigh', exclusionRules.value, now);
  assert.deepEqual(
    allResult.rows.map(r => r.lot.id),
    [1, 4, 5],
  );
  assert.equal(allResult.facetCounts.category.get('baby'), 1);
  assert.equal(allResult.facetCounts.category.get('custom:strollers'), 1);
  assert.equal(allResult.facetCounts.type.get('stroller'), undefined);
  assert.equal(allResult.facetCounts.type.get('crib'), undefined);

  // Clicking the hidden category (or its subcategory) shows its lots to check for miscategorized items.
  const inspectBaby = computeView(
    catalog,
    { ...DEFAULT_VIEW, categories: ['baby', 'custom:strollers'] },
    'Raleigh',
    exclusionRules.value,
    now,
  );
  assert.deepEqual(
    inspectBaby.rows.map(r => r.lot.id),
    [2, 3],
  );

  // Hiding a top-level custom category hides its lots; hiding while selected clears that selection.
  applySetting(KEYS.view, { ...DEFAULT_VIEW, categories: ['custom:topcustom'] });
  hideCategory('custom:topcustom', ['custom:topcustom']);
  assert.deepEqual(storedView.value.categories, []);
  assert.deepEqual(visibleIds(), [1, 5]);

  // "My lots" still shows lots in hidden categories.
  hideCategory('pets', ['pets']);
  const mineResult = computeView(
    catalog,
    { ...DEFAULT_VIEW, mine: 'leading' },
    'Raleigh',
    exclusionRules.value,
    now,
  );
  assert.deepEqual(
    mineResult.rows.map(r => r.lot.id),
    [5],
  );

  // Saved searches skip hidden categories unless explicitly selected.
  const stats = savedSearchStats(
    catalog,
    [
      { id: 'all', name: 'All', view: DEFAULT_VIEW, lastViewedAt: 0 },
      {
        id: 'baby',
        name: 'Baby',
        view: { ...DEFAULT_VIEW, categories: ['baby'] },
        lastViewedAt: 0,
      },
    ],
    'Raleigh',
    exclusionRules.value,
    now,
  );
  assert.equal(stats.get('all').total, 1);
  assert.equal(stats.get('baby').total, 1);

  // Search typeahead skips lots in hidden categories.
  const facets = computeFacets(catalog, now, getSetting(KEYS.customCategories));
  const sug = suggest(
    'Fixture',
    facets,
    catalog,
    now,
    {},
    undefined,
    false,
    getSetting(KEYS.hiddenCategories),
    getSetting(KEYS.customCategories),
  );
  assert.deepEqual(
    sug.lots.map(l => l.id),
    [1],
  );

  // Unhide single and unhide all.
  unhideCategory('pets');
  assert.deepEqual(getSetting(KEYS.hiddenCategories), ['baby', 'custom:topcustom']);
  unhideAllCategories();
  assert.deepEqual(getSetting(KEYS.hiddenCategories), []);
});
