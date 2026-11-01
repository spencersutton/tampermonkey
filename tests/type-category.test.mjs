import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';
import { Component, h, options } from 'preact';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { categoryError, categoryName, TypeCategory } = await vite.ssrLoadModule('/src/app/TypeCategory.tsx');
const { applySetting, getSetting, setSaveHook } = await vite.ssrLoadModule('/src/app/settings.ts');
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { categoryIndex, compileCategories } = await vite.ssrLoadModule('/src/app/view.ts');
const { clean, rowError, toDraft } = await vite.ssrLoadModule('/src/app/CategoryEditor.tsx');

test('category names pluralize the last word', () => {
  for (const [type, expected] of [
    ['drill bit set', 'Drill Bit Sets'],
    ['box', 'Boxes'],
    ['glass', 'Glasses'],
    ['saw', 'Saws'],
    ['lens', 'Lens'],
    ['battery', 'Batteries'],
    ['tray', 'Trays'],
  ]) {
    assert.equal(categoryName(type), expected);
  }
});

test('category validation checks the selected mode and trims new names', () => {
  const cats = [{ name: 'Drills' }];
  assert.equal(categoryError('add', undefined, '', cats), 'Pick a category');
  assert.equal(categoryError('add', cats[0], '', cats), null);
  assert.equal(categoryError('new', undefined, '   ', cats), 'Name is required');
  assert.equal(categoryError('new', undefined, '  dRilLs  ', cats), 'There’s already a category with this name – use “Add to existing”');
  assert.equal(categoryError('new', undefined, ' Saws ', cats), null);
});

function nodes(node) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

const lot = (itemType = 'cordless drill', category = { value: 'tools', label: 'Tools' }) => ({
  itemType, category, title: 'Cordless drill kit', endsAt: Date.now() + 10000,
});

function dialog(t, categories, item = lot(), lots = [item]) {
  applySetting(KEYS.customCategories, categories);
  applySetting(KEYS.view, null);
  applySetting(KEYS.defaultFilters, { categories: [], conditions: [] });
  applySetting(KEYS.savedSearches, []);
  const saves = [];
  setSaveHook((key, value) => saves.push([key, value]));
  let closed = false;
  const vnode = h(TypeCategory, { lot: item, lots, onClose: () => { closed = true; } });
  // Exercise real hooks and event handlers without mounting the surrounding Dialog.
  vnode.__c = new Component(vnode.props);
  vnode.__c.setState = () => {};
  t.after(() => options.diffed(vnode));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return {
    render: () => {
      options.__r(vnode);
      return nodes(TypeCategory(vnode.props));
    },
    saves,
    closed: () => closed,
  };
}

test('a categorized type defaults to creating a tertiary category and retains its emptied parent', (t) => {
  const parent = { name: 'Tools - Drills', types: ['cordless drill'], within: 'tools' };
  const d = dialog(t, [parent]);
  const rows = d.render();
  assert.equal(rows.find((n) => n.props?.role === 'radio').props['aria-checked'], true);
  assert.equal(rows.find((n) => n.type === 'input' && n.props.type === 'text').props.value, 'Tools - Drills - Cordless Drills');
  assert.equal(rows.find((n) => n.props?.class === 'switch-row').props.children[0].props.checked, true);
  assert.equal(d.saves.length, 0);
  rows.find((n) => n.type === 'button' && n.props.children === 'Create').props.onClick();
  const saved = getSetting(KEYS.customCategories);
  assert.deepEqual(saved, [
    { ...parent, types: [] },
    { name: 'Tools - Drills - Cordless Drills', types: ['cordless drill'], within: 'tools' },
  ]);
  assert.equal(categoryIndex(lot(), compileCategories(saved)), 1);
  const drafts = saved.map(toDraft);
  assert.equal(rowError(drafts[0], drafts), null);
  assert.deepEqual(drafts.map(clean), [{ name: parent.name, within: 'tools' }, saved[1]]);
  assert.equal(d.closed(), true);
});

test('new children inherit an unrestricted parent scope rather than the lot site scope', (t) => {
  const d = dialog(t, [{ name: 'Favorites - Drills', types: ['cordless drill'] }]);
  const rows = d.render();
  assert.equal(rows.find((n) => n.props?.class === 'switch-row').props.children[0].props.checked, false);
  assert.equal(rows.find((n) => n.type === 'input' && n.props.type === 'text').props.value, 'Favorites - Drills - Cordless Drills');
  rows.find((n) => n.type === 'button' && n.props.children === 'Create').props.onClick();
  assert.equal(getSetting(KEYS.customCategories)[1].within, undefined);
  assert.equal(categoryIndex(lot('cordless drill', { value: 'garden' }), compileCategories(getSetting(KEYS.customCategories))), 1);
});

test('regex membership also suggests a child, and preserves parent patterns and other types', (t) => {
  const parent = { name: 'Tools - Drills', types: ['hammer drill'], patterns: ['cordless drill'], within: 'tools' };
  const d = dialog(t, [parent]);
  const rows = d.render();
  assert.equal(rows.find((n) => n.type === 'input' && n.props.type === 'text').props.value, 'Tools - Drills - Cordless Drills');
  rows.find((n) => n.type === 'button' && n.props.children === 'Create').props.onClick();
  assert.deepEqual(getSetting(KEYS.customCategories)[0], parent);
  assert.equal(categoryIndex(lot(), compileCategories(getSetting(KEYS.customCategories))), 1);
});

test('uncategorized types keep site-based names and scope', (t) => {
  const d = dialog(t, [], lot('cordless drill'));
  let rows = d.render();
  assert.equal(rows.find((n) => n.type === 'input' && n.props.type === 'text').props.value, 'Tools - Cordless Drills');
  rows.find((n) => n.props?.class === 'switch-row').props.children[0].props.onChange({ currentTarget: { checked: false } });
  rows = d.render();
  assert.equal(rows.find((n) => n.type === 'input' && n.props.type === 'text').props.value, 'Cordless Drills');
});

test('a type without a site category defaults to an unrestricted new category', (t) => {
  const d = dialog(t, [], lot('cordless drill', null));
  const rows = d.render();
  assert.equal(rows.find((n) => n.type === 'input' && n.props.type === 'text').props.value, 'Cordless Drills');
  assert.equal(rows.some((n) => n.props?.class === 'switch-row'), false);
  rows.find((n) => n.type === 'button' && n.props.children === 'Create').props.onClick();
  assert.deepEqual(getSetting(KEYS.customCategories), [{ name: 'Cordless Drills', types: ['cordless drill'] }]);
});

test('Add to existing remains an explicit option preselected to the current category', (t) => {
  const parent = { name: 'Tools - Drills', types: ['cordless drill'], within: 'tools' };
  const d = dialog(t, [parent]);
  d.render().find((n) => n.type === 'button' && n.props.children === 'Add to existing').props.onClick();
  const rows = d.render();
  assert.equal(rows.find((n) => n.type === 'select').props.value, parent.name);
  assert.equal(rows.filter((n) => n.props?.role === 'radio')[1].props['aria-checked'], true);
  rows.find((n) => n.type === 'button' && n.props.children === 'Add').props.onClick();
  assert.deepEqual(getSetting(KEYS.customCategories), [parent]);
  assert.equal(d.closed(), true);
});
