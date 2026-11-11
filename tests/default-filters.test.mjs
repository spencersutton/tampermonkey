import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

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
