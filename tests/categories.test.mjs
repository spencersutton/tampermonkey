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
const { DEFAULT_VIEW, categoryIndex, compileCategories, computeFacets } = await vite.ssrLoadModule('/src/app/view.ts');
const { clean, rowError, toDraft } = await vite.ssrLoadModule('/src/app/CategoryEditor.tsx');
const { without } = await vite.ssrLoadModule('/src/app/TypeCategory.tsx');
const { groupCategories, CategoryGroupRow } = await vite.ssrLoadModule('/src/app/Sidebar.tsx');

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

const facet = (label, count = 0, value = `custom:${label}`) => ({ value, label, count });
const facetsFor = (categories, siteCategories = []) => ({ categories, siteCategories, conditions: [], locations: [] });

test('third-tier categories nest under the longest existing name and sort each tier A-Z', () => {
  const groups = groupCategories(facetsFor([
    facet('Tools - Drills - Cordless', 3),
    facet('Tools - Saws', 2),
    facet('Tools - Drills', 1),
    facet('Tools - Drills - Corded', 4),
    facet('Tools & Hardware - Bits', 5),
  ], [facet('Tools', 10, 'tools'), facet('Tools & Hardware', 5, 'hardware')]));
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
    { facet: facet('Tools & Hardware', 0, 'hardware'), subs: [{ facet: facet('Bits', 5, 'custom:Tools & Hardware - Bits'), subs: [] }] },
  ]);
});

test('custom roots can head children, while a missing parent keeps the remaining name intact', () => {
  const groups = groupCategories(facetsFor([
    facet('Favorites - Workshop', 1),
    facet('Favorites', 2),
    facet('Tools - Drills - Cordless', 3),
    facet('Tools - Drill Bits', 4),
    facet('Tools - DrillsExtra', 5),
  ], [facet('Tools', 12, 'tools')]));
  assert.equal(groups[0].facet.label, 'Favorites');
  assert.equal(groups[0].subs[0].facet.label, 'Workshop');
  assert.deepEqual(groups[1].subs.map((g) => g.facet.label), ['Drill Bits', 'Drills - Cordless', 'DrillsExtra']);
});

test('facets retain empty custom ancestors but not unrelated empty categories or closed lots', () => {
  const cats = [
    { name: 'Tools - Drills', types: ['drill'] },
    { name: 'Tools - Drills - Cordless', types: ['cordless drill'] },
    { name: 'Unused', types: ['saw'] },
    { name: 'Tools - Drills - Corded', types: ['corded drill'] },
  ];
  const lot = (itemType, endsAt = 2) => ({ itemType, endsAt, category: { value: 'tools', label: 'Tools' }, condition: null, location: null });
  const facets = computeFacets([lot('cordless drill'), lot('corded drill', 0)], 1, cats);
  assert.deepEqual(facets.categories, [facet('Tools - Drills'), facet('Tools - Drills - Cordless', 1)]);
  const groups = groupCategories(facets);
  assert.equal(groups[0].facet.count, 0);
  assert.equal(groups[0].subs[0].facet.label, 'Drills');
  assert.equal(groups[0].subs[0].subs[0].facet.label, 'Cordless');
});

function rowNodes(node) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(rowNodes);
  if (node.type === CategoryGroupRow || node.type?.name === 'CheckRow') return rowNodes(node.type(node.props));
  return [node, ...rowNodes(node.props?.children)];
}

