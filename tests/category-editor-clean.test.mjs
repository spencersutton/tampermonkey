import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { createTestServer } from './vite.mjs';

const vite = await createTestServer();
after(() => vite.close());
const { buildEditorTree, categoryDraftError, clean, removeDraft } = await vite.ssrLoadModule(
  '/src/app/logic/categories.ts',
);

test('category drafts save id, trimmed names, optional parent, and item types', () => {
  assert.deepEqual(
    clean({ key: 1, id: 'c1', from: null, name: ' Tools ', parent: null, types: [] }),
    {
      id: 'c1',
      name: 'Tools',
      types: [],
    },
  );
  assert.deepEqual(
    clean({
      key: 2,
      id: 'c2',
      from: 'custom:c2',
      name: ' Drills ',
      parent: 'tools',
      types: ['drill', 'bit'],
    }),
    {
      id: 'c2',
      name: 'Drills',
      parent: 'tools',
      types: ['drill', 'bit'],
    },
  );
});

test('category draft validation checks sibling uniqueness and prevents cycles', () => {
  const empty = { key: 1, id: 'c1', from: null, name: 'Batteries', parent: 'tools', types: [] };
  const blank = { key: 2, id: 'c2', from: null, name: '   ', parent: null, types: [] };
  const dupSibling = {
    key: 3,
    id: 'c3',
    from: null,
    name: 'batteries',
    parent: 'tools',
    types: ['battery'],
  };
  const sameNameDifferentParent = {
    key: 4,
    id: 'c4',
    from: null,
    name: 'Batteries',
    parent: 'electronics',
    types: ['aa battery'],
  };
  const cyclic = {
    key: 5,
    id: 'c5',
    from: null,
    name: 'Loop',
    parent: 'custom:c5',
    types: [],
  };
  assert.equal(categoryDraftError(empty, [empty]), null);
  assert.equal(categoryDraftError(blank, [blank]), 'Name is required');
  assert.equal(
    categoryDraftError(dupSibling, [empty, dupSibling]),
    'Another category under this parent has this name',
  );
  assert.equal(categoryDraftError(sameNameDifferentParent, [empty, sameNameDifferentParent]), null);
  assert.equal(categoryDraftError(cyclic, [cyclic]), 'Category cannot be nested under itself');
});

test('removeDraft reparents direct children to the deleted category parent', () => {
  const parent = {
    key: 1,
    id: 'drills',
    from: 'custom:drills',
    name: 'Drills',
    parent: 'tools',
    types: [],
  };
  const child = {
    key: 2,
    id: 'cordless',
    from: 'custom:cordless',
    name: 'Cordless',
    parent: 'custom:drills',
    types: [],
  };
  const next = removeDraft([parent, child], parent);
  assert.deepEqual(next, [{ ...child, parent: 'tools' }]);
});

test('buildEditorTree groups site-parented drafts under site headers with nested depths', () => {
  const drafts = [
    { key: 1, id: 'cordless', from: null, name: 'Cordless', parent: 'custom:drills', types: [] },
    { key: 2, id: 'drills', from: null, name: 'Drills', parent: 'tools', types: [] },
    { key: 3, id: 'favs', from: null, name: 'Favorites', parent: null, types: [] },
  ];
  const rows = buildEditorTree(drafts, [{ value: 'tools', label: 'Tools' }]);
  assert.deepEqual(
    rows.map(r => (r.kind === 'site' ? ['site', r.label] : ['draft', r.draft.name, r.depth])),
    [
      ['draft', 'Favorites', 0],
      ['site', 'Tools'],
      ['draft', 'Drills', 1],
      ['draft', 'Cordless', 2],
    ],
  );
});
