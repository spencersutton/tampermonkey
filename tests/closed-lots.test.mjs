import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { fetchClosed } = await vite.ssrLoadModule('/src/app/api.ts');
const { loadDetail, lots: catalogLots } = await vite.ssrLoadModule('/src/app/catalog.ts');
const { openHandler } = await vite.ssrLoadModule('/src/app/util.ts');
const { makeRow } = await vite.ssrLoadModule('/src/app/view.ts');
const { totalCost, costBreakdown } = await vite.ssrLoadModule('/src/shared/cost.ts');

test('closed lots are normalized, deduplicated and reported as pages arrive', async (t) => {
  const first = { lot_id: 1, auction_period: 'a', title: 'Drill', lot_number: '10', location_name: 'Raleigh', final_price: 25, hero_image: null };
  const second = { ...first, lot_id: 2, lot_number: '11', final_price: 30 };
  const pages = [
    { count: 2, results: [first] },
    { count: 2, results: [first, second] },
  ];
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    urls.push(url);
    return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
  });
  const updates = [];
  const lots = await fetchClosed('won', (items, count) => updates.push({ items, count }));
  assert.deepEqual(urls, [
    '/backend/v1/auctions/control-panel/closed/won/?page=1&per_page=100',
    '/backend/v1/auctions/control-panel/closed/won/?page=2&per_page=100',
  ]);
  assert.deepEqual(lots, [
    { lotId: 1, auctionPeriod: 'a', title: 'Drill', lotNumber: '10', locationName: 'Raleigh', finalPrice: 25, heroImage: null },
    { lotId: 2, auctionPeriod: 'a', title: 'Drill', lotNumber: '11', locationName: 'Raleigh', finalPrice: 30, heroImage: null },
  ]);
  assert.deepEqual(updates, [{ items: [lots[0]], count: 2 }, { items: lots, count: 2 }]);
});

test('lot links open in-app only for unhandled, unmodified primary clicks', () => {
  let opened = 0;
  const handle = openHandler(() => opened++);
  for (const change of [{ button: 1 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { defaultPrevented: true }]) {
    let prevented = false;
    handle({ button: 0, ...change, preventDefault: () => { prevented = true; } });
    assert.equal(prevented, false);
  }
  assert.equal(opened, 0);
  let prevented = false;
  handle({ button: 0, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(opened, 1);
});

test('estimated costs use the supplied transfer fee', () => {
  assert.equal(totalCost(100), (100 * 1.15 + 1) * 1.0725);
  assert.equal(totalCost(100, 8), (100 * 1.15 + 1 + 8) * 1.0725);
  assert.match(costBreakdown(100, 8), /\$8\.00 transfer/);
  assert.doesNotMatch(costBreakdown(100), /transfer/);
});

test('a fetched closed lot detail can be used as a row and reused by the modal', async (t) => {
  const raw = {
    id: 4321, auction_period: 'a', title: 'Drill', lot_number: '10', category: null, condition: null,
    location: { id: 1, name: 'Raleigh' }, is_transferable: false, transfer_fee: 0, current_price: 25,
    estimated_retail_price: 50, ends_at: '2025-01-01T00:00:00Z', status: 'closed', version: 1,
    bid_count: 2, next_min_increment: 1, your_standing: null, is_watchlisted: false, has_bid: true,
    images: [], description: 'Details', brand: null, model: null, lot_fee: 1, bid_history: [], similar: [],
  };
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response(JSON.stringify(raw), { status: 200 });
  });
  const detail = await loadDetail({ id: raw.id, auctionPeriod: raw.auction_period });
  const row = makeRow(detail, 'Raleigh', { words: [], filterOn: false, removeFiltered: false, hidden: {}, showHidden: false, customCategories: [] });
  assert.equal(row.lot, detail);
  assert.equal(row.lot.description, 'Details');
  assert.equal(row.transferFee, 0);
  assert.equal(row.retailPct, 0.5);
  assert.equal(await loadDetail(row.lot), detail);
  assert.equal(requests, 1);
  assert.equal(detail.lotFee, 1);

  const { description, brand: _brand, model: _model, lotFee: _lotFee, bidHistory: _bidHistory, similar: _similar, ...base } = detail;
  raw.id++;
  catalogLots.value = new Map([[raw.id, { ...base, id: raw.id, version: 0 }]]);
  const updatedDetail = await loadDetail({ id: raw.id, auctionPeriod: raw.auction_period });
  assert.equal(updatedDetail.description, description);
  const updated = catalogLots.peek().get(raw.id);
  assert.equal(updated.version, 1);
  for (const field of ['description', 'brand', 'model', 'bidHistory', 'similar', 'lotFee']) {
    assert.equal(field in updated, false);
  }
  assert.equal(requests, 2);
});
