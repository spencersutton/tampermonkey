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

function submit(rows, label) {
  const buttons = rows.filter((n) => n.type === 'button' && n.props.type === 'submit');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.children, label);
  let prevented = false;
  rows.find((n) => n.type === 'form').props.onSubmit({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
}

function pressKey(rows, target, overrides = {}) {
  let prevented = false;
  const previous = globalThis.HTMLElement;
  class Element {
    matches(selector) {
      const tag = target.tagName.toLowerCase();
      const inputType = tag === 'input' ? `[type="${target.type}"]` : '';
      return selector.split(', ').includes(tag + inputType);
    }
  }
  globalThis.HTMLElement = Element;
  try {
    rows.find((n) => n.props.onKeyDownCapture).props.onKeyDownCapture({
      key: 'Enter', target: new Element(), repeat: false, isComposing: false,
      preventDefault: () => { prevented = true; },
      ...overrides,
    });
  } finally {
    if (previous === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previous;
  }
  return prevented;
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
  submit(rows, 'Create');
  assert.deepEqual(getSetting(KEYS.customCategories), [{ name: 'Cordless Drills', types: ['cordless drill'] }]);
});

test('existing categories default to add mode and retain the preferred category', (t) => {
  const categories = [{ name: 'Tools - Drills', types: ['drill'] }, { name: 'Workshop', types: ['saw'] }];
  const d = dialog(t, categories);
  applySetting(KEYS.lastCategory, 'Workshop');
  const rows = d.render();
  const modes = rows.filter((n) => n.props.role === 'radio');
  assert.equal(modes[0].props['aria-checked'], false);
  assert.equal(modes[1].props['aria-checked'], true);
  assert.equal(rows.find((n) => n.type === 'select').props.value, 'Workshop');
  submit(rows, 'Add');
  assert.deepEqual(getSetting(KEYS.customCategories), [
    categories[0],
    { name: 'Workshop', types: ['saw', 'cordless drill'] },
  ]);
  assert.equal(d.closed(), true);
});

test('default form submission does not save when the category search has no selection', (t) => {
  const categories = [{ name: 'Workshop', types: ['saw'] }];
  const d = dialog(t, categories);
  d.render().find((n) => n.type === 'input' && n.props.type === 'search').props.onInput({ currentTarget: { value: 'no matches' } });
  const rows = d.render();
  assert.equal(rows.find((n) => n.type === 'select').props.value, '');
  assert.equal(pressKey(rows, { tagName: 'INPUT', type: 'search' }), true);
  submit(rows, 'Add');
  assert.deepEqual(getSetting(KEYS.customCategories), categories);
  assert.deepEqual(d.saves, []);
  assert.equal(d.closed(), false);
});

test('default form submission does not create a category with an empty name', (t) => {
  const d = dialog(t, []);
  d.render().find((n) => n.type === 'input' && n.props.type === 'text').props.onInput({ currentTarget: { value: ' ' } });
  const rows = d.render();
  assert.equal(pressKey(rows, { tagName: 'INPUT', type: 'text' }), true);
  submit(rows, 'Create');
  assert.deepEqual(getSetting(KEYS.customCategories), []);
  assert.deepEqual(d.saves, []);
  assert.equal(d.closed(), false);
});

for (const mode of ['add', 'new']) {
  for (const target of [
    { tagName: 'DIALOG' },
    { tagName: 'FORM' },
    { tagName: 'INPUT', type: 'search' },
    { tagName: 'INPUT', type: 'text' },
  ]) {
    test(`Enter triggers ${mode} from the dialog or text field: ${JSON.stringify(target)}`, (t) => {
      const categories = mode === 'add' ? [{ name: 'Workshop', types: ['saw'] }] : [];
      const d = dialog(t, categories);
      assert.equal(pressKey(d.render(), target), true);
      assert.deepEqual(getSetting(KEYS.customCategories), mode === 'add'
        ? [{ name: 'Workshop', types: ['saw', 'cordless drill'] }]
        : [{ name: 'Tools - Cordless Drills', types: ['cordless drill'] }]);
      assert.equal(d.saves.filter(([key]) => key === KEYS.customCategories).length, 1);
      assert.equal(d.closed(), true);
    });
  }
}

for (const target of [
  { tagName: 'SELECT' },
  { tagName: 'INPUT', type: 'checkbox' },
  { tagName: 'INPUT', type: 'radio' },
  { tagName: 'BUTTON', textContent: 'Cancel' },
  { tagName: 'BUTTON', role: 'radio' },
  { tagName: 'BUTTON', type: 'submit' },
  { tagName: 'TEXTAREA' },
  { tagName: 'A' },
]) {
  test(`Enter preserves the focused control's native action: ${JSON.stringify(target)}`, (t) => {
    const d = dialog(t, [{ name: 'Workshop', types: ['saw'] }]);
    assert.equal(pressKey(d.render(), target), false);
    assert.deepEqual(d.saves, []);
    assert.equal(d.closed(), false);
  });
}

test('Enter shortcut ignores composition and repeats, leaving other keys alone', (t) => {
  const d = dialog(t, []);
  const rows = d.render();
  assert.equal(pressKey(rows, { tagName: 'FORM' }, { isComposing: true }), false);
  assert.equal(pressKey(rows, { tagName: 'FORM' }, { repeat: true }), true);
  assert.equal(pressKey(rows, { tagName: 'FORM' }, { key: 'Escape' }), false);
  assert.equal(pressKey(rows, { tagName: 'FORM' }, { key: ' ' }), false);
  assert.deepEqual(d.saves, []);
  assert.equal(d.closed(), false);
});
