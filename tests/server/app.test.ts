// The front server's HTTP side (src/server/app.ts): guards, its own endpoints,
// the /backend proxy (fed real captured site replies), forwarding to the Python
// server, and static files.
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp, type Backend } from '../../src/server/app';
import { SiteSession } from '../../src/server/session';
import { Store } from '../../src/server/store';
import { FakeSite, jwt } from './fake-site';

interface Captured {
  request: { path: string };
  status: number;
  contentType: string;
  body: unknown;
}
const fixture = (name: string): Captured =>
  JSON.parse(readFileSync(new URL(`../fixtures/site/${name}`, import.meta.url), 'utf8'));
const LOTS = fixture('lots-newly-listed.json');
const NOT_FOUND = fixture('lot-detail-not-found.json');
const ANONYMOUS_ME = fixture('auth-me-anonymous.json');

const root = mkdtempSync(join(tmpdir(), 'tlx-app-'));
const staticDir = join(root, 'static');
mkdirSync(join(staticDir, 'assets'), { recursive: true });
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>TL Catalog</title>');
writeFileSync(join(staticDir, 'tags.html'), '<!doctype html><title>Tags</title>');
writeFileSync(
  join(staticDir, 'assets', 'app-1234.js'),
  `console.log(${JSON.stringify('x'.repeat(5000))});`,
);
writeFileSync(join(root, 'secret.txt'), 'not for the web');
afterAll(() => rmSync(root, { recursive: true }));

interface SiteCall {
  method: string;
  path: string;
  headers: Headers;
  body: string;
}

