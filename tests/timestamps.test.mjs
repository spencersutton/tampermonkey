import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
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
  assert.equal(
    normalizeView({ newSince: '1970-01-01T00:00:00.123Z' }).newSince.epochMilliseconds,
    123,
  );
});

test('compares and formats instant timestamps', () => {
  const now = Temporal.Instant.fromEpochMilliseconds(120_000);
  assert.equal(firstSeenAfter({ firstSeenAt: now }, now), false);
  assert.equal(firstSeenAfter({ firstSeenAt: now.add({ milliseconds: 1 }) }, now), true);
  assert.deepEqual(timeLabel(now.add({ seconds: 61 }), now), { text: '1m 01s', soon: true });
  assert.equal(ago(now.subtract({ minutes: 2 }), now), '2 min ago');
  assert.equal(countdown(61_000), '1:01');
});
