import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { saveCustomCategories } = await vite.ssrLoadModule('/src/app/categories.ts');
const { applySetting, getSetting, setSaveHook } = await vite.ssrLoadModule('/src/app/settings.ts');
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { DEFAULT_VIEW, categoryIndex, compileCategories } = await vite.ssrLoadModule('/src/app/view.ts');
const { clean, rowError, toDraft } = await vite.ssrLoadModule('/src/app/CategoryEditor.tsx');
const { without } = await vite.ssrLoadModule('/src/app/TypeCategory.tsx');

function setup(categories, selected) {
  storage.clear();
  applySetting(KEYS.customCategories, categories);
  applySetting(KEYS.view, { ...DEFAULT_VIEW, categories: selected, search: 'drill' });
  applySetting(KEYS.defaultFilters, { categories: [], conditions: [] });
  applySetting(KEYS.savedSearches, [
    { id: 'one', name: 'Search', view: { ...DEFAULT_VIEW, categories: selected }, lastViewedAt: 123 },
    { id: 'old', name: 'Old search', view: { search: 'old' }, lastViewedAt: 456 },
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
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:Power Drills', 'tools', 'custom:Tools']);
  assert.equal(getSetting(KEYS.view).search, 'drill');
  const searches = getSetting(KEYS.savedSearches);
  assert.deepEqual(searches[0].view.categories, ['custom:Power Drills', 'tools', 'custom:Tools']);
  assert.equal(searches[0].lastViewedAt, 123);
  assert.deepEqual(searches[1].view.categories, []);
  assert.deepEqual(saves.map(([key]) => key), [KEYS.customCategories, KEYS.view, KEYS.savedSearches]);
  assert.deepEqual(JSON.parse(storage.get(`tlx:${KEYS.savedSearches}`)), searches);
});

test('removes filters when moving item types leaves a category empty', () => {
  setup([{ name: 'Old', types: ['drill'] }, { name: 'Target', types: ['saw'] }], ['custom:Old', 'custom:Target']);
  saveCustomCategories([{ name: 'Target', types: ['saw', 'drill'] }]);
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:Target']);
  assert.deepEqual(getSetting(KEYS.savedSearches)[0].view.categories, ['custom:Target']);
});

test('applies renames simultaneously and respects a deleted category recreated with the same name', () => {
  setup([{ name: 'A' }, { name: 'B' }, { name: 'C' }], ['custom:A', 'custom:B', 'custom:C']);
  saveCustomCategories(
    [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    new Map([['A', 'B'], ['B', 'A'], ['C', null]]),
  );
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:B', 'custom:A']);
  assert.deepEqual(getSetting(KEYS.savedSearches)[0].view.categories, ['custom:B', 'custom:A']);
});

test('does not rewrite filters when categories are only added, changed, or reordered', () => {
  const saves = setup([{ name: 'A', types: ['drill'] }, { name: 'B' }], ['custom:A', 'tools']);
  saveCustomCategories([{ name: 'B' }, { name: 'A', types: ['saw'] }, { name: 'C' }], new Map([['A', 'A'], ['B', 'B']]));
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:A', 'tools']);
  assert.deepEqual(saves.map(([key]) => key), [KEYS.customCategories]);
});

test('a later rename uses the categories saved by the previous apply', () => {
  setup([{ name: 'A' }], ['custom:A']);
  saveCustomCategories([{ name: 'B' }], new Map([['A', 'B']]));
  saveCustomCategories([{ name: 'C' }], new Map([['B', 'C']]));
  assert.deepEqual(getSetting(KEYS.view).categories, ['custom:C']);
  assert.deepEqual(getSetting(KEYS.savedSearches)[0].view.categories, ['custom:C']);
});

test('renames and deletions update synced default categories without changing conditions', () => {
  const saves = setup([{ name: 'Drills' }, { name: 'Saws' }], ['custom:Drills']);
  applySetting(KEYS.defaultFilters, { categories: ['custom:Drills', 'custom:Saws', 'tools'], conditions: [2] });
  saveCustomCategories([{ name: 'Power Drills' }], new Map([['Drills', 'Power Drills']]));

  assert.deepEqual(getSetting(KEYS.defaultFilters), { categories: ['custom:Power Drills', 'tools'], conditions: [2] });
  assert.ok(saves.some(([key]) => key === KEYS.defaultFilters));
  assert.deepEqual(JSON.parse(storage.get(`tlx:${KEYS.defaultFilters}`)), getSetting(KEYS.defaultFilters));
});

test('category edits do not create a saved view in a new browser', () => {
  setup([{ name: 'Drills' }], []);
  applySetting(KEYS.view, null);
  applySetting(KEYS.defaultFilters, { categories: ['custom:Drills'], conditions: [2] });
  saveCustomCategories([{ name: 'Power Drills' }], new Map([['Drills', 'Power Drills']]));

  assert.equal(getSetting(KEYS.view), null);
  assert.deepEqual(getSetting(KEYS.defaultFilters), { categories: ['custom:Power Drills'], conditions: [2] });
});

test('multiple title regexes and legacy regexes retain matching precedence and scope', () => {
  const categories = [
    { name: 'Title matches', pattern: 'washer', patterns: ['drills?', 'saws?'], within: 'tools' },
    { name: 'Exact', types: ['drill'] },
    { name: 'Scoped exact', types: ['drill'], within: 'tools' },
    { name: 'Later regex', patterns: ['saw', 'washer'] },
  ];
  const compiled = compileCategories(categories);
  const lot = (title, itemType, category = 'tools') => ({ title, itemType, category: { value: category } });
  assert.equal(categoryIndex(lot('Drill and saw', 'drill'), compiled), 2);
  assert.equal(categoryIndex(lot('DRILLS', undefined), compiled), 0);
  assert.equal(categoryIndex(lot('Pressure washer', undefined), compiled), 0);
  assert.equal(categoryIndex(lot('Saws', undefined), compiled), 0);
  assert.equal(categoryIndex(lot('saw', undefined, 'garden'), compiled), 3);
  assert.equal(categoryIndex(lot('washing', undefined), compiled), -1);
  assert.equal(categoryIndex(lot('drill', 'drill', 'garden'), compiled), 1);
});

test('legacy patterns migrate on edit, validate independently, and remain when types move', () => {
  const draft = toDraft({ name: 'Tools', types: ['drill'], pattern: 'saw', patterns: ['drill{2,3}'] });
  assert.deepEqual(clean(draft), { name: 'Tools', types: ['drill'], patterns: ['saw', 'drill{2,3}'] });
  assert.equal(rowError(draft, [draft]), null);
  assert.equal(rowError({ ...draft, pendingPattern: '[' }, []), 'Invalid regex');
  assert.equal(rowError({ ...draft, pendingPattern: 'hammer' }, []), 'Add or clear the pending regex');
  assert.equal(rowError({ ...draft, patterns: ['['] }, []), 'Invalid regex');
  assert.equal(rowError({ ...draft, types: [], patterns: [] }, []), 'Add item types or a regex');
  assert.deepEqual(without(clean(draft), ['drill']), [{ name: 'Tools', types: [], patterns: ['saw', 'drill{2,3}'] }]);
  assert.deepEqual(without({ name: 'Old', types: ['drill'], pattern: 'saw' }, ['drill']), [{ name: 'Old', types: [], pattern: 'saw' }]);
});
