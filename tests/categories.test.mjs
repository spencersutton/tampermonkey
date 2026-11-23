import assert from 'node:assert/strict';
import { after, test } from 'node:test';

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
const { saveCustomCategories } = await vite.ssrLoadModule('/src/app/server/categories.ts');
const { applySetting, getSetting, setSaveHook } = await vite.ssrLoadModule(
  '/src/app/server/settings.ts',
);
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { DEFAULT_VIEW, computeFacets, suggestName } =
  await vite.ssrLoadModule('/src/app/logic/view.ts');
const { groupCategories } = await vite.ssrLoadModule('/src/app/logic/categories.ts');
const { chipsFor } = await vite.ssrLoadModule('/src/app/logic/refinements.ts');

function setup(categories, selected) {
  storage.clear();
  applySetting(KEYS.customCategories, categories);
  applySetting(KEYS.view, { ...DEFAULT_VIEW, categories: selected, search: 'drill' });
  applySetting(KEYS.savedSearches, [
    {
      id: 'one',
      name: 'Search',
      view: { ...DEFAULT_VIEW, categories: selected },
      lastViewedAt: 123,
    },
    {
      id: 'old',
      name: 'Old search',
      view: { search: 'old' },
      lastViewedAt: 456,
    },
  ]);
  const saves = [];
  setSaveHook((key, value) => saves.push([key, value]));
  return saves;
}

test('renames and deletions update current and saved filters without changing other fields', () => {
  const saves = setup(
    [{ name: 'Drills' }, { name: 'Saws' }, { name: 'Tools' }],
    ['custom:Drills', 'custom:Saws', 'tools', 'custom:Tools'],
  );
  const next = [{ name: 'Power Drills' }, { name: 'Tools' }];
  saveCustomCategories(next, new Map([['Drills', 'Power Drills']]));

  assert.deepEqual(getSetting(KEYS.customCategories), next);
  assert.deepEqual(getSetting(KEYS.view).categories, [
    'custom:Power Drills',
    'tools',
    'custom:Tools',
  ]);
  assert.equal(getSetting(KEYS.view).search, 'drill');
  const searches = getSetting(KEYS.savedSearches);
  assert.deepEqual(searches[0].view.categories, ['custom:Power Drills', 'tools', 'custom:Tools']);
  assert.equal(searches[0].lastViewedAt, 123);
  assert.deepEqual(searches[1].view.categories, []);
  assert.deepEqual(
    saves.map(([key]) => key),
    [KEYS.customCategories, KEYS.view, KEYS.savedSearches],
  );
  assert.equal(storage.has(`tlx:${KEYS.savedSearches}`), false);
});

test('removes filters when moving item types leaves a category empty', () => {
  setup(
    [
      { name: 'Old', types: ['drill'] },
      { name: 'Target', types: ['saw'] },
    ],
    ['custom:Old', 'custom:Target'],
  );
  saveCustomCategories([{ name: 'Target', types: ['saw', 'drill'] }]);
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:Target']);
  assert.deepEqual(getSetting(KEYS.savedSearches)[0].view.categories, ['custom:Target']);
});