test('parent rows count and toggle all descendants without touching unrelated selections', () => {
  const [group] = groupCategories(facetsFor([
    facet('Tools', 2, 'tools'),
    facet('Tools - Drills', 1),
    facet('Tools - Drills - Cordless', 3),
    facet('Tools - Saws', 4),
  ], [facet('Tools', 10, 'tools')]));
  let selected = ['garden', 'custom:Tools - Drills - Cordless'];
  const props = { group, selected, collapsed: {}, setCollapsed: () => {}, onChange: (next) => { selected = next; } };
  const nodes = rowNodes(CategoryGroupRow(props));
  const checkbox = nodes.find((n) => n.type === 'input');
  assert.equal(checkbox.props.checked, false);
  assert.equal(checkbox.props.indeterminate, true);
  const button = nodes.find((n) => n.type === 'button');
  assert.equal(button.props['aria-label'], 'Show Tools subcategories (10 lots)');
  checkbox.props.onChange();
  assert.deepEqual(new Set(selected), new Set(['garden', 'tools', 'custom:Tools - Drills', 'custom:Tools - Drills - Cordless', 'custom:Tools - Saws']));
  const checked = rowNodes(CategoryGroupRow({ ...props, selected })).find((n) => n.type === 'input');
  assert.equal(checked.props.checked, true);
  assert.equal(checked.props.indeterminate, false);
  checked.props.onChange();
  assert.deepEqual(selected, ['garden']);

  const drillNodes = rowNodes(CategoryGroupRow({ ...props, group: group.subs[0], selected }));
  assert.equal(drillNodes.find((n) => n.type === 'button').props['aria-label'], 'Show Drills subcategories (4 lots)');
  drillNodes.find((n) => n.type === 'input').props.onChange();
  assert.deepEqual(selected, ['garden', 'custom:Tools - Drills', 'custom:Tools - Drills - Cordless']);
});

test('each tier expands independently and Other toggles only the parent own value', () => {
  const [group] = groupCategories(facetsFor([
    facet('Tools', 2, 'tools'),
    facet('Tools - Drills', 1),
    facet('Tools - Drills - Cordless', 3),
  ], [facet('Tools', 6, 'tools')]));
  let collapsed = {};
  let selected = ['custom:Tools - Drills - Cordless'];
  const render = () => rowNodes(CategoryGroupRow({
    group, collapsed, selected,
    setCollapsed: (next) => { collapsed = next; },
    onChange: (next) => { selected = next; },
  }));
  assert.equal(render().filter((n) => n.props?.class === 'check-expand').length, 1);
  render().find((n) => n.props?.class === 'check-expand').props.onClick();
  assert.deepEqual(collapsed, { 'cat:tools': false });
  const buttons = render().filter((n) => n.props?.class === 'check-expand');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[1].props['aria-expanded'], false);
  buttons[1].props.onClick();
  assert.deepEqual(collapsed, { 'cat:tools': false, 'cat:custom:Tools - Drills': false });
  const nodes = render();
  const checks = nodes.filter((n) => n.type === 'input');
  assert.equal(checks.length, 5);
  checks[3].props.onChange();
  assert.deepEqual(selected, ['custom:Tools - Drills - Cordless', 'custom:Tools - Drills']);
  render().filter((n) => n.type === 'input')[1].props.onChange();
  assert.deepEqual(selected, ['custom:Tools - Drills - Cordless', 'custom:Tools - Drills', 'tools']);
});

test('longer site names win and similar custom names are not treated as descendants', () => {
  const groups = groupCategories(facetsFor([
    facet('Tools - Drills', 1),
    facet('Tools - DrillsExtra', 2),
    facet('Tools - Power - Bits', 3),
  ], [facet('Tools', 3, 'tools'), facet('Tools - Power', 3, 'power')]));
  assert.deepEqual(groups.map((g) => [g.facet.label, g.subs.map((s) => s.facet.label)]), [
    ['Tools', ['Drills', 'DrillsExtra']],
    ['Tools - Power', ['Bits']],
  ]);
});

