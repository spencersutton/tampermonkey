import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';
import { Component, h, options, render } from 'preact';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { lotBrands, lotModels, lots, loadDetail, invalidateDetail } = await vite.ssrLoadModule('/src/app/catalog.ts');
const { onScreen, rowOf } = await vite.ssrLoadModule('/src/app/state.ts');
const { applyCatalog } = await vite.ssrLoadModule('/src/app/source.ts');
const { BrandModel, CardBrandModel, startBrandWatch } = await vite.ssrLoadModule('/src/app/brands.tsx');
const { LocationText, LotCard } = await vite.ssrLoadModule('/src/app/LotCard.tsx');

const raw = (id, brand, model = null) => ({
  id, auction_period: 'test', title: `Item ${id}`, lot_number: `${id}`, brand, model,
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
const identity = (id) => nodes(CardBrandModel({ id })).find((node) => node.type === BrandModel)?.props;
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}

function card(row) {
  const vnode = LotCard.call({}, { row });
  vnode.__c = new Component(vnode.props);
  return () => {
    options.__r(vnode);
    const tree = vnode.type(vnode.props);
    options.diffed(vnode);
    return tree;
  };
}

test('visible cards load brands with bounded concurrency, caching, and no price regression', async (t) => {
  const requests = [];
  const replies = new Map();
  t.mock.method(globalThis, 'fetch', (url) => {
    const id = Number(url.split('/').at(-2));
    requests.push(id);
    return new Promise((resolve) => replies.set(id, (brand, model) => resolve(Response.json(raw(id, brand, model)))));
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
  replies.get(1)('  Acme & Co.  ', '  D-100  ');
  await detail;
  await settle();
  assert.deepEqual(requests, [1, 2, 3]);
  assert.equal(lotBrands.peek().get(1), 'Acme & Co.');
  assert.equal(lots.peek().get(1).currentPrice, 20);
  assert.equal(lots.peek().get(1).version, 2);
  assert.deepEqual(identity(1), { brand: 'Acme & Co.', model: 'D-100' });
  assert.equal(lotModels.peek().get(1), 'D-100');

  replies.get(2)(null);
  replies.get(3)('   ', '   ');
  await settle();
  assert.equal(CardBrandModel({ id: 2 }), null);
  assert.equal(CardBrandModel({ id: 3 }), null);
  assert.equal(lotModels.peek().get(2), null);
  assert.equal(lotModels.peek().get(3), null);
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
  assert.equal(lotModels.peek().get(1), 'D-100');

  const brandNode = nodes(card(rowOf(lots.peek().get(1)))()).find((node) => node.type === CardBrandModel);
  assert.equal(brandNode.props.id, 1);
});

test('mounted cards retain independent viewport observers and fetch brands without clicking', async (t) => {
  class Element {
    childNodes = [];
    parentNode = null;
    attributes = [];
    dataset = {};
    get firstChild() { return this.childNodes[0] ?? null; }
    get isConnected() { return this.parentNode != null; }
    insertBefore(child, before) {
      child.parentNode?.removeChild(child);
      const index = before ? this.childNodes.indexOf(before) : -1;
      this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
      child.parentNode = this;
    }
    removeChild(child) {
      this.childNodes.splice(this.childNodes.indexOf(child), 1);
      child.parentNode = null;
    }
    setAttribute(name, value) { if (name === 'data-lot') this.dataset.lot = String(value); }
    removeAttribute() {}
  }
  const observed = new Set();
  let intersect;
  globalThis.IntersectionObserver = class {
    constructor(callback) { intersect = callback; }
    observe(element) { observed.add(element); }
    unobserve(element) { observed.delete(element); }
  };
  globalThis.document = { createElementNS: () => new Element() };
  const root = new Element();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const id = Number(url.split('/').at(-2));
    requests.push(id);
    return Response.json(raw(id, `Brand ${id}`));
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  lots.value = new Map([20, 21, 22].map((id) => [id, lot(id)]));
  onScreen.value = [];
  const stop = startBrandWatch();
  t.after(() => {
    stop();
    render(null, root);
    onScreen.value = [];
    delete globalThis.document;
    delete globalThis.IntersectionObserver;
  });
  const cards = [20, 21, 22].map((id) => card(rowOf(lots.peek().get(id))));
  const refs = cards.map((draw) => draw().ref);
  assert.equal(new Set(refs).size, 3, 'each card owns its ref cleanup');
  const drawArticles = () => cards.map((draw, index) => {
    const tree = draw();
    assert.equal(tree.ref, refs[index], 'the ref stays stable on rerender');
    return h('article', { key: index, ref: tree.ref, 'data-lot': tree.props['data-lot'] });
  });
  render(drawArticles(), root);
  assert.equal(observed.size, 3, 'mounting later cards must not unobserve earlier ones');
  intersect([...observed].map((target) => ({ target, isIntersecting: target.dataset.lot !== '22' })));
  t.mock.timers.tick(150);
  await settle();
  assert.deepEqual(onScreen.peek(), [20, 21]);
  assert.deepEqual(requests, [20, 21], 'only nearby cards fetch, without any click');
  assert.equal(lotBrands.peek().get(20), 'Brand 20');
  assert.equal(lotBrands.peek().get(21), 'Brand 21');
  render(drawArticles(), root);
  assert.equal(observed.size, 3);
  render(drawArticles().slice(1), root);
  assert.deepEqual([...observed].map((element) => element.dataset.lot), ['21', '22']);
  t.mock.timers.tick(150);
  assert.deepEqual(onScreen.peek(), [21], 'unmount only removes its own card');
});

test('brands and known missing brands survive a fresh app module load without detail requests', async (t) => {
  const fresh = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
  t.after(() => fresh.close());
  const catalog = await fresh.ssrLoadModule('/src/app/catalog.ts');
  const state = await fresh.ssrLoadModule('/src/app/state.ts');
  const brands = await fresh.ssrLoadModule('/src/app/brands.tsx');
  const source = await fresh.ssrLoadModule('/src/app/source.ts');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected detail request'); });
  state.onScreen.value = [90, 91];
  const stop = brands.startBrandWatch();
  t.after(stop);
  const now = Date.now();
  source.applyCatalog({
    now, nextPullAt: now + 60_000, meta: { fetchedAt: now }, progress: null, error: null,
    seq: 1, full: true, ids: null,
    lots: [90, 91].map((id) => ({
      ...lot(id), endsAt: lot(id).endsAt.epochMilliseconds,
      brand: id === 90 ? 'Persisted' : null, model: id === 90 ? 'D-90' : null,
    })),
  });
  await settle();
  assert.equal(requests, 0);
  assert.equal(catalog.lotBrands.peek().get(90), 'Persisted');
  assert.equal(catalog.lotBrands.peek().get(91), null);
  assert.equal(catalog.lotModels.peek().get(90), 'D-90');
  assert.equal(catalog.lotModels.peek().get(91), null);
  const savedIdentity = nodes(brands.CardBrandModel({ id: 90 })).find((node) => node.type === brands.BrandModel);
  assert.deepEqual(savedIdentity.props, { brand: 'Persisted', model: 'D-90' });
  assert.equal(brands.CardBrandModel({ id: 91 }), null);
  source.applyCatalog({
    now, nextPullAt: now + 60_000, meta: { fetchedAt: now }, progress: null, error: null,
    seq: 2, full: false, ids: [90, 91],
    lots: [{ ...lot(90), version: 1, endsAt: lot(90).endsAt.epochMilliseconds, brand: 'Updated on another device', model: 'D-91' }],
  });
  assert.equal(catalog.lots.peek().get(90).version, 2, 'older catalog prices cannot replace newer live prices');
  assert.equal(catalog.lotBrands.peek().get(90), 'Updated on another device', 'cached brands still update through deltas');
  assert.equal(catalog.lotBrands.peek().get(91), null, 'unchanged brands survive delta replies');
  assert.equal(catalog.lotModels.peek().get(90), 'D-91', 'models update even when live prices are newer');
  source.applyCatalog({
    now, nextPullAt: now + 60_000, meta: { fetchedAt: now }, progress: null, error: null,
    seq: 3, full: false, ids: [90, 91],
    lots: [{ ...lot(90), endsAt: lot(90).endsAt.epochMilliseconds, brand: 'Updated on another device', model: null }],
  });
  assert.equal(catalog.lotModels.peek().get(90), null, 'removed models disappear from cards');
  assert.equal(requests, 0, 'known missing models do not trigger more requests');
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
  const button = nodes(CardBrandModel({ id: 10 })).find((node) => node.type === 'button');
  assert.match(button.props.title, /503/);
  assert.equal(button.props.children, 'Item details unavailable - Retry');
  button.props.onClick();
  await settle();
  assert.deepEqual(requests, [10, 11, 10]);
  replies.get(10)(Response.json(raw(10, 'Recovered', 'R-10')));
  await settle();
  assert.equal(lotBrands.peek().get(10), 'Recovered');
  assert.deepEqual(identity(10), { brand: 'Recovered', model: 'R-10' });
});

test('model-only cards render and search the model; brand-only cards retain brand search', () => {
  lotBrands.value = new Map(lotBrands.peek()).set(80, null);
  lotModels.value = new Map(lotModels.peek()).set(80, 'D/80 & XL');
  assert.deepEqual(identity(80), { brand: null, model: 'D/80 & XL' });
  for (const [brand, model, query] of [
    [null, 'D/80 & XL', 'D/80 & XL'],
    ['Acme', null, 'Acme'],
    ['Acme', 'D-80', 'Acme D-80'],
  ]) {
    const tree = BrandModel({ brand, model });
    const link = nodes(tree).find((node) => node.type === 'a');
    assert.equal(link.props.href, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    assert.equal(text(link).trim(), model ?? brand);
    assert.deepEqual(nodes(tree).filter((node) => node.type === 'dt').map(text), [brand && 'Brand', model && 'Model'].filter(Boolean));
  }
  assert.equal(BrandModel({ brand: null, model: null }), null);
});

test('a known brand without a cached model still loads its model', async (t) => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return Response.json(raw(81, 'Acme', 'D-81'));
  });
  lotBrands.value = new Map(lotBrands.peek()).set(81, 'Acme');
  lots.value = new Map([[81, lot(81)]]);
  onScreen.value = [81];
  const stop = startBrandWatch();
  t.after(() => { stop(); onScreen.value = []; });
  await settle();
  assert.equal(requests, 1);
  assert.deepEqual(identity(81), { brand: 'Acme', model: 'D-81' });
});

test('cards clearly label condition, lot number, pricing, retail comparison and time', () => {
  const item = {
    ...lot(82), lotNumber: 'A-82', condition: { value: 1, label: 'Like New' },
    location: { id: 1, name: 'Raleigh' }, estimatedRetailPrice: 100, bidCount: 3,
  };
  const tree = card(rowOf(item))();
  const all = nodes(tree);
  const byClass = (name) => all.find((node) => node.props?.class === name);
  assert.equal(text(byClass('card-condition')), 'Like New');
  assert.equal(text(byClass('card-lot-number')), 'Lot #A-82');
  const location = nodes(byClass('card-location')).find((node) => node.type === LocationText);
  assert.equal(text(LocationText(location.props)), 'Raleigh');
  assert.deepEqual(nodes(byClass('card-price')).filter((node) => node.type === 'dt').map(text), ['Current bid', 'Est. total']);
  assert.equal(text(byClass('card-retail-pct')), 'Bid is 20% of retail');
  assert.match(text(byClass('card-sub')), /3 bids/);
  assert.equal(text(byClass('card-ending')), 'Time left');
  const sparse = card(rowOf(lot(83)))();
  assert.equal(nodes(sparse).some((node) => node.props?.class === 'card-condition'), false);
  assert.equal(nodes(sparse).some((node) => node.props?.class === 'card-lot-number'), false);
  assert.match(text(sparse), /No retail estimate/);
});
