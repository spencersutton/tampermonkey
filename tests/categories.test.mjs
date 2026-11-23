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
const { groupCategories, migrateLegacyCategories } = await vite.ssrLoadModule(
  '/src/app/logic/categories.ts',
);
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

const facet = (label, count = 0, value = `custom:${label}`, parent = undefined) => ({
  value,
  label,
  count,
  ...(parent ? { parent } : {}),
});
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

test('multi-tier categories nest under their explicit parent and sort each tier A-Z', () => {
  const groups = groupCategories(
    facetsFor(
      [
        facet('Cordless', 3, 'custom:cordless', 'custom:drills'),
        facet('Saws', 2, 'custom:saws', 'tools'),
        facet('Drills', 1, 'custom:drills', 'tools'),
        facet('Corded', 4, 'custom:corded', 'custom:drills'),
        facet('Bits', 5, 'custom:bits', 'hardware'),
      ],
      [facet('Tools', 10, 'tools'), facet('Tools & Hardware', 5, 'hardware')],
    ),
  );
  assert.deepEqual(groups, [
    {
      facet: facet('Tools', 0, 'tools'),
      subs: [
        {
          facet: facet('Drills', 1, 'custom:drills', 'tools'),
          subs: [
            { facet: facet('Corded', 4, 'custom:corded', 'custom:drills'), subs: [] },
            { facet: facet('Cordless', 3, 'custom:cordless', 'custom:drills'), subs: [] },
          ],
        },
        { facet: facet('Saws', 2, 'custom:saws', 'tools'), subs: [] },
      ],
    },
    {
      facet: facet('Tools & Hardware', 0, 'hardware'),
      subs: [{ facet: facet('Bits', 5, 'custom:bits', 'hardware'), subs: [] }],
    },
  ]);
});

test('custom roots can head children, names with dashes stay intact, and missing/cyclic parents fall back to top level', () => {
  const groups = groupCategories(
    facetsFor(
      [
        facet('Workshop', 1, 'custom:workshop', 'custom:favs'),
        facet('Favorites', 2, 'custom:favs'),
        facet('All-in-One - Kit', 3, 'custom:kit', 'tools'),
        facet('Orphan', 4, 'custom:orphan', 'custom:missing'),
        facet('CycleA', 1, 'custom:a', 'custom:b'),
        facet('CycleB', 1, 'custom:b', 'custom:a'),
      ],
      [facet('Tools', 12, 'tools')],
    ),
  );
  const byLabel = Object.fromEntries(groups.map(g => [g.facet.label, g]));
  assert.equal(byLabel.Favorites.subs[0].facet.label, 'Workshop');
  assert.deepEqual(
    byLabel.Tools.subs.map(g => g.facet.label),
    ['All-in-One - Kit'],
  );
  assert.ok(byLabel.Orphan);
  assert.ok(byLabel.CycleA || byLabel.CycleB);
});

test('facets retain empty custom ancestors via parent links but not unrelated empty categories or closed lots', () => {
  const cats = [
    { id: 'drills', name: 'Drills', parent: 'tools', types: ['drill'] },
    { id: 'cordless', name: 'Cordless', parent: 'custom:drills', types: ['cordless drill'] },
    { id: 'unused', name: 'Unused', types: ['saw'] },
    { id: 'corded', name: 'Corded', parent: 'custom:drills', types: ['corded drill'] },
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
    facet('Cordless', 1, 'custom:cordless', 'custom:drills'),
    facet('Drills', 0, 'custom:drills', 'tools'),
  ]);
  const groups = groupCategories(facets);
  assert.equal(groups[0].facet.count, 0);
  assert.equal(groups[0].subs[0].facet.label, 'Drills');
  assert.equal(groups[0].subs[0].subs[0].facet.label, 'Cordless');
});

test('chips and saved-search names collapse a full parent branch and format subcategory paths', () => {
  const facets = facetsFor(
    [
      facet('Tools', 2, 'tools'),
      facet('Drills', 1, 'custom:drills', 'tools'),
      facet('Cordless', 3, 'custom:cordless', 'custom:drills'),
    ],
    [facet('Tools', 6, 'tools')],
  );
  const fullBranch = {
    ...DEFAULT_VIEW,
    categories: ['tools', 'custom:drills', 'custom:cordless'],
  };
  assert.deepEqual(
    chipsFor(fullBranch, facets, 'Raleigh').map(c => c.label),
    ['Tools'],
  );
  assert.equal(suggestName(fullBranch, facets), 'Tools');

  const leafOnly = { ...DEFAULT_VIEW, categories: ['custom:cordless'] };
  assert.deepEqual(
    chipsFor(leafOnly, facets, 'Raleigh').map(c => c.label),
    ['Tools › Drills › Cordless'],
  );
  assert.equal(suggestName(leafOnly, facets), 'Tools › Drills › Cordless');

  const ownOnly = { ...DEFAULT_VIEW, categories: ['tools'] };
  assert.deepEqual(
    chipsFor(ownOnly, facets, 'Raleigh').map(c => c.label),
    ['Tools (other)'],
  );
});

test('migrateLegacyCategories converts dash-nested categories while preserving filter values', () => {
  const legacy = [
    { name: 'Tools - Drills', types: ['drill'] },
    { name: 'Tools - Drills - Cordless', types: ['cordless drill'] },
    { name: 'Workshop', types: ['bench'] },
  ];
  const site = [{ value: 'tools', label: 'Tools' }];
  const migrated = migrateLegacyCategories(legacy, site);
  assert.deepEqual(migrated, [
    { id: 'Tools - Drills', name: 'Drills', parent: 'tools', types: ['drill'] },
    {
      id: 'Tools - Drills - Cordless',
      name: 'Cordless',
      parent: 'custom:Tools - Drills',
      types: ['cordless drill'],
    },
    { id: 'Workshop', name: 'Workshop', types: ['bench'] },
  ]);
  // Running again is a no-op because categories now have explicit ids.
  assert.equal(migrateLegacyCategories(migrated, site), null);
});