test('Only on a site or custom leaf replaces selections and stays exclusive on repeated clicks', () => {
  for (const leaf of [facet('Garden', 2, 'garden'), facet('Tools - Drills - Cordless', 3)]) {
    let selected = ['tools', 'custom:Tools - Drills', leaf.value];
    let changes = 0;
    const render = () => rowNodes(CategoryGroupRow({
      group: { facet: leaf, subs: [] }, selected, collapsed: {},
      setCollapsed: () => assert.fail('Only must not change expansion'),
      onChange: (next) => { selected = next; changes++; },
    }));
    for (let i = 0; i < 2; i++) {
      const button = render().find((n) => n.props?.class === 'icon-btn check-only');
      assert.equal(button.props.type, 'button');
      assert.equal(button.props['aria-label'], `Show only ${leaf.label}`);
      button.props.onClick();
      assert.deepEqual(selected, [leaf.value]);
      assert.equal(changes, i + 1);
    }
  }
});

test('Only on a parent replaces selections with the whole branch, even while collapsed', () => {
  const [group] = groupCategories(facetsFor([
    facet('Tools', 0, 'tools'),
    facet('Tools - Drills', 0),
    facet('Tools - Drills - Cordless', 3),
    facet('Tools - Saws', 1),
  ], [facet('Tools', 4, 'tools')]));
  let selected = ['garden', 'custom:Tools - Saws'];
  const render = (branch) => rowNodes(CategoryGroupRow({
    group: branch, selected, collapsed: {},
    setCollapsed: () => assert.fail('Only must not change expansion'),
    onChange: (next) => { selected = next; },
  }));
  render(group).find((n) => n.props?.class === 'icon-btn check-only').props.onClick();
  assert.deepEqual(selected, ['tools', 'custom:Tools - Drills', 'custom:Tools - Drills - Cordless', 'custom:Tools - Saws']);
  const button = render(group.subs[0]).find((n) => n.props?.class === 'icon-btn check-only');
  assert.equal(button.props['aria-label'], 'Show only Drills and its subcategories');
  button.props.onClick();
  assert.deepEqual(selected, ['custom:Tools - Drills', 'custom:Tools - Drills - Cordless']);
});

test('Only on Other excludes descendants, ancestors and unrelated categories', () => {
  const [group] = groupCategories(facetsFor([
    facet('Tools', 2, 'tools'),
    facet('Tools - Drills', 1),
    facet('Tools - Drills - Cordless', 3),
  ], [facet('Tools', 6, 'tools')]));
  let selected = ['garden', 'tools', 'custom:Tools - Drills - Cordless'];
  const render = () => rowNodes(CategoryGroupRow({
    group, selected, collapsed: { 'cat:tools': false, 'cat:custom:Tools - Drills': false },
    setCollapsed: () => assert.fail('Only must not change expansion'),
    onChange: (next) => { selected = next; },
  }));
  render().find((n) => n.props?.['aria-label'] === 'Show only lots directly in Drills').props.onClick();
  assert.deepEqual(selected, ['custom:Tools - Drills']);
  render().find((n) => n.props?.['aria-label'] === 'Show only lots directly in Tools').props.onClick();
  assert.deepEqual(selected, ['tools']);
});

test('exclusive selection uses a compact focus icon with a descriptive tooltip on every tier', () => {
  const [group] = groupCategories(facetsFor([
    facet('Tools', 2, 'tools'),
    facet('Tools - Drills', 1),
    facet('Tools - Drills - Cordless', 3),
  ], [facet('Tools', 6, 'tools')]));
  const nodes = rowNodes(CategoryGroupRow({
    group, selected: [], collapsed: { 'cat:tools': false, 'cat:custom:Tools - Drills': false },
    setCollapsed: () => {}, onChange: () => {},
  }));
  const buttons = nodes.filter((n) => n.props?.class === 'icon-btn check-only');
  assert.equal(buttons.length, 5);
  for (const { props } of buttons) {
    assert.equal(props.type, 'button');
    assert.match(props['aria-label'], /^Show only /);
    assert.equal(props.title, props['aria-label']);
    assert.equal(props.children.type.name, 'Icon');
    assert.equal(props.children.props.name, 'focus');
    assert.equal(props.children.props.size, 16);
  }
});
