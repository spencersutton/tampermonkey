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
const { clean } = await vite.ssrLoadModule('/src/app/CategoryEditor.tsx');

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
