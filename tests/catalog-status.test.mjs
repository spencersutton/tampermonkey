import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = { addEventListener: () => {}, setTimeout: () => 1 };
globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };

const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const { error, fetchedAt, loaded, progress } = await vite.ssrLoadModule('/src/app/catalog.ts');
const { nextPullAt, pullCatalog, settingsReady, startCatalog } =
  await vite.ssrLoadModule('/src/app/source.ts');

test('catalog polling and manual refresh preserve the visible pull status', async (t) => {
  const now = Date.now();
  const status = {
    now,
    nextPullAt: now + 60_000,
    meta: { fetchedAt: 12_000, pullStartedAt: 10_000, count: 3, authed: false },
    progress: null,
    error: null,
  };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    requests.push([path, init.method]);
    if (path === '/api/catalog?since=0')
      return Response.json({ ...status, seq: 1, full: true, ids: null, lots: [] });
    if (path === '/api/settings') return Response.json({ rev: 0, values: {} });
    if (path === '/api/pull') return Response.json({ ...status, progress: { done: 2, total: 3 } });
    throw new Error(`Unexpected request: ${path}`);
  });

  startCatalog();
  await settingsReady;
  assert.equal(loaded.peek(), true);
  assert.equal(fetchedAt.peek().epochMilliseconds, 12_000);
  assert.equal(progress.peek(), null);
  assert.equal(error.peek(), null);
  assert.ok(nextPullAt().epochMilliseconds > now);
  await pullCatalog();
  assert.deepEqual(progress.peek(), { done: 2, total: 3 });
  assert.deepEqual(requests, [
    ['/api/catalog?since=0', 'GET'],
    ['/api/settings', 'GET'],
    ['/api/pull', 'POST'],
  ]);

  status.meta.fetchedAt = 12.5;
  await pullCatalog();
  assert.match(error.peek(), /Invalid epoch-millisecond timestamp/);

  status.meta.fetchedAt = 12_000;
  await pullCatalog();
  assert.equal(error.peek(), null);
  status.meta.fetchedAt = 12.5;
  await pullCatalog();
  assert.match(
    error.peek(),
    /Invalid epoch-millisecond timestamp/,
    'the same failure is shown again after a successful refresh',
  );
});
