// Real responses captured from triangleliquidators.com (tests/fixtures/site/,
// refreshed with `npm run capture-fixtures`) against the shapes the code
// declares for them. A failure after a refresh means the site changed: update
// the declared types (src/shared/lot.ts and friends) and what reads them.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

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

const DIR = new URL('fixtures/site/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, DIR), 'utf8'));

// A small schema language: 'string' | 'number' | 'boolean' | 'null', `nullable(x)`,
// `[item]` for arrays and `{ key: schema }` for objects with exactly those keys.
const nullable = (schema) => ({ nullable: schema });
function check(value, schema, path = '$') {
  if (typeof schema === 'string') {
    const actual = value === null ? 'null' : typeof value;
    assert.equal(actual, schema, `${path}: expected ${schema}, got ${JSON.stringify(value)}`);
  } else if ('nullable' in schema) {
    if (value !== null) {
      check(value, schema.nullable, path);
    }
  } else if (Array.isArray(schema)) {
    assert.ok(Array.isArray(value), `${path}: expected an array`);
    value.forEach((item, i) => check(item, schema[0], `${path}[${i}]`));
  } else {
    assert.ok(value && typeof value === 'object', `${path}: expected an object`);
    assert.deepEqual(
      Object.keys(value).toSorted(),
      Object.keys(schema).toSorted(),
      `${path}: fields differ from the declared ones`,
    );
    for (const [key, sub] of Object.entries(schema)) {
      check(value[key], sub, `${path}.${key}`);
    }
  }
}

// RawLot and RawLotDetail in src/shared/lot.ts. The declared types allow more
// nulls than these samples show; these are the ones seen in practice.
const STANDING = nullable({ is_leading: 'boolean', your_max_bid: nullable('number') });
const LOT = {
  id: 'number',
  auction_period: 'string',
  title: 'string',
  lot_number: 'string',
  category: nullable({ value: 'string', label: 'string' }),
  condition: nullable({ value: 'number', display_name: 'string' }),
  location: nullable({ id: 'number', name: 'string' }),
  is_transferable: 'boolean',
  transfer_fee: 'number',
  current_price: 'number',
  estimated_retail_price: nullable('number'),
  ends_at: 'string',
  status: 'string',
  version: 'number',
  bid_count: 'number',
  next_min_increment: 'number',
  your_standing: STANDING,
  is_watchlisted: 'boolean',
  has_bid: 'boolean',
  images: [
    { position: 'number', image_thumb: 'string', image_card: 'string', image_large: 'string' },
  ],
};
const DETAIL = {
  ...LOT,
  description: 'string',
  brand: nullable('string'),
  model: nullable('string'),
  lot_fee: nullable('number'),
  bid_history: [{ bidder_label: 'string', amount: 'number', is_you: 'boolean' }],
  similar: [LOT],
};
const lists = ['lots-newly-listed.json', 'lots-ending-soonest.json'].map(fixture);
const details = ['lot-detail-with-brand-model.json', 'lot-detail-without-brand-model.json'].map(
  fixture,
);

test('every capture is a successful JSON reply except the deliberate failures', () => {
  for (const name of readdirSync(DIR).filter((n) => !n.startsWith('ws-'))) {
    const f = fixture(name);
    const failure = ['lot-detail-not-found.json', 'auth-me-anonymous.json'].includes(name);
    assert.equal(f.status, failure ? (name.includes('not-found') ? 404 : 401) : 200, name);
    assert.match(f.contentType, /^application\/json/, name);
  }
});

test('catalog pages and lot details have exactly the declared fields', () => {
  for (const page of lists) {
    check(page.body, { count: 'number', results: [LOT] });
    assert.ok(page.body.results.length > 0);
  }
  for (const detail of details) {
    check(detail.body, DETAIL);
  }
  assert.ok(details[0].body.brand && details[0].body.model);
  assert.ok(!(details[1].body.brand && details[1].body.model));
});

test('real lots normalize for the server and the app', () => {
  const raws = [...lists.flatMap((p) => p.body.results), ...details.map((d) => d.body)];
  for (const raw of raws) {
    const lot = wire.normalizeLot(raw);
    assert.equal(lot.endsAt, Date.parse(raw.ends_at));
    assert.equal(lot.condition?.label, raw.condition?.display_name);
    assert.deepEqual(
      lot.images.map((i) => i.card),
      raw.images.toSorted((a, b) => a.position - b.position).map((i) => i.image_card),
    );
    assert.ok(api.normalizeLot(raw).endsAt.equals(Temporal.Instant.from(raw.ends_at)));
  }
  const detail = wire.normalizeDetail(details[0].body);
  assert.equal(detail.brand, details[0].body.brand);
  assert.equal(detail.bidHistory.length, details[0].body.bid_history.length);
});

test('the API and next-auth answer errors and logged-out sessions as the server expects', () => {
  check(fixture('lot-detail-not-found.json').body, { error: 'string', code: 'string' });
  check(fixture('auth-me-anonymous.json').body, { error: 'string', code: 'string' });
  assert.deepEqual(fixture('auth-session-logged-out.json').body, {}, 'logged out is {}');
  check(fixture('auth-csrf.json').body, { csrfToken: 'string' });
});

test('filter-config has the condition descriptions fetchConditions reads', () => {
  const { conditions } = fixture('filter-config.json').body;
  assert.ok(conditions.length > 0);
  for (const c of conditions) {
    assert.equal(typeof c.value, 'number');
    assert.equal(typeof c.label, 'string');
    assert.equal(typeof c.description, 'string');
  }
});

test('websocket frames: connect and subscribe replies, pings, and lot publications live.ts reads', () => {
  const { frames } = fixture('ws-anonymous-lot-channels.json');
  const received = frames.filter((f) => f.dir === 'received').map((f) => f.data);
  check(received[0], {
    id: 'number',
    connect: { client: 'string', version: 'string', ping: 'number', pong: 'boolean' },
  });
  const subscribed = received.filter((d) => d.subscribe);
  assert.ok(subscribed.length > 0);
  for (const d of subscribed) {
    check(d, {
      id: 'number',
      subscribe: {
        recoverable: 'boolean',
        epoch: 'string',
        offset: 'number',
        positioned: 'boolean',
      },
    });
  }
  assert.ok(
    received.some((d) => Object.keys(d).length === 0),
    'the server pings with {}',
  );
  const pushes = received.filter((d) => d.push);
  assert.ok(pushes.length > 0, 'recapture near closing time if no lot got a bid');
  for (const { push } of pushes) {
    // onLotPublication in src/app/live.ts
    check(push, {
      channel: 'string',
      pub: {
        data: {
          id: 'number',
          current_price: 'number',
          bid_count: 'number',
          next_min_increment: 'number',
          ends_at: 'string',
          status: 'string',
          version: 'number',
        },
        offset: 'number',
      },
    });
    assert.equal(push.channel, `lot:${push.pub.data.id}`);
  }
});
