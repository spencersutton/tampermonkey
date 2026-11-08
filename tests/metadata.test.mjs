import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { cachedDetail, cachedMetadata, invalidateDetail, loadDetail, loadMetadata, lots, updateLot } = await vite.ssrLoadModule('/src/app/catalog.ts');
const { me } = await vite.ssrLoadModule('/src/app/auth.tsx');
const { normalizeLot } = await vite.ssrLoadModule('/src/app/api.ts');
const raw = (id, patch = {}) => ({
  id, auction_period: 'test', title: 'Drill', ends_at: '2030-01-01T00:00:00Z', images: [],
  version: 2, current_price: 20, bid_count: 1, next_min_increment: 21,
  description: 'Fresh description', brand: 'Acme', model: 'D1', lot_fee: 2,
  bid_history: [{ bidder_label: 'Bidder', amount: 20, is_you: false }], similar: [], ...patch,
});
const saved = { description: 'Saved description', brand: 'Acme', model: 'D1', lotFee: 2, images: [] };
const lot = (id) => ({ id, auctionPeriod: 'test' });

test('saved metadata arrives before live details, without changing price or account state', async (t) => {
  let live;
  const requests = [];
  t.mock.method(globalThis, 'fetch', (url) => {
    requests.push(url);
    if (url.startsWith('/api/lot-metadata?')) return Promise.resolve(Response.json({ metadata: saved }));
    return new Promise((resolve) => { live = resolve; });
  });
  const current = normalizeLot(raw(101, { version: 1, current_price: 10 }));
  lots.value = new Map([[101, current]]);
  const metadata = loadMetadata(lot(101));
  assert.equal(loadMetadata(lot(101)), metadata, 'concurrent metadata requests are shared');
  const fresh = loadDetail(lot(101));
  assert.deepEqual(await metadata, saved);
  assert.equal(lots.peek().get(101), current);
  assert.equal(cachedDetail(101), undefined);
  assert.equal(cachedMetadata(101).description, 'Saved description');
  live(Response.json(raw(101)));
  await fresh;
  assert.equal(cachedMetadata(101).description, 'Fresh description');
  assert.equal(lots.peek().get(101).currentPrice, 20);
  assert.equal(cachedDetail(101).bidHistory.length, 1);
  assert.deepEqual(requests, ['/api/lot-metadata?id=101&auctionPeriod=test', '/backend/v1/auctions/lots/test/101/']);
});

test('auction expiry and bid invalidation retain reusable metadata but not stale bid history', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(raw(102)));
  await loadDetail(lot(102));
  const item = cachedMetadata(102);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 121_000);
  assert.equal(cachedDetail(102), undefined);
  assert.equal(await loadMetadata(lot(102)), item);
  invalidateDetail(102);
  assert.equal(cachedMetadata(102), item);
  assert.equal(cachedDetail(102), undefined);
});

test('new live versions bypass the short-lived auction cache and never roll prices backward', async (t) => {
  let version = 2;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json(raw(103, { version })); });
  lots.value = new Map([[103, normalizeLot(raw(103))]]);
  await loadDetail(lot(103));
  await loadDetail(lot(103));
  assert.equal(requests, 1);
  updateLot(103, { version: 3, currentPrice: 40 });
  assert.equal(cachedDetail(103), undefined);
  await loadDetail(lot(103));
  assert.equal(requests, 2);
  assert.equal(lots.peek().get(103).currentPrice, 40);
  assert.equal(cachedDetail(103), undefined);
  version = 4;
  await loadDetail(lot(103));
  assert.equal(cachedDetail(103).version, 4);
});

test('late cached responses cannot replace freshly fetched metadata', async (t) => {
  let resolveSaved;
  t.mock.method(globalThis, 'fetch', (url) => url.startsWith('/api/')
    ? new Promise((resolve) => { resolveSaved = resolve; })
    : Promise.resolve(Response.json(raw(104))));
  const pending = loadMetadata(lot(104));
  await loadDetail(lot(104));
  resolveSaved(Response.json({ metadata: saved }));
  assert.equal((await pending).description, 'Fresh description');
  assert.equal(cachedMetadata(104).description, 'Fresh description');
});

test('metadata errors are explicit, retryable, and do not erase saved details after a live refresh failure', async (t) => {
  let failCache = true;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.startsWith('/api/')) return failCache
      ? new Response('Unavailable', { status: 503 })
      : Response.json({ metadata: saved });
    throw new Error('Offline');
  });
  await assert.rejects(loadMetadata(lot(105)), /503/);
  failCache = false;
  await loadMetadata(lot(105));
  await assert.rejects(loadDetail(lot(105)), /Offline/);
  assert.equal(cachedMetadata(105).description, 'Saved description');
  assert.equal(cachedDetail(105), undefined);
});

test('login changes invalidate auction data and late requests without losing static details', async (t) => {
  const replies = [];
  t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => replies.push(resolve)));
  const initial = loadDetail(lot(106));
  await new Promise((resolve) => setImmediate(resolve));
  replies.shift()(Response.json(raw(106)));
  await initial;
  const item = cachedMetadata(106);
  me.value = { app: { locked: false, password: false }, site: { loggedIn: true }, version: 'test' };
  assert.equal(cachedDetail(106), undefined);
  assert.equal(cachedMetadata(106), item);
  const old = loadDetail(lot(106));
  await new Promise((resolve) => setImmediate(resolve));
  me.value = { ...me.peek(), site: { loggedIn: false } };
  replies.shift()(Response.json(raw(106, { your_standing: { is_leading: true, your_max_bid: 100 } })));
  await old;
  assert.equal(cachedDetail(106), undefined, 'an old account response cannot repopulate the cache');
});
