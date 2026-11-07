import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';
import { Component, h, options } from 'preact';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { categoryError, categoryName, TypeCategory } = await vite.ssrLoadModule('/src/app/TypeCategory.tsx');
const { applySetting, getSetting, setSaveHook } = await vite.ssrLoadModule('/src/app/settings.ts');
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');

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
  itemType, category, title: 'Cordless drill kit', endsAt: Temporal.Now.instant().add({ seconds: 10 }),
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

test('a type without a site category defaults to an unrestricted new category', (t) => {
  const d = dialog(t, [], lot('cordless drill', null));
  const rows = d.render();
  assert.equal(rows.find((n) => n.type === 'input' && n.props.type === 'text').props.value, 'Cordless Drills');
  assert.equal(rows.some((n) => n.props?.class === 'switch-row'), false);
  rows.find((n) => n.type === 'button' && n.props.children === 'Create').props.onClick();
  assert.deepEqual(getSetting(KEYS.customCategories), [{ name: 'Cordless Drills', types: ['cordless drill'] }]);
});
