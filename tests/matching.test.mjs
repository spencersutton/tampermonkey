// Item matching (src/shared/identity.ts), ported from the earlier Python
// server's tests; it must keep giving the results that server saved.
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
const { brandModelKey, groupLots, ItemIndex, ItemTypeIndex, itemsMatch, setGroups } =
  await vite.ssrLoadModule('/src/shared/identity.ts');

const LATER = 4_000_000_000_000;
const item = (id, title = 'Cordless drill', fields = {}) => ({
  id,
  title,
  brand: 'Acme',
  model: 'D-100',
  condition: null,
  endsAt: LATER,
  ...fields,
});
const NEW = { value: 1, label: 'New' };

test('identity keys collapse case and whitespace, keep model punctuation, and need both fields', () => {
  assert.equal(
    brandModelKey(item(1, '', { brand: ' ACME   Tools ', model: ' D  100 ' })),
    'acme tools\nd 100',
  );
  assert.notEqual(brandModelKey(item(1)), brandModelKey(item(1, '', { model: 'D100' })));
  for (const fields of [{ brand: null }, { model: '  ' }, { model: null }, { brand: undefined }]) {
    assert.equal(brandModelKey(item(1, '', fields)), null, JSON.stringify(fields));
  }
});

test('identity matches ignore titles, case and whitespace but not model punctuation or order', () => {
  const first = item(1);
  assert.ok(
    itemsMatch(
      first,
      item(2, 'Completely different 99-pack', { brand: ' ACME ', model: ' d-100 ' }),
      100,
    ),
  );
  for (const change of [
    { model: 'D-101' },
    { brand: 'Other' },
    { model: 'D100' },
    { model: '100-D' },
  ]) {
    assert.equal(itemsMatch(first, item(2, undefined, change), 50), false, JSON.stringify(change));
  }
  for (const change of [{ brand: null }, { model: null }, { brand: '   ' }]) {
    const partial = item(2, undefined, change);
    assert.ok(itemsMatch(first, partial, 100), JSON.stringify(change));
    assert.ok(itemsMatch(partial, first, 100), JSON.stringify(change));
  }
  const noBrand = { brand: null };
  assert.equal(
    itemsMatch(item(1, 'Drill Qty 2', noBrand), item(2, 'Drill Qty 3', noBrand), 50),
    false,
  );
});

test('grouping keeps known models separate even when an unknown title matches both', () => {
  const items = [
    item(1),
    item(2, undefined, { model: null }),
    item(3, undefined, { model: 'D-200' }),
    item(4, 'Other wording'),
  ];
  const expected = groupLots(items);
  for (const ordering of [items, items.toReversed(), [items[1], items[2], items[0], items[3]]]) {
    const groups = groupLots(ordering);
    assert.equal(groups.get(1), groups.get(4));
    assert.notEqual(groups.get(1), groups.get(3));
    assert.ok([groups.get(1), groups.get(3)].includes(groups.get(2)));
    assert.deepEqual(groups, expected, "the order lots come in doesn't matter");
  }
});

test('title fallback ignores case and order but never differing numbers', () => {
  const titles = [
    'Cordless drill',
    'drill CORDLESS',
    'Cordless drill Qty 2',
    'Drill 10 oz.',
    'Drill 29 oz.',
  ];
  const groups = groupLots(titles.map((t, i) => item(i, t, { brand: null })));
  assert.equal(groups.get(0), groups.get(1));
  assert.equal(new Set([0, 2, 3, 4].map((i) => groups.get(i))).size, 4);
});

test('"Qty" only joins its number at the start of a word', () => {
  const noBrand = { brand: null };
  assert.ok(itemsMatch(item(1, 'Drill qty.3', noBrand), item(2, 'Drill Qty 3', noBrand), 100));
  // Python's \b treats letters beyond ASCII as word characters, so "éqty 3" is "qty" and "3".
  assert.equal(
    itemsMatch(item(1, 'Drill éqty 3', noBrand), item(2, 'Drill qty 3', noBrand), 0),
    false,
  );
  assert.ok(itemsMatch(item(1, 'Drill éqty 3', noBrand), item(2, 'Drill 3 qty', noBrand), 100));
  // ...and so is its whitespace: \x1c separates "Qty" from its number, a byte-order mark doesn't.
  assert.ok(itemsMatch(item(1, 'Drill Qty\x1c3', noBrand), item(2, 'Drill qty3', noBrand), 100));
  assert.ok(itemsMatch(item(1, 'Drill Qty\ufeff3', noBrand), item(2, 'Drill 3 qty', noBrand), 100));
});

