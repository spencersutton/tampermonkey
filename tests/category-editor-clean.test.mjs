import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { createServer } from 'vite';

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const { categoryDraftError, clean } = await vite.ssrLoadModule('/src/app/logic/categories.ts');

test('category drafts save trimmed names and both empty and populated item types', () => {
  assert.deepEqual(clean({ key: 1, from: null, name: ' Tools ', types: [] }), {
    name: 'Tools',
    types: [],
  });
  assert.deepEqual(clean({ key: 2, from: 'Old', name: ' Drills ', types: ['drill', 'bit'] }), {
    name: 'Drills',
    types: ['drill', 'bit'],
  });
});

test('category draft validation allows categories with no item types', () => {
  const empty = { key: 1, from: null, name: 'Tools', types: [] };
  const blank = { key: 2, from: null, name: '   ', types: [] };
  const dup = { key: 3, from: null, name: 'tools', types: ['drill'] };
  assert.equal(categoryDraftError(empty, [empty]), null);
  assert.equal(categoryDraftError(blank, [blank]), 'Name is required');
  assert.equal(categoryDraftError(dup, [empty, dup]), 'Another category has this name');
});
