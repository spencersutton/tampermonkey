import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { Component, h, options, render } from 'preact';

import { createTestServer } from './vite.mjs';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createTestServer();
after(() => vite.close());
const { lotBrands, lotModels, lotQuantities, lots } = await vite.ssrLoadModule(
  '/src/app/server/catalog.ts',
);
const { onScreen, rowOf } = await vite.ssrLoadModule('/src/app/ui/state.ts');
const { BrandModel, CardBrandModel } = await vite.ssrLoadModule('/src/app/ui/Brands.tsx');
const { LocationText, LotCard, TimeLeft, WatchButton } =
  await vite.ssrLoadModule('/src/app/ui/LotCard.tsx');

const lot = id => ({
  id,
  auction_period: 'test',
  title: `Item ${id}`,
  images: [],
  version: 2,
  category: { value: 'tools', label: 'Tools' },
  condition: { value: 1, display_name: 'New' },
  location: { id: 1, name: 'Raleigh' },
  current_price: 20,
  estimated_retail_price: 0,
  bid_count: 0,
  ends_at: '2030-01-01T00:00:00Z',
});
const settle = () => new Promise(resolve => setImmediate(resolve));
function nodes(node) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const identity = id => nodes(CardBrandModel({ id })).find(node => node.type === BrandModel)?.props;
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

test('card and popup watchlist controls disappear after bidding, without a stale star', async t => {
  const { me } = await vite.ssrLoadModule('/src/app/server/auth.ts');
  const previous = me.peek();
  t.after(() => {
    me.value = previous;
  });
  me.value = { site: { loggedIn: true } };
  const star = item => {
    const node = nodes(card(rowOf(item))()).find(node => node.type.name === 'WatchStar');
    assert.ok(node);
    return node.type(node.props);
  };

  for (const isWatchlisted of [false, true]) {
    const item = { ...lot(90), is_watchlisted: isWatchlisted, bid_count: 3 };
    assert.equal(star(item).type, 'button', 'other bidders do not hide the control');
    assert.equal(WatchButton({ lot: item }).props['aria-pressed'], isWatchlisted);
    for (const bid of [
      { has_bid: true },
      { your_standing: { is_leading: true, your_max_bid: 30 } },
      { your_standing: { is_leading: false, your_max_bid: 15 } },
    ]) {
      const bidOn = { ...item, ...bid };
      assert.equal(star(bidOn), null);
      assert.equal(WatchButton({ lot: bidOn }), null);
    }
  }
});

test('mounted cards retain independent viewport observers without fetching details on scroll', async t => {
  class Element {
    childNodes = [];
    /** @type {Element | null} */
    parentNode = null;
    attributes = [];
    dataset = {};
    get firstChild() {
      return this.childNodes[0] ?? null;
    }
    get isConnected() {
      return this.parentNode != null;
    }
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
    setAttribute(name, value) {
      if (name === 'data-lot') this.dataset.lot = String(value);
    }
    removeAttribute() {}
  }
  const observed = new Set();
  let intersect;
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      intersect = callback;
    }
    observe(element) {
      observed.add(element);
    }
    unobserve(element) {
      observed.delete(element);
    }
  };
  globalThis.document = { createElementNS: () => new Element() };
  const root = new Element();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  lots.value = new Map([20, 21, 22].map(id => [id, lot(id)]));
  onScreen.value = [];
  t.after(() => {
    render(null, root);
    onScreen.value = [];
    delete globalThis.document;
    delete globalThis.IntersectionObserver;
  });
  const cards = [20, 21, 22].map(id => card(rowOf(lots.peek().get(id))));
  const refs = cards.map(draw => draw().ref);
  assert.equal(new Set(refs).size, 3, 'each card owns its ref cleanup');
  const drawArticles = () =>
    cards.map((draw, index) => {
      const tree = draw();
      assert.equal(tree.ref, refs[index], 'the ref stays stable on rerender');
      return h('article', { key: index, ref: tree.ref, 'data-lot': tree.props['data-lot'] });
    });
  render(drawArticles(), root);
  assert.equal(observed.size, 3, 'mounting later cards must not unobserve earlier ones');
  intersect([...observed].map(target => ({ target, isIntersecting: target.dataset.lot !== '22' })));
  t.mock.timers.tick(150);
  await settle();
  assert.deepEqual(onScreen.peek(), [20, 21]);
  render(drawArticles(), root);
  assert.equal(observed.size, 3);
  render(drawArticles().slice(1), root);
  assert.deepEqual(
    [...observed].map(element => element.dataset.lot),
    ['21', '22'],
  );
  t.mock.timers.tick(150);
  assert.deepEqual(onScreen.peek(), [21], 'unmount only removes its own card');
});

