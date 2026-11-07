import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { migrateSetting, timestamp, timeLeft } = await vite.ssrLoadModule('/src/time.ts');

test('countdowns use epoch milliseconds and preserve second boundaries', () => {
  const now = 120_000;
  assert.equal(timeLeft(now, now), 'Closed');
  assert.equal(timeLeft(now - 1, now), 'Closed');
  assert.equal(timeLeft(now + 1, now), '1s');
  assert.equal(timeLeft(now + 60_001, now), '1m 01s');
  assert.equal(timeLeft(now + 3600_000, now), '1h 0m');
  assert.equal(timeLeft(now + 86400_000, now), '1d 0h');
});

test('legacy ISO instants migrate once to integer timestamps', () => {
  assert.equal(timestamp('1970-01-01T00:00:00.123Z'), 123);
  assert.equal(timestamp(123), 123);
  assert.equal(timestamp(null), null);
  assert.equal(migrateSetting('tlxLastVisit', '1970-01-01T00:00:00.456Z'), 456);
  assert.deepEqual(migrateSetting('tlxView', { search: 'drill', newSince: '1970-01-01T00:00:00.123Z' }), { search: 'drill', newSince: 123 });
  assert.deepEqual(migrateSetting('tlxSavedSearches', [{ id: 'one', lastViewedAt: '1970-01-01T00:00:00.456Z' }]), [{ id: 'one', lastViewedAt: 456 }]);
});

test('invalid timestamps and saved searches fail explicitly instead of losing data', () => {
  for (const value of ['not a date', 1.5, Infinity, NaN, {}, true]) assert.throws(() => timestamp(value), /Invalid timestamp/);
  assert.throws(() => migrateSetting('tlxSavedSearches', {}), /Invalid saved searches/);
  assert.throws(() => migrateSetting('tlxSavedSearches', [{}]), /Invalid saved search/);
});

test('ordinary preferences are preserved without conversion', () => {
  const filters = ['drill', 'saw'];
  assert.equal(migrateSetting('filterWords', filters), filters);
  assert.equal(migrateSetting('tlxView', null), null);
});