test('applies renames simultaneously and respects a deleted category recreated with the same name', () => {
  setup([{ name: 'A' }, { name: 'B' }, { name: 'C' }], ['custom:A', 'custom:B', 'custom:C']);
  saveCustomCategories(
    [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    new Map([
      ['A', 'B'],
      ['B', 'A'],
      ['C', null],
    ]),
  );
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:B', 'custom:A']);
  assert.deepEqual(getSetting(KEYS.savedSearches)[0].view.categories, ['custom:B', 'custom:A']);
});

test('does not rewrite filters when categories are only added, changed, or reordered', () => {
  const saves = setup([{ name: 'A', types: ['drill'] }, { name: 'B' }], ['custom:A', 'tools']);
  saveCustomCategories(
    [{ name: 'B' }, { name: 'A', types: ['saw'] }, { name: 'C' }],
    new Map([
      ['A', 'A'],
      ['B', 'B'],
    ]),
  );
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:A', 'tools']);
  assert.deepEqual(
    saves.map(([key]) => key),
    [KEYS.customCategories],
  );
});

test('a later rename uses the categories saved by the previous apply', () => {
  setup([{ name: 'A' }], ['custom:A']);
  saveCustomCategories([{ name: 'B' }], new Map([['A', 'B']]));
  saveCustomCategories([{ name: 'C' }], new Map([['B', 'C']]));
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:C']);
  assert.deepEqual(getSetting(KEYS.savedSearches)[0].view.categories, ['custom:C']);
});

test('category edits do not create a saved view in a new browser', () => {
  setup([{ name: 'Drills' }], []);
  applySetting(KEYS.view, null);
  saveCustomCategories([{ name: 'Power Drills' }], new Map([['Drills', 'Power Drills']]));

  assert.equal(getSetting(KEYS.view), null);
});

const facet = (label, count = 0, value = `custom:${label}`) => ({ value, label, count });
const facetsFor = (categories, siteCategories = []) => ({
  categories,
  siteCategories,
  conditions: [],
  locations: [],
  types: [],
  brands: [],
  attrs: [],
  prices: [],
});

test('third-tier categories nest under the longest existing name and sort each tier A-Z', () => {
  const groups = groupCategories(
    facetsFor(
      [
        facet('Tools - Drills - Cordless', 3),
        facet('Tools - Saws', 2),
        facet('Tools - Drills', 1),
        facet('Tools - Drills - Corded', 4),
        facet('Tools & Hardware - Bits', 5),
      ],
      [facet('Tools', 10, 'tools'), facet('Tools & Hardware', 5, 'hardware')],
    ),
  );
  assert.deepEqual(groups, [
    {
      facet: facet('Tools', 0, 'tools'),
      subs: [
        {
          facet: facet('Drills', 1, 'custom:Tools - Drills'),
          subs: [
            { facet: facet('Corded', 4, 'custom:Tools - Drills - Corded'), subs: [] },
            { facet: facet('Cordless', 3, 'custom:Tools - Drills - Cordless'), subs: [] },
          ],
        },
        { facet: facet('Saws', 2, 'custom:Tools - Saws'), subs: [] },
      ],
    },
    {
      facet: facet('Tools & Hardware', 0, 'hardware'),
      subs: [{ facet: facet('Bits', 5, 'custom:Tools & Hardware - Bits'), subs: [] }],
    },
  ]);
});

test('custom roots can head children, while a missing parent keeps the remaining name intact', () => {
  const groups = groupCategories(
    facetsFor(
      [
        facet('Favorites - Workshop', 1),
        facet('Favorites', 2),
        facet('Tools - Drills - Cordless', 3),
        facet('Tools - Drill Bits', 4),
        facet('Tools - DrillsExtra', 5),
      ],
      [facet('Tools', 12, 'tools')],
    ),
  );
  assert.equal(groups[0].facet.label, 'Favorites');
  assert.equal(groups[0].subs[0].facet.label, 'Workshop');
  assert.deepEqual(
    groups[1].subs.map(g => g.facet.label),
    ['Drill Bits', 'Drills - Cordless', 'DrillsExtra'],
  );
});

test('facets retain empty custom ancestors but not unrelated empty categories or closed lots', () => {
  const cats = [
    { name: 'Tools - Drills', types: ['drill'] },
    { name: 'Tools - Drills - Cordless', types: ['cordless drill'] },
    { name: 'Unused', types: ['saw'] },
    { name: 'Tools - Drills - Corded', types: ['corded drill'] },
  ];
  const lot = (itemType, endsAt = 2) => ({
    itemType,
    ends_at: new Date(endsAt).toISOString(),
    category: { value: 'tools', label: 'Tools' },
    condition: { value: 1, display_name: 'New' },
    location: { id: 1, name: 'Raleigh' },
  });
  const facets = computeFacets([lot('cordless drill'), lot('corded drill', 0)], 1, cats);
  assert.deepEqual(facets.categories, [
    facet('Tools - Drills'),
    facet('Tools - Drills - Cordless', 1),
  ]);
  const groups = groupCategories(facets);
  assert.equal(groups[0].facet.count, 0);
  assert.equal(groups[0].subs[0].facet.label, 'Drills');
  assert.equal(groups[0].subs[0].subs[0].facet.label, 'Cordless');
});

test('chips and saved-search names collapse a full parent branch to the parent label', () => {
  const facets = facetsFor(
    [facet('Tools', 2, 'tools'), facet('Tools - Drills', 1), facet('Tools - Drills - Cordless', 3)],
    [facet('Tools', 6, 'tools')],
  );
  const fullBranch = {
    ...DEFAULT_VIEW,
    categories: ['tools', 'custom:Tools - Drills', 'custom:Tools - Drills - Cordless'],
  };
  assert.deepEqual(
    chipsFor(fullBranch, facets, 'Raleigh').map(c => c.label),
    ['Tools'],
  );
  assert.equal(suggestName(fullBranch, facets), 'Tools');

  const ownOnly = { ...DEFAULT_VIEW, categories: ['tools'] };
  assert.deepEqual(
    chipsFor(ownOnly, facets, 'Raleigh').map(c => c.label),
    ['Tools (other)'],
  );
});
