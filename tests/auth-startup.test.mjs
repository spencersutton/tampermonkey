import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import 'temporal-polyfill/global';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, appType: 'custom' });
after(() => vite.close());
const { appUnlocked, lockApp, me, onAuthChange, refreshSession, unlockApp } = await vite.ssrLoadModule('/src/app/auth.tsx');

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
