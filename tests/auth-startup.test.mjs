import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { appUnlocked, authedFetch, lockApp, me, onAuthChange, refreshSession, unlockApp } = await vite.ssrLoadModule('/src/app/auth.tsx');

test('authenticated fetch preserves request options and supports every HeadersInit form', async (t) => {
  const response = new Response();
  const fetch = t.mock.method(globalThis, 'fetch', async () => response);
  for (const supplied of [
    undefined,
    { Accept: 'application/json', 'x-tlx-client': '0' },
    [['Accept', 'application/json'], ['x-tlx-client', '0']],
    new Headers({ Accept: 'application/json', 'x-tlx-client': '0' }),
  ]) {
    const original = [...new Headers(supplied)];
    const init = { method: 'POST', body: '{}', credentials: 'omit', headers: supplied };
    assert.equal(await authedFetch('/backend/test', init), response);
    const [url, options] = fetch.mock.calls.at(-1).arguments;
    assert.equal(url, '/backend/test');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, '{}');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers.get('X-TLX-Client'), '1');
    assert.equal(options.headers.get('Accept'), supplied ? 'application/json' : null);
    assert.deepEqual([...new Headers(supplied)], original, 'caller headers are not mutated');
  }
  assert.equal(await authedFetch('/backend/test'), response);
  assert.equal(fetch.mock.calls.at(-1).arguments[1].headers.get('X-TLX-Client'), '1');
});

test('startup waits for unlock and runs only once across subsequent lock and login changes', async (t) => {
  let locked = true;
  let loggedIn = false;
  let starts = 0;
  let loginChanges = 0;
  const started = appUnlocked.then(() => { starts++; });
  const unsubscribe = onAuthChange(() => { loginChanges++; });
  t.after(unsubscribe);
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    version: 'test', app: { locked, password: true }, site: { loggedIn, email: null, name: null },
  }));
  await refreshSession();
  assert.equal(starts, 0);
  assert.equal(me.peek().app.locked, true);

  locked = false;
  await unlockApp('test');
  await started;
  assert.equal(starts, 1);
  assert.equal(loginChanges, 0);

  loggedIn = true;
  await refreshSession();
  assert.equal(loginChanges, 1);
  await refreshSession();
  assert.equal(loginChanges, 1);
  locked = true;
  await lockApp();
  locked = false;
  await unlockApp('test');
  assert.equal(starts, 1);
});