test('brands and known missing brands survive a fresh app module load without detail requests', async t => {
  const fresh = await createTestServer();
  t.after(() => fresh.close());
  const catalog = await fresh.ssrLoadModule('/src/app/server/catalog.ts');
  const brandsUi = await fresh.ssrLoadModule('/src/app/ui/Brands.tsx');
  const source = await fresh.ssrLoadModule('/src/app/server/source.ts');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    throw new Error('Unexpected detail request');
  });
  const now = Date.now();
  source.applyCatalog({
    now,
    nextPullAt: now + 60_000,
    meta: { fetchedAt: now },
    progress: null,
    error: null,
    seq: 1,
    full: true,
    ids: null,
    lots: [90, 91].map(id => ({
      ...lot(id),
      ends_at: lot(id).ends_at,
      brand: id === 90 ? 'Persisted' : null,
      model: id === 90 ? 'D-90' : null,
    })),
  });
  await settle();
  assert.equal(requests, 0);
  assert.equal(catalog.lotBrands.peek().get(90), 'Persisted');
  assert.equal(catalog.lotBrands.peek().get(91), null);
  assert.equal(catalog.lotModels.peek().get(90), 'D-90');
  assert.equal(catalog.lotModels.peek().get(91), null);
  const savedIdentity = nodes(brandsUi.CardBrandModel({ id: 90 })).find(
    node => node.type === brandsUi.BrandModel,
  );
  assert.deepEqual(savedIdentity.props, { brand: 'Persisted', model: 'D-90' });
  assert.equal(brandsUi.CardBrandModel({ id: 91 }), null);
  source.applyCatalog({
    now,
    nextPullAt: now + 60_000,
    meta: { fetchedAt: now },
    progress: null,
    error: null,
    seq: 2,
    full: false,
    ids: [90, 91],
    lots: [
      {
        ...lot(90),
        version: 1,
        ends_at: lot(90).ends_at,
        brand: 'Updated on another device',
        model: 'D-91',
      },
    ],
  });
  assert.equal(
    catalog.lots.peek().get(90).version,
    2,
    'older catalog prices cannot replace newer live prices',
  );
  assert.equal(
    catalog.lotBrands.peek().get(90),
    'Updated on another device',
    'cached brands still update through deltas',
  );
  assert.equal(catalog.lotBrands.peek().get(91), null, 'unchanged brands survive delta replies');
  assert.equal(
    catalog.lotModels.peek().get(90),
    'D-91',
    'models update even when live prices are newer',
  );
  source.applyCatalog({
    now,
    nextPullAt: now + 60_000,
    meta: { fetchedAt: now },
    progress: null,
    error: null,
    seq: 3,
    full: false,
    ids: [90, 91],
    lots: [
      {
        ...lot(90),
        ends_at: lot(90).ends_at,
        brand: 'Updated on another device',
        model: null,
      },
    ],
  });
  assert.equal(catalog.lotModels.peek().get(90), null, 'removed models disappear from cards');
  assert.equal(requests, 0, 'known missing models do not trigger more requests');
});

test('brand and model names link to the catalog and a separate Google icon retains web search', () => {
  lotBrands.value = new Map(lotBrands.peek()).set(80, null);
  lotModels.value = new Map(lotModels.peek()).set(80, 'D/80 & XL');
  assert.deepEqual(identity(80), { brand: null, model: 'D/80 & XL' });
  for (const [brand, model, query] of [
    [null, 'D/80 & XL', 'D/80 & XL'],
    ['Acme', null, 'Acme'],
    ['Acme', 'D-80', 'Acme D-80'],
  ]) {
    const tree = BrandModel({ brand, model });
    const links = nodes(tree).filter(node => node.type === 'a');
    const link = links.find(node => node.props.target === '_blank');
    assert.equal(link.props.href, `https://www.google.com/search?q=${encodeURIComponent(query)}`);
    assert.equal(text(link).trim(), '');
    assert.equal(link.props['aria-label'], `Search Google for “${query}”`);
    assert.equal(link.props.rel, 'noopener');
    assert.equal(link.props.children.props.name, 'google');
    const catalog = links.filter(node => !node.props.target);
    assert.deepEqual(catalog.map(text), [brand, model].filter(Boolean));
    assert.deepEqual(
      catalog.map(node => new URLSearchParams(node.props.href.slice(1)).get('search')),
      [
        brand && `brand:"${brand}"`,
        model && [brand && `brand:"${brand}"`, `model:"${model}"`].filter(Boolean).join(' '),
      ].filter(Boolean),
    );
    assert.deepEqual(
      nodes(tree)
        .filter(node => node.type === 'dt')
        .map(text),
      [brand && 'Brand', model && 'Model'].filter(Boolean),
    );
  }
  assert.equal(BrandModel({ brand: null, model: null }), null);
});

