import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

import 'temporal-polyfill/global';
import { Component, options } from 'preact';
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
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { applySetting, getSetting } = await vite.ssrLoadModule('/src/app/server/settings.ts');
const { lots } = await vite.ssrLoadModule('/src/app/server/catalog.ts');
const { hideCategory, hideItemType, storedView, setView, page, rowOf, exclusionRules } =
  await vite.ssrLoadModule('/src/app/ui/state.ts');
const {
  DEFAULT_VIEW,
  normalizeView,
  computeView,
  activeFilterCount,
  savedFilters,
  savedSearchStats,
  initialView,
  sameDefaultFilters,
} = await vite.ssrLoadModule('/src/app/logic/view.ts');
const { navFromUrl, startHistory } = await vite.ssrLoadModule('/src/app/ui/history.ts');
const { LotCard } = await vite.ssrLoadModule('/src/app/ui/LotCard.tsx');

const now = Date.now();
const custom = 'custom:Tools - Drills';
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
  applySetting(KEYS.defaultFilters, { categories: [], conditions: [] });
  applySetting(KEYS.customCategories, [{ name: 'Tools - Drills', types: ['drill'] }]);
  applySetting(KEYS.hidden, {});
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

test('hiding from an unfiltered view selects all other assigned categories', () => {
  hideCategory(custom);
  assert.deepEqual(new Set(storedView.value.categories), new Set(['tools', 'garden']));
  assert.equal(storedView.value.noCategories, false);
  assert.deepEqual(visibleIds(), [1, 3]);
  assert.deepEqual(getSetting(KEYS.hidden), {});
});

test('hiding a selected category preserves other filters and its descendants', () => {
  const view = {
    ...DEFAULT_VIEW,
    categories: ['tools', custom, 'garden'],
    search: 'Fixture',
    sort: 'total-desc',
    priceMax: 20,
    mine: 'watch',
  };
  applySetting(KEYS.view, view);
  page.value = 4;
  hideCategory('tools');
  assert.deepEqual(storedView.value, { ...view, categories: [custom, 'garden'] });
  assert.equal(page.value, 4, 'keeps the loaded cards so the grid does not jump');
  assert.deepEqual(JSON.parse(storage.get(`tlx:${KEYS.view}`)), storedView.value);
});

test('hiding the final selection matches nothing and survives storage, searches and defaults', () => {
  setView({ categories: [custom] });
  hideCategory(custom);
  assert.deepEqual(storedView.value.categories, []);
  assert.equal(storedView.value.noCategories, true);
  assert.deepEqual(visibleIds(), []);
  assert.equal(activeFilterCount(storedView.value), 1);
  const restored = normalizeView(JSON.parse(storage.get(`tlx:${KEYS.view}`)));
  assert.equal(restored.noCategories, true);
  const stats = savedSearchStats(
    fixtures,
    [{ id: 'empty', view: savedFilters(restored), lastViewedAt: now }],
    'Raleigh',
    exclusionRules.value,
    now,
  );
  assert.deepEqual(stats.get('empty'), { total: 0, fresh: 0 });
  const defaults = { categories: [], conditions: [], noCategories: true };
  assert.equal(initialView(null, defaults).noCategories, true);
  assert.equal(sameDefaultFilters(restored, defaults), true);
  assert.equal(sameDefaultFilters(restored, { categories: [], conditions: [] }), false);
});

test('hiding the only catalog category also matches nothing', () => {
  lots.value = new Map([[1, fixtures[0]]]);
  hideCategory('tools');
  assert.equal(storedView.value.noCategories, true);
  assert.deepEqual(visibleIds(), []);
});

test('repeated hide actions stay hidden; selecting a category or clearing recovers', () => {
  setView({ categories: [custom] });
  hideCategory(custom);
  hideCategory(custom);
  assert.deepEqual(visibleIds(), []);
  setView({ categories: ['garden'], noCategories: false });
  assert.deepEqual(visibleIds(), [3]);
  setView(DEFAULT_VIEW);
  assert.deepEqual(visibleIds(), [1, 2, 3]);
  assert.equal(normalizeView({ categories: [] }).noCategories, false);
  assert.equal(normalizeView({ categories: ['tools'], noCategories: true }).noCategories, false);
});

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

test('the card exposes a labeled category hide button targeting its assigned custom category', () => {
  const tree = renderCard(fixtures[1]);
  const button = nodes(tree).find(n => n.props?.class === 'icon-btn category-hide');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-label'], 'Hide category: Tools - Drills');
  assert.equal(button.props.title, button.props['aria-label']);
  button.props.onClick();
  assert.deepEqual(visibleIds(), [1, 3]);
});

test('clicking a card category selects only its assigned category and preserves other filters', () => {
  for (const [lot, category, expected] of [
    [fixtures[0], 'tools', [1]],
    [fixtures[1], custom, [2]],
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
    hideCategory(category);
    assert.equal(storedView.value.noCategories, true);
    button.props.onClick();
    assert.equal(storedView.value.noCategories, false);
    assert.deepEqual(visibleIds(), expected);
  }
});

test('explicit empty categories round-trip through URLs and browser history', () => {
  const entries = [];
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
  globalThis.window = { addEventListener() {} };
  startHistory();
  setView({ categories: [custom] });
  hideCategory(custom);
  const entry = entries.at(-1);
  assert.equal(entry.state.view.noCategories, true);
  assert.equal(entry.url, '/tlx?noCategories=1');
  assert.deepEqual(navFromUrl('?noCategories=1').view, storedView.value);
  assert.equal(navFromUrl('?noCategories=0').view.noCategories, false);
  assert.equal(navFromUrl('?category=tools').view.noCategories, false);
});

test('the card exposes a hide item type button, preserves page/filters, and round-trips through URLs', async () => {
  const { ItemTypeActions } = await vite.ssrLoadModule('/src/app/ui/ItemType.tsx');
  const itemTree = ItemTypeActions({ lot: fixtures[1] });
  const hideBtn = nodes(itemTree).find(n => n.props?.class === 'icon-btn item-type-hide');
  assert.ok(hideBtn);
  assert.equal(hideBtn.props['aria-label'], 'Hide item type: drill');
  assert.equal(hideBtn.props.title, 'Hide item type: drill');
  page.value = 3;
  hideBtn.props.onClick();
  assert.deepEqual(storedView.value.excludedTypes, ['drill']);
  assert.equal(page.value, 3, 'keeps loaded cards so the grid does not jump');
  assert.deepEqual(visibleIds(), [1, 3]);
  assert.equal(activeFilterCount(storedView.value), 1);

  // Hiding an already-excluded item type is idempotent; URLs round-trip excludeType.
  hideItemType('DRILL');
  assert.deepEqual(storedView.value.excludedTypes, ['drill']);
  assert.deepEqual(navFromUrl('?excludeType=drill&excludeType=hammer').view.excludedTypes, [
    'drill',
    'hammer',
  ]);
  const defaults = { categories: [], conditions: [], excludedTypes: ['drill'] };
  assert.equal(sameDefaultFilters(storedView.value, defaults), true);
  assert.deepEqual(initialView(null, defaults).excludedTypes, ['drill']);
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
