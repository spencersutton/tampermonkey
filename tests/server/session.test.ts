// The site login (src/server/session.ts), against a fake next-auth.
import { describe, expect, test } from 'bun:test';

import { SiteSession, tokenExpiry } from '../../src/server/session';
import { Store } from '../../src/server/store';
import { FakeSite, jwt } from './fake-site';

const setup = () => {
  const store = new Store(':memory:');
  const site = new FakeSite();
  return { store, site, session: () => new SiteSession(store, site.fetch) };
};

describe('SiteSession', () => {
  test('login keeps cookies across restarts in the Python format, and logout clears them', async () => {
    const { store, site, session } = setup();
    const s = session();
    expect(await s.login('user@example.test', 'right')).toBeNull();
    expect(s.status()).toEqual({ loggedIn: true, email: 'user@example.test', name: 'Test User' });
    expect(await s.token()).toBe(site.token);
    expect(store.getMeta('siteCookies')).toContainEqual({
      name: 'token',
      value: site.token,
      domain: 'triangleliquidators.com',
      path: '/',
    });
    expect(store.getMeta('siteUser')).toEqual({ email: 'user@example.test', name: 'Test User' });

    const restarted = session();
    expect(restarted.loggedIn()).toBe(true);
    expect(await restarted.token()).toBe(site.token);
    await restarted.logout();
    expect(restarted.loggedIn()).toBe(false);
    expect(store.getMeta('siteCookies')).toEqual([]);
    expect(site.requests.at(-1)?.path).toBe('/api/auth/signout');
  });

  test('cookies the site sets go back with later requests on their path', async () => {
    const { site, session } = setup();
    await session().login('user@example.test', 'right');
    const callback = site.requests.find(r => r.path === '/api/auth/callback/credentials');
    expect(callback?.cookie).toBe('csrf=csrf-1');
    const refresh = site.requests.find(r => r.path === '/api/auth/session');
    expect(refresh?.cookie).toBe('csrf=csrf-1; session=session-1');
  });

  test('a wrong password is reported and leaves no session', async () => {
    const { session } = setup();
    const s = session();
    expect(await s.login('user@example.test', 'wrong')).toBe('Wrong email or password.');
    expect(s.loggedIn()).toBe(false);
  });

  test('an expiring token is refreshed before use', async () => {
    const { store, site, session } = setup();
    await session().login('user@example.test', 'right');
    const old = site.token;
    site.token = jwt(Date.now() / 1000 + 3600);
    expect(await session().token()).toBe(old); // not near expiry: no refresh
    const cookies = store.getMeta('siteCookies') as { name: string; value: string }[];
    store.setMeta(
      'siteCookies',
      cookies.map(c => (c.name === 'token' ? { ...c, value: jwt(Date.now() / 1000 + 10) } : c)),
    );
    expect(await session().token()).toBe(site.token);
  });

  test('cookies saved in the older name/value form still load', async () => {
    const { store, site, session } = setup();
    site.sessionCookie = 'session-1';
    store.setMeta('siteCookies', { session: 'session-1', token: site.token });
    store.setMeta('siteUser', { email: 'user@example.test', name: null });
    const s = session();
    expect(s.loggedIn()).toBe(true);
    expect(await s.refresh()).toBe(true);
    expect(site.requests.at(-1)?.cookie).toContain('session=session-1');
  });

  test('a session the site ended logs out', async () => {
    const { store, site, session } = setup();
    const s = session();
    await s.login('user@example.test', 'right');
    site.sessionCookie = null;
    expect(await s.refresh()).toBe(false);
    expect(s.loggedIn()).toBe(false);
    expect(store.getMeta('siteCookies')).toEqual([]);
  });

  test('a rejected token is refreshed once; a forced refresh waits out its gap', async () => {
    const { site, session } = setup();
    const s = session();
    await s.login('user@example.test', 'right');
    const old = site.token;
    site.token = jwt(Date.now() / 1000 + 7200);
    // The login's own refresh was just now, so a forced one is skipped.
    expect(await s.rejected(old)).toBeNull();
    expect(await s.rejected('some-older-token')).toBe(old);
  });

  test('concurrent token requests refresh once', async () => {
    const { store, site, session } = setup();
    await session().login('user@example.test', 'right');
    const cookies = store.getMeta('siteCookies') as { name: string; value: string }[];
    store.setMeta(
      'siteCookies',
      cookies.map(c => (c.name === 'token' ? { ...c, value: jwt(Date.now() / 1000 + 10) } : c)),
    );
    const s = session();
    const before = site.requests.length;
    site.token = jwt(Date.now() / 1000 + 7200);
    const tokens = await Promise.all([s.token(), s.token(), s.token()]);
    expect(new Set(tokens)).toEqual(new Set([site.token]));
    expect(site.requests.length - before).toBe(1);
  });

  test('tokenExpiry reads the exp claim', () => {
    expect(tokenExpiry(jwt(123))).toBe(123);
    expect(tokenExpiry('no-dots')).toBeNull();
    expect(tokenExpiry(null)).toBeNull();
  });
});
