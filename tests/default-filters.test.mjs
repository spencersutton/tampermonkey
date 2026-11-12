import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { Component, h, options } from 'preact';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const { DEFAULT_VIEW, defaultFilterView, initialView, sameDefaultFilters } =
  await vite.ssrLoadModule('/src/app/view.ts');
const { KEYS, SERVER_KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { navFromUrl } = await vite.ssrLoadModule('/src/app/history.ts');
const { Sidebar } = await vite.ssrLoadModule('/src/app/Sidebar.tsx');
const { applySetting, getSetting, setSaveHook } = await vite.ssrLoadModule('/src/app/settings.ts');
const { modal, openId } = await vite.ssrLoadModule('/src/app/state.ts');
const { lots } = await vite.ssrLoadModule('/src/app/catalog.ts');
globalThis.location = { protocol: 'http:', host: 'localhost' };
const { App } = await vite.ssrLoadModule('/src/app/App.tsx');
after(() => delete globalThis.location);

test('defaults are server-backed and used only when there is no saved browser view', () => {
  const defaults = { categories: ['tools'], conditions: [2] };
  assert.ok(SERVER_KEYS.includes(KEYS.defaultFilters));
  assert.deepEqual(initialView(null, defaults), {
    ...DEFAULT_VIEW,
    categories: ['tools'],
    conditions: [2],
  });
  const stored = { ...DEFAULT_VIEW, categories: [], conditions: [3], search: 'saw' };
  assert.deepEqual(initialView(stored, defaults), stored);
});

test('a shared URL remains independent of saved defaults', () => {
  const nav = navFromUrl('?search=saw&category=garden&condition=3');
  assert.deepEqual(initialView(nav.view, { categories: ['tools'], conditions: [2] }), nav.view);
  assert.deepEqual(nav.view.categories, ['garden']);
  assert.deepEqual(nav.view.conditions, [3]);
});

test('reset preserves sort, clears other filters, and copies defaults', () => {
  const defaults = { categories: ['tools'], conditions: [2] };
  const reset = defaultFilterView(defaults, 'title-asc');
  assert.deepEqual(reset, {
    ...DEFAULT_VIEW,
    sort: 'title-asc',
    categories: ['tools'],
    conditions: [2],
  });
  reset.categories.push('garden');
  reset.conditions.push(3);
  assert.deepEqual(defaults, { categories: ['tools'], conditions: [2] });
});

test('default selections are compared independently of order', () => {
  const defaults = { categories: ['tools', 'garden'], conditions: [1, 2] };
  assert.equal(
    sameDefaultFilters({ categories: ['garden', 'tools'], conditions: [2, 1] }, defaults),
    true,
  );
  assert.equal(sameDefaultFilters({ categories: [], conditions: [1, 2] }, defaults), false);
  assert.equal(
    sameDefaultFilters({ categories: ['tools', 'garden'], conditions: [] }, defaults),
    false,
  );
});

function nodes(node) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

function shortcut(t, view) {
  applySetting(KEYS.defaultFilters, { categories: [], conditions: [] });
  applySetting(KEYS.view, view);
  modal.value = null;
  openId.value = null;
  const saves = [];
  setSaveHook((key, value) => saves.push([key, value]));
  t.after(() => {
    setSaveHook(() => {});
    modal.value = null;
    openId.value = null;
  });
  const ownerDocument = new EventTarget();
  const cleanup = Sidebar({ view }).ref({ ownerDocument });
  t.after(cleanup);
  return {
    saves,
    cleanup,
    ownerDocument,
    press(overrides = {}) {
      const event = new Event('keydown', { cancelable: true });
      Object.assign(event, {
        code: 'KeyD',
        altKey: true,
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        ...overrides,
      });
      ownerDocument.dispatchEvent(event);
      return event.defaultPrevented;
    },
  };
}

test('Alt+Shift+D saves the same defaults as the button through the shared persistence hook', (t) => {
  const view = {
    ...DEFAULT_VIEW,
    categories: ['custom:Drills'],
    conditions: [2],
    search: 'drill',
    priceMax: 20,
  };
  const keys = shortcut(t, view);
  assert.equal(keys.press(), true);
  const expected = { categories: ['custom:Drills'], conditions: [2] };
  assert.deepEqual(getSetting(KEYS.defaultFilters), expected);
  assert.deepEqual(keys.saves, [[KEYS.defaultFilters, expected]]);
  view.categories.push('garden');
  view.conditions.push(3);
  assert.deepEqual(getSetting(KEYS.defaultFilters), expected);
  keys.cleanup();
  assert.equal(keys.press(), false);
  assert.equal(keys.saves.length, 1);
});

test('default shortcut ignores unrelated keys, repeats, composition and open popups', (t) => {
  const keys = shortcut(t, { ...DEFAULT_VIEW, noCategories: true });
  for (const event of [
    { code: 'KeyS' },
    { altKey: false },
    { shiftKey: false },
    { ctrlKey: true },
    { metaKey: true },
    { repeat: true },
    { isComposing: true },
  ]) {
    assert.equal(keys.press(event), false);
  }
  modal.value = { kind: 'categories' };
  assert.equal(keys.press(), false);
  modal.value = null;
  openId.value = 1;
  assert.equal(keys.press(), false);
  openId.value = null;
  assert.deepEqual(keys.saves, []);
  assert.equal(keys.press(), true);
  assert.deepEqual(keys.saves, [
    [KEYS.defaultFilters, { categories: [], conditions: [], noCategories: true }],
  ]);
});

test('default shortcut respects the disabled save button when selections already match', (t) => {
  const keys = shortcut(t, DEFAULT_VIEW);
  assert.equal(keys.press(), true);
  assert.deepEqual(keys.saves, []);
});

test('category shortcuts expand and collapse all nested groups without changing filters', (t) => {
  const view = { ...DEFAULT_VIEW, categories: ['tools'], search: 'drill', conditions: [2] };
  const keys = shortcut(t, view);
  applySetting(KEYS.customCategories, [
    { name: 'Tools - Drills', types: [] },
    { name: 'Tools - Drills - Cordless', types: ['drill'] },
  ]);
  lots.value = new Map([[1, {
    id: 1,
    endsAt: Temporal.Now.instant().add({ hours: 1 }),
    category: { value: 'tools', label: 'Tools' },
    itemType: 'drill',
  }]]);
  t.after(() => {
    lots.value = new Map();
    applySetting(KEYS.customCategories, []);
  });
  const collapsed = {
    'f-category': true,
    'f-condition': true,
    'cat:tools': true,
    'cat:custom:Tools - Drills': true,
  };
  applySetting(KEYS.collapsed, collapsed);
  assert.equal(keys.press({ code: 'KeyE' }), true);
  const expanded = {
    ...collapsed,
    'f-category': false,
    'cat:tools': false,
    'cat:custom:Tools - Drills': false,
  };
  assert.deepEqual(getSetting(KEYS.collapsed), expanded);
  assert.equal(keys.press({ code: 'KeyC' }), true);
  assert.deepEqual(getSetting(KEYS.collapsed), { ...collapsed, 'f-category': false });
  assert.deepEqual(JSON.parse(storage.get(`tlx:${KEYS.collapsed}`)), {
    ...collapsed,
    'f-category': false,
  });
  assert.deepEqual(getSetting(KEYS.view), view);
  assert.deepEqual(keys.saves, [
    [KEYS.collapsed, expanded],
    [KEYS.collapsed, { ...collapsed, 'f-category': false }],
  ]);
});

test('question mark opens a dismissible guide but leaves text entry and popups alone', (t) => {
  const keys = shortcut(t, DEFAULT_VIEW);
  const question = { code: 'Slash', key: '?', altKey: false };
  keys.ownerDocument.activeElement = { closest: () => ({}) };
  assert.equal(keys.press(question), false);
  assert.equal(modal.value, null);
  keys.ownerDocument.activeElement = null;
  for (const overrides of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }]) {
    assert.equal(keys.press({ ...question, ...overrides }), false);
  }
  openId.value = 42;
  assert.equal(keys.press(question), false);
  openId.value = null;
  modal.value = { kind: 'categories' };
  assert.equal(keys.press(question), false);
  modal.value = null;
  assert.equal(keys.press(question), true);
  assert.deepEqual(modal.value, { kind: 'shortcuts' });
  assert.equal(keys.press({ code: 'KeyE' }), false);
  assert.equal(keys.press({ code: 'KeyC' }), false);
  globalThis.window = { setInterval: () => 0 };
  t.after(() => delete globalThis.window);
  const vnode = h(App, {});
  vnode.__c = new Component(vnode.props);
  vnode.__c.__h = [];
  options.__r(vnode);
  const tree = App(vnode.props);
  options.diffed(vnode);
  options.unmount?.(vnode);
  const guide = nodes(tree).find((n) => n.props?.['aria-labelledby'] === 'shortcuts-title');
  assert.ok(guide);
  const labels = nodes(guide).filter((n) => n.type === 'kbd').map((n) => n.props.children);
  assert.deepEqual(labels, ['Alt+Shift+D', 'Alt+Shift+E', 'Alt+Shift+C', '?', 'Esc']);
  guide.props.onClose();
  assert.equal(modal.value, null);
  assert.equal(keys.press({ ...question, key: undefined }), true);
});
