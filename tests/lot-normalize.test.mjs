// src/shared/lot.ts: the one normalizer for the site's raw lots.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

import { rawLot } from './raw-lot.mjs';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const wire = await vite.ssrLoadModule('/src/shared/lot.ts');
const api = await vite.ssrLoadModule('/src/app/api.ts');

const image = (position, name) => ({
  position,
  image_thumb: `${name}-t`,
  image_card: `${name}-c`,
  image_large: `${name}-l`,
});

test('raw lots normalize with times as epoch ms and images in order', () => {
  const lot = wire.normalizeLot(
    rawLot({
      id: 7,
      auction_period: 'p1',
      condition: { value: 2, display_name: 'Like New' },
      current_price: Number.NaN,
      ends_at: '2026-01-02T03:04:05.678Z',
      your_standing: { is_leading: true },
      images: [image(2, 'b'), image(0, 'a'), image(1, 'c')],
    }),
  );
  assert.deepEqual(lot.condition, { value: 2, label: 'Like New' });
  assert.equal(lot.currentPrice, 0, 'non-finite numbers fall back');
  assert.equal(lot.endsAt, Date.UTC(2026, 0, 2, 3, 4, 5, 678));
  assert.deepEqual(lot.yourStanding, { isLeading: true, yourMaxBid: null });
  assert.deepEqual(
    lot.images.map((i) => i.card),
    ['a-c', 'c-c', 'b-c'],
  );
  assert.equal(wire.normalizeLot(rawLot({ ends_at: 'not a time' })).endsAt, null);
});

test('details add their item fields, and the app keeps times as epoch ms', () => {
  const raw = rawLot({
    id: 9,
    ends_at: '2026-01-02T03:04:05Z',
    brand: '',
    model: 'D-100',
    lot_fee: 3,
    bid_history: [{ bidder_label: 'You', amount: 12, is_you: true }],
  });
  const detail = wire.normalizeDetail(raw);
  assert.equal(detail.brand, null, 'an empty brand is unknown');
  assert.equal(detail.model, 'D-100');
  assert.equal(detail.lotFee, 3);
  assert.deepEqual(detail.bidHistory, [{ bidderLabel: 'You', amount: 12, isYou: true }]);
  const lot = api.normalizeLot(raw);
  assert.equal(lot.endsAt, Date.parse('2026-01-02T03:04:05Z'));
  assert.throws(() => api.normalizeLot(rawLot({ ends_at: 'not a time' })), TypeError);
});
