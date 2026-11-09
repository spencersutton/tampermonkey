import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const originalFetch = globalThis.fetch;
const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
afterEach(() => { globalThis.fetch = originalFetch; applyCatalog(reply(1000, [])); });
const { lots, updateItemType } = await vite.ssrLoadModule('/src/app/catalog.ts');
const { applyCatalog, setItemType } = await vite.ssrLoadModule('/src/app/source.ts');
const { categoryOf, computeFacets } = await vite.ssrLoadModule('/src/app/view.ts');

const lot = (id, title, itemType, fields = {}) => ({
  id, title, itemType, version: 1, currentPrice: 10, firstSeenAt: 5, endsAt: 2000,
  category: { value: 'tools', label: 'Tools' }, condition: null, location: null, ...fields,
});
const catalogLot = (id, title, itemType, fields = {}) => {
  const raw = lot(id, title, itemType, fields);
  return { ...raw, endsAt: Temporal.Instant.from('1970-01-01T00:00:02Z'), firstSeenAt: Temporal.Instant.from('1970-01-01T00:00:00.005Z') };
};
const reply = (seq, rows, fields = {}) => ({
  seq, full: true, ids: null, lots: rows, now: Date.now(), nextPullAt: Date.now(),
  meta: { fetchedAt: 0, pullStartedAt: 0, count: rows.length, authed: false },
  progress: null, error: null, ...fields,
});

test('title corrections replace the catalog Map and update category matching and counts immediately', () => {
  lots.value = new Map([catalogLot(1, 'Drill', 'battery'), catalogLot(2, 'Drill', 'battery'), catalogLot(3, 'Saw', 'saw'), catalogLot(4, 'DRILL', 'battery')].map((l) => [l.id, l]));
  const previous = lots.peek();
  updateItemType({ title: 'Drill' }, 'drill driver');
  assert.notEqual(lots.peek(), previous);
  assert.deepEqual([...lots.peek().values()].map((l) => l.itemType), ['drill driver', 'drill driver', 'saw', 'battery']);
  assert.equal(previous.get(1).itemType, 'battery');
  const cats = [{ name: 'Tools - Drills', types: ['drill driver'] }];
  assert.equal(categoryOf(lots.peek().get(1), cats).value, 'custom:Tools - Drills');
  assert.equal(computeFacets(lots.peek().values(), Temporal.Instant.from('1970-01-01T00:00:01Z'), cats).categories.find((f) => f.value === 'custom:Tools - Drills').count, 2);
});

test('server type corrections win over a newer websocket price version, including explicit type resets', () => {
  lots.value = new Map([[1, catalogLot(1, 'Drill', 'battery', { version: 9, currentPrice: 42 })]]);
  applyCatalog(reply(2, [lot(1, 'Drill', 'drill driver', { firstSeenAt: 7 })]));
  assert.equal(lots.peek().get(1).currentPrice, 42);
  assert.equal(lots.peek().get(1).version, 9);
  assert.equal(lots.peek().get(1).firstSeenAt.toString(), '1970-01-01T00:00:00.007Z');
  assert.equal(lots.peek().get(1).itemType, 'drill driver');
  applyCatalog(reply(3, [lot(1, 'Drill', undefined)]));
  assert.equal(lots.peek().get(1).itemType, undefined);
});

test('delta replies retain unchanged lots, delete missing ids, and preserve the Map on no-op polls', () => {
  applyCatalog(reply(1, [lot(1, 'Drill', 'drill'), lot(2, 'Saw', 'saw')]));
  const previous = lots.peek();
  applyCatalog(reply(2, [], { full: false, ids: [1, 2] }));
  assert.equal(lots.peek(), previous);
  applyCatalog(reply(3, [lot(3, 'Hammer', 'hammer')], { full: false, ids: [1, 3] }));
  assert.deepEqual([...lots.peek().keys()], [1, 3]);
  assert.equal(lots.peek().get(1), previous.get(1));
  assert.equal(previous.has(2), true);
});

test('invalid catalog timestamps leave the previous catalog intact', () => {
  applyCatalog(reply(1, [lot(1, 'Drill', 'drill')]));
  const previous = lots.peek();
  assert.throws(() => applyCatalog(reply(2, [lot(2, 'Saw', 'saw', { endsAt: 1.5 })])), /Invalid epoch/);
  assert.equal(lots.peek(), previous);
});

test('saving uses the guarded endpoint and applies the canonical server response to all exact titles', async () => {
  lots.value = new Map([catalogLot(1, 'Drill', 'battery'), catalogLot(2, 'Drill', 'battery')].map((l) => [l.id, l]));
  globalThis.fetch = async (path, init) => {
    assert.equal(path, '/api/item-type');
    assert.equal(init.method, 'PUT');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.headers['X-TLX-Client'], '1');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { lotId: 1, itemType: 'Drill Driver' });
    return Response.json({ title: 'Drill', itemType: 'drill driver', seq: 5 });
  };
  assert.equal(await setItemType(1, 'Drill Driver'), 'drill driver');
  assert.equal(lots.peek().get(2).itemType, 'drill driver');
  applyCatalog(reply(4, [lot(1, 'Drill', 'battery'), lot(2, 'Drill', 'battery')]));
  assert.equal(lots.peek().get(1).itemType, 'drill driver');
  applyCatalog(reply(5, [lot(1, 'Drill', 'drill driver'), lot(2, 'Drill', 'drill driver')]));
  applyCatalog(reply(6, [lot(1, 'Drill', 'hammer drill'), lot(2, 'Drill', 'hammer drill')]));
  assert.equal(lots.peek().get(1).itemType, 'hammer drill');
});

test('failed saves surface the API error or connection failure and leave item types unchanged', async () => {
  lots.value = new Map([[1, catalogLot(1, 'Drill', 'battery')]]);
  globalThis.fetch = async () => Response.json({ error: 'No such catalog lot' }, { status: 404 });
  await assert.rejects(setItemType(1, 'drill'), /No such catalog lot/);
  assert.equal(lots.peek().get(1).itemType, 'battery');
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(setItemType(1, 'drill'), /Can’t reach the tlx server/);
  assert.equal(lots.peek().get(1).itemType, 'battery');
});
