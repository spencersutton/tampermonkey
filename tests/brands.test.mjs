import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { lotBrands, lots, loadDetail, invalidateDetail } = await vite.ssrLoadModule('/src/app/catalog.ts');
const { onScreen, rowOf } = await vite.ssrLoadModule('/src/app/state.ts');
const { applyCatalog } = await vite.ssrLoadModule('/src/app/source.ts');
const { CardBrand, startBrandWatch } = await vite.ssrLoadModule('/src/app/brands.tsx');
const { LotCard } = await vite.ssrLoadModule('/src/app/LotCard.tsx');

const raw = (id, brand) => ({
  id, auction_period: 'test', title: `Item ${id}`, lot_number: `${id}`, brand,
  ends_at: '2030-01-01T00:00:00Z', images: [], version: 1,
});
const lot = (id) => ({
  id, auctionPeriod: 'test', title: `Item ${id}`, images: [], version: 2,
  currentPrice: 20, bidCount: 0, endsAt: Temporal.Instant.from('2030-01-01T00:00:00Z'),
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
function nodes(node) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

test('visible cards load brands with bounded concurrency, caching, and no price regression', async (t) => {
  const requests = [];
  const replies = new Map();
  t.mock.method(globalThis, 'fetch', (url) => {
    const id = Number(url.split('/').at(-2));
    requests.push(id);
    return new Promise((resolve) => replies.set(id, (brand) => resolve(Response.json(raw(id, brand)))));
  });
  lots.value = new Map([1, 2, 3, 4].map((id) => [id, lot(id)]));
  onScreen.value = [];
  const stop = startBrandWatch();
  t.after(() => { stop(); onScreen.value = []; });
  assert.deepEqual(requests, []);
  onScreen.value = [1, 2, 3];
  await settle();
  assert.deepEqual(requests, [1, 2]);
  // Opening the popup shares the brand request.
  const detail = loadDetail(lot(1));
  replies.get(1)('  Acme & Co.  ');
  await detail;
  await settle();
  assert.deepEqual(requests, [1, 2, 3]);
  assert.equal(lotBrands.peek().get(1), 'Acme & Co.');
  assert.equal(lots.peek().get(1).currentPrice, 20);
  assert.equal(lots.peek().get(1).version, 2);
  assert.deepEqual(CardBrand({ id: 1 }).props.children.props.children, ['Brand: ', 'Acme & Co.']);

  replies.get(2)(null);
  replies.get(3)('   ');
  await settle();
  assert.equal(CardBrand({ id: 2 }), null);
  assert.equal(CardBrand({ id: 3 }), null);
  assert.equal(lotBrands.peek().has(2), true);
  assert.equal(lotBrands.peek().has(3), true);

  invalidateDetail(1);
  onScreen.value = [];
  const now = Date.now();
  applyCatalog({
    now, nextPullAt: now + 60_000, meta: { fetchedAt: now }, progress: null, error: null,
    seq: 1, full: true, ids: null,
    lots: [...lots.peek().values()].map((item) => ({ ...item, endsAt: item.endsAt.epochMilliseconds })),
  });
  onScreen.value = [1, 2, 3];
  assert.deepEqual(requests, [1, 2, 3], 'polls, expired details and revisits do not refetch known brands');
  assert.equal(lotBrands.peek().get(1), 'Acme & Co.');

  const vnode = LotCard.call({}, { row: rowOf(lots.peek().get(1)) });
  const brandNode = nodes(vnode.type(vnode.props)).find((node) => node.type === CardBrand);
  assert.equal(brandNode.props.id, 1);
});

test('queued cards that leave the viewport are skipped; failures are visible and retryable', async (t) => {
  const requests = [];
  const replies = new Map();
  t.mock.method(globalThis, 'fetch', (url) => {
    const id = Number(url.split('/').at(-2));
    requests.push(id);
    return new Promise((resolve) => replies.set(id, resolve));
  });
  lots.value = new Map([10, 11, 12].map((id) => [id, lot(id)]));
  onScreen.value = [10, 11, 12];
  const stop = startBrandWatch();
  t.after(() => { stop(); onScreen.value = []; });
  await settle();
  assert.deepEqual(requests, [10, 11]);
  onScreen.value = [10];
  replies.get(10)(new Response('Unavailable', { status: 503 }));
  replies.get(11)(Response.json(raw(11, 'Other')));
  await settle();
  assert.deepEqual(requests, [10, 11]);
  const button = CardBrand({ id: 10 }).props.children;
  assert.match(button.props.title, /503/);
  assert.equal(button.props.children, 'Brand unavailable - Retry');
  button.props.onClick();
  await settle();
  assert.deepEqual(requests, [10, 11, 10]);
  replies.get(10)(Response.json(raw(10, 'Recovered')));
  await settle();
  assert.equal(lotBrands.peek().get(10), 'Recovered');
  assert.deepEqual(CardBrand({ id: 10 }).props.children.props.children, ['Brand: ', 'Recovered']);
});
