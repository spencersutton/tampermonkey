import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { categoryError, categoryName } = await vite.ssrLoadModule('/src/app/TypeCategory.tsx');

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