test('brand/model navigation clears filters and the popup, with quoted field-specific searches', async t => {
  const { DEFAULT_VIEW, makeMatcher } = await vite.ssrLoadModule('/src/app/logic/view.ts');
  const { navFromUrl } = await vite.ssrLoadModule('/src/app/ui/history.ts');
  const { setView, storedView, searchDraft, openId, closed, filteredOnly, page, sidebarOpen } =
    await vite.ssrLoadModule('/src/app/ui/state.ts');
  const previousWindow = globalThis.window;
  let scrolls = 0;
  globalThis.window = {
    scrollTo: () => {
      scrolls++;
    },
  };
  t.after(() => {
    globalThis.window = previousWindow;
  });
  const brand = 'Black & "Decker" \\ Tools';
  const model = 'D\\80 "XL" kit';
  for (const label of [brand, model]) {
    setView({
      ...DEFAULT_VIEW,
      search: 'unrelated',
      searchRegex: true,
      categories: ['garden'],
      priceMax: 1,
      mine: 'watch',
      newSince: Date.now(),
      sort: 'total-desc',
    });
    openId.value = 90;
    closed.value = 'won';
    filteredOnly.value = true;
    sidebarOpen.value = true;
    page.value = 3;
    const link = nodes(BrandModel({ brand, model })).find(
      node => node.type === 'a' && text(node) === label,
    );
    const nav = navFromUrl(link.props.href);
    const before = storedView.value;
    link.props.onClick({ button: 0, ctrlKey: true });
    assert.equal(storedView.value, before, 'modified clicks use the catalog URL in a new tab');
    let prevented = false;
    link.props.onClick({
      button: 0,
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.deepEqual(storedView.value, {
      ...DEFAULT_VIEW,
      sort: 'total-desc',
      search: nav.view.search,
    });
    assert.deepEqual(storedView.value, nav.view, 'normal clicks and new-tab URLs agree');
    assert.equal(searchDraft.value, nav.view.search);
    assert.equal(openId.value, null);
    assert.equal(closed.value, null);
    assert.equal(filteredOnly.value, false);
    assert.equal(sidebarOpen.value, false);
    assert.equal(page.value, 1);
    const matches = makeMatcher(storedView.value, Date.now());
    assert.equal(matches(rowOf({ ...lot(90), brand, model })), true);
    assert.equal(matches(rowOf({ ...lot(91), brand, model: 'Different model' })), label === brand);
    assert.equal(matches(rowOf({ ...lot(92), brand: 'Other brand', model })), false);
  }
  assert.equal(scrolls, 2);
});

test('cards show condition, location, lot number, pricing, retail comparison and time compactly', () => {
  const item = {
    ...lot(82),
    lot_number: 'A-82',
    condition: { value: 1, display_name: 'Like New' },
    location: { id: 1, name: 'Raleigh' },
    estimated_retail_price: 100,
    bid_count: 3,
  };
  const tree = card(rowOf(item))();
  const all = nodes(tree);
  const byClass = name => all.find(node => node.props?.class === name);
  assert.equal(text(byClass('card-condition')), 'Like New');
  const location = nodes(byClass('card-location')).find(node => node.type === LocationText);
  assert.equal(text(LocationText(location.props)), 'Raleigh');
  assert.equal(byClass('price').props.title, 'Current bid');
  assert.match(text(byClass('card-total')), /total$/);
  assert.equal(text(byClass('card-retail-pct')).trim(), '(24%)');
  assert.match(text(byClass('card-sub')), /3 bids/);
  assert.ok(nodes(byClass('card-sub')).some(node => node.type === TimeLeft));
  const sparse = card(rowOf(lot(83)))();
  assert.match(text(sparse), /No retail estimate/);
});

test('cards show a quantity pill only for multi-unit lots and detail modal always shows quantity when known', async t => {
  const { LotModal } = await vite.ssrLoadModule('/src/app/ui/LotModal.tsx');
  const previous = lotQuantities.peek();
  t.after(() => {
    lotQuantities.value = previous;
  });

  const cardQty = item => {
    const node = nodes(card(rowOf(item))()).find(n => n.type?.name === 'CardQuantity');
    assert.ok(node);
    return node.type(node.props);
  };

  lotQuantities.value = new Map([
    [84, 6],
    [85, 1],
    [86, null],
  ]);

  const multi = cardQty(lot(84));
  assert.equal(multi.props.class, 'pill pill-qty');
  assert.equal(text(multi), 'Qty 6');
  assert.equal(cardQty(lot(85)), null, 'single-unit lots omit the card pill');
  assert.equal(cardQty(lot(86)), null, 'unknown quantities omit the card pill');

  const modalMeta = item => {
    const modal = LotModal({ row: rowOf(item), onClose: () => {} });
    const contentVnode = modal.props.children;
    contentVnode.__c = new Component(contentVnode.props);
    options.__r(contentVnode);
    const tree = contentVnode.type(contentVnode.props);
    options.diffed(contentVnode);
    return text(nodes(tree).find(n => n.props?.class === 'card-meta'));
  };

  assert.match(modalMeta({ ...lot(84), lot_number: '84' }), /Qty 6/);
  assert.match(modalMeta({ ...lot(85), lot_number: '85' }), /Qty 1/);
  assert.doesNotMatch(modalMeta({ ...lot(86), lot_number: '86' }), /Qty/);
});