test('title fallback uses a fixed 90 percent threshold', () => {
  const title = 'Cordless drill with battery charger case bits belt clip';
  const noBrand = { brand: null };
  const groups = groupLots([
    item(1, `${title} manual`, noBrand),
    item(2, title, noBrand),
    item(3, 'Cordless drill with battery charger', noBrand),
  ]);
  assert.equal(groups.get(1), groups.get(2));
  assert.notEqual(groups.get(1), groups.get(3));
});

test('the same brand and model groups across conditions, and only shared groups get an id', () => {
  const lots = [
    item(5),
    item(3),
    item(4, 'Other words', { condition: NEW }),
    item(9, 'Saw', { model: 'S-1', groupId: 9 }),
  ];
  setGroups(lots);
  assert.deepEqual(
    lots.map((lot) => lot.groupId),
    [3, 3, 3, undefined],
  );
  assert.equal('groupId' in lots[3], false);
});

test('title matches without a brand and model stay within one condition', () => {
  const noBrand = { brand: null };
  const groups = groupLots([
    item(1, undefined, noBrand),
    item(2, undefined, { ...noBrand, condition: NEW }),
    item(3, undefined, noBrand),
  ]);
  assert.equal(groups.get(1), groups.get(3));
  assert.notEqual(groups.get(1), groups.get(2));
});

test('titles without words group only with the same title', () => {
  const noBrand = { brand: null };
  const groups = groupLots([
    item(1, '!!', noBrand),
    item(2, ' !! ', noBrand),
    item(3, '??', noBrand),
    item(4, '', noBrand),
    item(5, 'T', noBrand),
  ]);
  assert.equal(groups.get(1), groups.get(2));
  assert.notEqual(groups.get(1), groups.get(3));
  assert.notEqual(groups.get(4), groups.get(5), 'an empty title is not the word "t"');
});

test('duplicate-heavy catalogs group efficiently without changing known model boundaries', () => {
  const lots = Array.from({ length: 20000 }, (_, i) =>
    item(i, undefined, { model: `D-${i % 10}` }),
  );
  const start = performance.now();
  const groups = groupLots(lots);
  assert.equal(new Set(groups.values()).size, 10);
  assert.ok(
    performance.now() - start < 2000,
    '20,000 listings should not need quadratic comparisons',
  );
});

test('past closes prefer identity, fall back to titles in either direction, and never include the lot', () => {
  const index = new ItemIndex(
    [
      item(1, 'Entirely different title', { endsAt: 100 }),
      item(2, undefined, { model: 'D-200', endsAt: 200 }),
      item(3, undefined, { brand: null, endsAt: 300 }),
      item(4, undefined, { brand: ' ACME ', model: ' d-100 ', endsAt: 400 }),
    ],
    90,
  );
  const ids = (lot) => index.matches(lot).map((row) => row.id);
  assert.deepEqual(ids(item(10)), [4, 3, 1]);
  assert.deepEqual(ids(item(10, undefined, { model: null })), [4, 3, 2]);
  assert.deepEqual(ids(item(4)), [3, 1], 'the same lot is never its own history');
  assert.deepEqual(ids(item(10, 'Unrelated title', { model: null })), []);
});

test('incomplete title fallback keeps numeric and fuzzy rules', () => {
  const noBrand = { brand: null };
  const index = new ItemIndex(
    [item(1, 'Cordless drill Qty 2', noBrand), item(2, 'drill Cordless', noBrand)],
    90,
  );
  assert.deepEqual(
    index.matches(item(3)).map((row) => row.id),
    [2],
  );
  assert.deepEqual(index.matches(item(3, 'Cordless drill Qty 3')), []);
});

test('item types: manual beats automatic, the latest manual wins, identity beats title-only labels', () => {
  const label = (type, fields) => ({
    title: 'Cordless drill',
    brand: 'Acme',
    model: 'D-100',
    manual: false,
    at: 1,
    type,
    ...fields,
  });
  const match = (records, it = item(1)) => new ItemTypeIndex(records).match(it)?.type ?? null;
  const titleOnly = { brand: null, model: null };
  assert.equal(match([label('driver'), label('battery', { ...titleOnly, at: 5 })]), 'driver');
  assert.equal(
    match([label('driver', { at: 9 }), label('hammer drill', { ...titleOnly, manual: true })]),
    'hammer drill',
  );
  assert.equal(
    match([
      label('driver', { manual: true, at: 2 }),
      label('saw', { ...titleOnly, manual: true, at: 3 }),
    ]),
    'saw',
  );
  assert.equal(
    match([label('driver', { model: 'D-200', manual: true })]),
    null,
    'other models never share labels',
  );
  assert.equal(
    match([label('driver')], item(1, 'Other title')),
    'driver',
    'the same identity under another title',
  );
  assert.equal(match([label('driver', { title: 'Other title', model: null })], item(1)), null);
  assert.equal(match([]), null);
});