async function setup(
  options: { password?: string; loggedIn?: boolean; site?: (call: SiteCall) => Response } = {},
) {
  const store = new Store(':memory:');
  const fake = new FakeSite();
  const siteCalls: SiteCall[] = [];
  const backendCalls: { method: string; path: string; headers: Headers; body: string }[] = [];
  const siteFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.pathname.startsWith('/backend/')) {
      return fake.fetch(input, init);
    }
    const call = {
      method: init?.method ?? 'GET',
      path: url.pathname + url.search,
      headers: new Headers(init?.headers),
      body: init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : '',
    };
    siteCalls.push(call);
    if (options.site) {
      return options.site(call);
    }
    const captured = call.path === LOTS.request.path ? LOTS : NOT_FOUND;
    return new Response(JSON.stringify(captured.body), {
      status: captured.status,
      headers: { 'Content-Type': captured.contentType },
    });
  }) as typeof fetch;
  if (options.loggedIn) {
    await new SiteSession(store, fake.fetch).login('user@example.test', 'right');
  }
  // As after a restart: the login is in the database, and no refresh has run yet.
  const session = new SiteSession(store, fake.fetch);
  const backend: Backend = async (req, path) => {
    backendCalls.push({
      method: req.method,
      path,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? '' : await req.text(),
    });
    return Response.json(
      { from: 'python', path },
      { status: path.startsWith('/api/missing') ? 404 : 200 },
    );
  };
  const app = createApp({
    store,
    session,
    backend,
    password: options.password ?? null,
    staticDir,
    siteFetch,
    wrongPasswordDelayMs: 0,
  });
  const request = (path: string, init: RequestInit & { host?: string } = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Host', init.host ?? '127.0.0.1:8765');
    return app.request(`http://${init.host ?? '127.0.0.1:8765'}${path}`, { ...init, headers });
  };
  const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    request(path, {
      method: 'POST',
      headers: { 'X-TLX-Client': '1', 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { store, fake, session, siteCalls, backendCalls, request, post };
}

describe('guards', () => {
  test('without a password only local Host names are served, plus --allow-host', async () => {
    const { request } = await setup();
    expect((await request('/api/health')).status).toBe(200);
    const res = await request('/api/health', { host: 'evil.example:8765' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Host 'evil.example' not allowed (use --allow-host, or set a password)",
    });
    expect((await request('/', { host: '[::1]:8765' })).status).toBe(200);
  });

  test('state-changing requests need X-TLX-Client', async () => {
    const { request, post } = await setup();
    expect((await request('/api/settings/x', { method: 'PUT', body: '{}' })).status).toBe(403);
    expect((await post('/api/pull')).status).toBe(200);
  });

  test("with a password, the API, proxy and websocket need this app's session cookie", async () => {
    const { request, post, store } = await setup({ password: 'pw' });
    for (const path of ['/api/catalog', '/backend/v1/auctions/lots/', '/ws']) {
      const res = await request(path);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'app_locked' });
    }
    expect((await request('/')).status).toBe(200);
    expect(await (await request('/api/me')).json()).toEqual({
      version: '1.0.0',
      app: { locked: true, password: true },
      site: null,
    });

    expect((await post('/api/app-login', { password: 'nope' })).status).toBe(401);
    const login = await post('/api/app-login', { password: 'pw' });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(
      /^tlx_session=[\w-]{43}; Path=\/; Max-Age=7776000; HttpOnly; SameSite=Strict$/,
    );
    const cookie = setCookie.split(';')[0]!;
    expect((await request('/api/catalog', { headers: { Cookie: cookie } })).status).toBe(200);
    expect(store.hasSession(cookie.split('=')[1]!, 60)).toBe(true);

    const logout = await post('/api/app-logout', undefined, { Cookie: cookie });
    expect(logout.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect((await request('/api/catalog', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  test('the session cookie is Secure behind TLS or an HTTPS proxy', async () => {
    const { post } = await setup({ password: 'pw' });
    const res = await post('/api/app-login', { password: 'pw' }, { 'X-Forwarded-Proto': 'https' });
    expect(res.headers.get('Set-Cookie')).toEndWith('; Secure');
  });
});

describe('site login', () => {
  test('logging in reports the site status and asks the Python server for a pull', async () => {
    const { post, backendCalls } = await setup();
    const res = await post('/api/site-login', { email: ' user@example.test ', password: 'right' });
    expect(await res.json()).toEqual({
      error: null,
      version: '1.0.0',
      app: { locked: false, password: false },
      site: { loggedIn: true, email: 'user@example.test', name: 'Test User' },
    });
    expect(backendCalls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/pull']);
    expect(backendCalls[0]?.headers.get('X-TLX-Client')).toBe('1');
  });

  test('a failed login is reported and asks for nothing', async () => {
    const { post, backendCalls } = await setup();
    const body = await (await post('/api/site-login', { email: 'a', password: 'wrong' })).json();
    expect(body.error).toBe('Wrong email or password.');
    expect(body.site.loggedIn).toBe(false);
    expect(backendCalls).toEqual([]);
  });

  test('logging out', async () => {
    const { post, session } = await setup({ loggedIn: true });
    const body = await (await post('/api/site-logout')).json();
    expect(body.site.loggedIn).toBe(false);
    expect(session.loggedIn()).toBe(false);
  });
});

describe('/backend proxy', () => {
  test("passes real site replies through, with the login token and only the site's headers", async () => {
    const { request, siteCalls, fake } = await setup({ loggedIn: true });
    const res = await request(LOTS.request.path, {
      headers: { Accept: 'application/json', Cookie: 'tlx_session=x', 'X-Other': 'y' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual(LOTS.body);
    const [call] = siteCalls;
    expect(call?.headers.get('Authorization')).toBe(`Bearer ${fake.token}`);
    expect([...call!.headers.keys()].toSorted()).toEqual(['accept', 'authorization']);

    const missing = await request(NOT_FOUND.request.path.replace('/1/', '/1/x'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual(NOT_FOUND.body);
  });

  test('bids go through with their body and headers', async () => {
    const { post, siteCalls } = await setup({
      loggedIn: true,
      site: () => Response.json({ is_leading: true }, { status: 201 }),
    });
    const res = await post(
      '/backend/v1/auctions/lots/5/bids',
      { amount: 7, type: 'next_increment' },
      { 'X-CSRF-Protection': '1', 'X-Bid-Type': 'next_increment' },
    );
    expect(res.status).toBe(201);
    expect(siteCalls[0]).toMatchObject({
      method: 'POST',
      body: '{"amount":7,"type":"next_increment"}',
    });
    expect(siteCalls[0]?.headers.get('X-Bid-Type')).toBe('next_increment');
    expect(siteCalls[0]?.headers.has('X-TLX-Client')).toBe(false);
  });

  test('a rejected token is refreshed and the request retried once', async () => {
    let rejected = '';
    const { request, fake, siteCalls } = await setup({
      loggedIn: true,
      site: (call) =>
        call.headers.get('Authorization') === `Bearer ${rejected}`
          ? Response.json(ANONYMOUS_ME.body, { status: 401 })
          : Response.json({ pickup_location: null }),
    });
    rejected = fake.token;
    fake.token = jwt(Date.now() / 1000 + 7200);
    const res = await request('/backend/v1/auth/me/');
    expect(res.status).toBe(200);
    expect(siteCalls.map((c) => c.headers.get('Authorization'))).toEqual([
      `Bearer ${rejected}`,
      `Bearer ${fake.token}`,
    ]);
  });

  test('still rejected, a GET falls back to anonymous data but a POST does not', async () => {
    const { request, post, siteCalls, fake } = await setup({
      loggedIn: true,
      site: (call) =>
        call.headers.has('Authorization')
          ? Response.json(ANONYMOUS_ME.body, { status: 401 })
          : Response.json({ anonymous: true }),
    });
    fake.token = jwt(Date.now() / 1000 + 7200); // the refresh gets a new token, rejected too
    expect(await (await request('/backend/v1/auth/me/')).json()).toEqual({ anonymous: true });
    expect(siteCalls.map((c) => c.headers.has('Authorization'))).toEqual([true, true, false]);
    const res = await post('/backend/v1/auctions/lots/5/bids', { amount: 1 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(ANONYMOUS_ME.body);
  });

  test('lot details and won/lost pages go through the Python server, which keeps their data', async () => {
    const { request, siteCalls, backendCalls } = await setup();
    for (const path of [
      '/backend/v1/auctions/lots/2026-11-01/207621/',
      '/backend/v1/auctions/control-panel/closed/won/?page=1&per_page=100',
      '/backend/v1/auctions/control-panel/closed/lost/',
    ]) {
      expect(await (await request(path)).json()).toEqual({ from: 'python', path });
    }
    expect(siteCalls).toEqual([]);
    expect(backendCalls.length).toBe(3);
  });

  test('an unreachable site is a 502', async () => {
    const { request } = await setup({
      site: () => {
        throw new TypeError('fetch failed');
      },
    });
    const res = await request('/backend/v1/auctions/filter-config/');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toStartWith('Couldn’t reach the site');
  });
});

describe('forwarding to the Python server', () => {
  test('other /api requests keep their method, path, query, body and app headers', async () => {
    const { request, backendCalls } = await setup();
    const res = await request('/api/settings/tlxSyncMinutes?x=1', {
      method: 'PUT',
      headers: {
        'X-TLX-Client': '1',
        'Content-Type': 'application/json',
        Cookie: 'tlx_session=secret',
      },
      body: '{"value":5}',
    });
    expect(await res.json()).toEqual({ from: 'python', path: '/api/settings/tlxSyncMinutes?x=1' });
    expect(backendCalls[0]).toMatchObject({ method: 'PUT', body: '{"value":5}' });
    expect((await request('/api/missing')).status).toBe(404);
  });

  test('oversized bodies are refused', async () => {
    const { request, backendCalls } = await setup();
    const res = await request('/api/tag-rules', {
      method: 'POST',
      headers: { 'X-TLX-Client': '1' },
      body: 'x'.repeat(4 * 1024 * 1024 + 1),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Request body too large' });
    expect(backendCalls).toEqual([]);
  });
});

describe('static files', () => {
  test('pages are always fresh, hashed assets cached for good, and nothing outside is served', async () => {
    const { request } = await setup();
    for (const path of ['/', '/tlx', '/tlx/']) {
      const res = await request(path);
      expect(await res.text()).toContain('TL Catalog');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('Content-Type')).toStartWith('text/html');
    }
    expect(await (await request('/tags')).text()).toContain('Tags');
    const asset = await request('/assets/app-1234.js', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(asset.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.get('Content-Encoding')).toBe('gzip');
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets', '/nope.js']) {
      expect((await request(path)).status).toBe(404);
    }
  });

  test('every reply says nosniff, no-referrer, and no-store unless cacheable', async () => {
    const { request } = await setup();
    const res = await request('/api/health');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
