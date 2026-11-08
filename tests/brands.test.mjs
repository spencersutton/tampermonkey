import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';
import { Component, h, options, render } from 'preact';

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

  const brandNode = nodes(card(rowOf(lots.peek().get(1)))()).find((node) => node.type === CardBrand);
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
    lots: [90, 91].map((id) => ({ ...lot(id), endsAt: lot(id).endsAt.epochMilliseconds, brand: id === 90 ? 'Persisted' : null })),
  });
  await settle();
  assert.equal(requests, 0);
  assert.equal(catalog.lotBrands.peek().get(90), 'Persisted');
  assert.equal(catalog.lotBrands.peek().get(91), null);
  assert.deepEqual(brands.CardBrand({ id: 90 }).props.children.props.children, ['Brand: ', 'Persisted']);
  assert.equal(brands.CardBrand({ id: 91 }), null);
  source.applyCatalog({
    now, nextPullAt: now + 60_000, meta: { fetchedAt: now }, progress: null, error: null,
    seq: 2, full: false, ids: [90, 91],
    lots: [{ ...lot(90), version: 1, endsAt: lot(90).endsAt.epochMilliseconds, brand: 'Updated on another device' }],
  });
  assert.equal(catalog.lots.peek().get(90).version, 2, 'older catalog prices cannot replace newer live prices');
  assert.equal(catalog.lotBrands.peek().get(90), 'Updated on another device', 'cached brands still update through deltas');
  assert.equal(catalog.lotBrands.peek().get(91), null, 'unchanged brands survive delta replies');
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
