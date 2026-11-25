// The site login (src/server/session.ts), against a fake next-auth.
import { describe, expect, test } from 'bun:test';

import { SiteSession, tokenExpiry } from '../../src/server/session';
import { FakeSite, jwt } from './fake-site';
import { testDb } from './pg';

const db = testDb();

const setup = async () => {
  const store = await db.openStore();
  const site = new FakeSite();
  return { store, site, session: () => SiteSession.create(store, site.fetch) };
};

describe('SiteSession', () => {
  test('login keeps cookies across restarts, and logout clears them', async () => {
    const { store, site, session } = await setup();
    const s = await session();
    expect(await s.login('user@example.test', 'right')).toBeNull();
    expect(s.status()).toEqual({ loggedIn: true, email: 'user@example.test', name: 'Test User' });
    expect(await s.token()).toBe(site.token);
    expect(await store.getMeta('siteCookies')).toContainEqual({
      name: 'token',
      value: site.token,
      domain: 'triangleliquidators.com',
      path: '/',
    });
    expect(await store.getMeta('siteUser')).toEqual({
      email: 'user@example.test',
      name: 'Test User',
    });

    const restarted = await session();
    expect(restarted.loggedIn()).toBe(true);
    expect(await restarted.token()).toBe(site.token);
    await restarted.logout();
    expect(restarted.loggedIn()).toBe(false);
    expect(await store.getMeta('siteCookies')).toEqual([]);
    expect(site.requests.at(-1)?.path).toBe('/api/auth/signout');
  });

  test('cookies the site sets go back with later requests on their path', async () => {
    const { site, session } = await setup();
    await (await session()).login('user@example.test', 'right');
    const callback = site.requests.find(r => r.path === '/api/auth/callback/credentials');
    expect(callback?.cookie).toBe('csrf=csrf-1');
    const refresh = site.requests.find(r => r.path === '/api/auth/session');
    expect(refresh?.cookie).toBe('csrf=csrf-1; session=session-1');
  });

  test('a wrong password is reported and leaves no session', async () => {
    const { session } = await setup();
    const s = await session();
    expect(await s.login('user@example.test', 'wrong')).toBe('Wrong email or password.');
    expect(s.loggedIn()).toBe(false);
  });

  test('an expiring token is refreshed before use', async () => {
    const { store, site, session } = await setup();
    await (await session()).login('user@example.test', 'right');
    const old = site.token;
    site.token = jwt(Date.now() / 1000 + 3600);
    expect(await (await session()).token()).toBe(old); // not near expiry: no refresh
    const cookies = (await store.getMeta('siteCookies')) as { name: string; value: string }[];
    await store.setMeta(
      'siteCookies',
      cookies.map(c => (c.name === 'token' ? { ...c, value: jwt(Date.now() / 1000 + 10) } : c)),
    );
    expect(await (await session()).token()).toBe(site.token);
  });

  test('a session the site ended logs out', async () => {
    const { store, site, session } = await setup();
    const s = await session();
    await s.login('user@example.test', 'right');
    site.sessionCookie = null;
    expect(await s.refresh()).toBe(false);
    expect(s.loggedIn()).toBe(false);
    expect(await store.getMeta('siteCookies')).toEqual([]);
  });

  test('a rejected token is refreshed once; a forced refresh waits out its gap', async () => {
    const { site, session } = await setup();
    const s = await session();
    await s.login('user@example.test', 'right');
    const old = site.token;
    site.token = jwt(Date.now() / 1000 + 7200);
    // The login's own refresh was just now, so a forced one is skipped.
    expect(await s.rejected(old)).toBeNull();
    expect(await s.rejected('some-older-token')).toBe(old);
  });

  test('concurrent token requests refresh once', async () => {
    const { store, site, session } = await setup();
    await (await session()).login('user@example.test', 'right');
    const cookies = (await store.getMeta('siteCookies')) as { name: string; value: string }[];
    await store.setMeta(
      'siteCookies',
      cookies.map(c => (c.name === 'token' ? { ...c, value: jwt(Date.now() / 1000 + 10) } : c)),
    );
    const s = await session();
    const before = site.requests.length;
    site.token = jwt(Date.now() / 1000 + 7200);
    const tokens = await Promise.all([s.token(), s.token(), s.token()]);
    expect(new Set(tokens)).toEqual(new Set([site.token]));
    expect(site.requests.length - before).toBe(1);
  });

  test('an expired token cookie refreshes from the still-valid session cookie instead of logging out', async () => {
    const store = await db.openStore();
    const site = new FakeSite();
    let shortLived = true;
    const fetchWithMaxAge = (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await site.fetch(input, init);
      if (new URL(String(input)).pathname === '/api/auth/session' && shortLived) {
        const headers = new Headers(res.headers);
        headers.set('Set-Cookie', `token=${site.token}; Path=/; Max-Age=1`);
        return new Response(res.body, { status: res.status, headers });
      }
      return res;
    }) as typeof fetch;

    const s = await SiteSession.create(store, fetchWithMaxAge);
    expect(await s.login('user@example.test', 'right')).toBeNull();
    const first = site.token;
    shortLived = false;
    site.token = jwt(Date.now() / 1000 + 7200);

    // Advance past the token cookie's Max-Age so live() drops it while the session cookie remains.
    const realNow = Date.now;
    Date.now = () => realNow() + 5000;
    try {
      expect(s.loggedIn()).toBe(true);
      expect(await s.token()).toBe(site.token);
      expect(await s.token()).not.toBe(first);
    } finally {
      Date.now = realNow;
    }
  });

  test('non-200 replies from /api/auth/session do not wipe cookies or log out', async () => {
    const store = await db.openStore();
    const site = new FakeSite();
    let overrideStatus: number | null = null;
    const fetchWithErrors = (async (input: string | URL | Request, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/api/auth/session' && overrideStatus !== null) {
        return new Response('<html>rate limited</html>', {
          status: overrideStatus,
          headers: { 'Content-Type': 'text/html' },
        });
      }
      return site.fetch(input, init);
    }) as typeof fetch;

    const s = await SiteSession.create(store, fetchWithErrors);
    expect(await s.login('user@example.test', 'right')).toBeNull();
    for (const status of [403, 429, 502]) {
      overrideStatus = status;
      expect(await s.refresh()).toBe(true);
      expect(s.loggedIn()).toBe(true);
      expect(await store.getMeta('siteUser')).toEqual({
        email: 'user@example.test',
        name: 'Test User',
      });
    }
  });

  test('tokenExpiry reads the exp claim', () => {
    expect(tokenExpiry(jwt(123))).toBe(123);
    expect(tokenExpiry('no-dots')).toBeNull();
    expect(tokenExpiry(null)).toBeNull();
  });
});
