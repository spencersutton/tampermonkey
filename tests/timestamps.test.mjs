import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const { KEYS } = await vite.ssrLoadModule('/src/shared/keys.ts');
const { getSetting } = await vite.ssrLoadModule('/src/app/settings.ts');
const { normalizeView, firstSeenAfter } = await vite.ssrLoadModule('/src/app/view.ts');
const { ago, timeLabel, countdown } = await vite.ssrLoadModule('/src/app/util.ts');

test('ignores browser copies of server-backed timestamp settings', () => {
  storage.set(`tlx:${KEYS.lastVisit}`, JSON.stringify('1970-01-01T00:00:00.123Z'));
  storage.set(
    `tlx:${KEYS.savedSearches}`,
    JSON.stringify([{ id: 'one', lastViewedAt: '1970-01-01T00:00:00.456Z' }]),
  );
  assert.equal(getSetting(KEYS.lastVisit), null);
  assert.deepEqual(getSetting(KEYS.savedSearches), []);
});

test('restores serialized new-since filters', () => {
  assert.equal(normalizeView({ newSince: 123 }).newSince, 123);
  assert.equal(normalizeView({ newSince: '1970-01-01T00:00:00.123Z' }).newSince, 123);
});

test('compares and formats epoch-ms timestamps', () => {
  const S = 1000;
  const M = 60 * S;
  const H = 60 * M;
  const now = 120_000;
  assert.equal(firstSeenAfter({ firstSeenAt: now }, now), false);
  assert.equal(firstSeenAfter({ firstSeenAt: now + 1 }, now), true);
  assert.deepEqual(timeLabel(now + 61 * S, now), { text: '1m 1s', soon: true });
  assert.equal(ago(now - 59 * S, now), 'now');
  assert.equal(ago(now - 2 * M, now), '2 minutes ago');
  assert.equal(ago(now - (5 * H + 59 * M), now), '5 hours ago');
  assert.equal(ago(now - 24 * H, now), 'yesterday');
  assert.equal(ago(now - 72 * H, now), '3 days ago');
  assert.equal(countdown(61_000), '1:01');
});
