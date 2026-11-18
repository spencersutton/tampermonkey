// The HTTP side: serves the web app and stands in for the site, as the Python
// server (server/tlx_server/server.py) does. During the move to TypeScript this
// server is the front door and owns:
//
//   /                the built web app (static files)
//   /ws              the site's live-updates websocket, relayed (relay.ts)
//   /backend/v1/...  the site's JSON API, with the login token added
//                    (refreshed and retried once on a 401, like the site's client)
//   /api/health, /api/me, /api/app-login, /api/app-logout,
//   /api/site-login, /api/site-logout
//
// Everything else under /api/ (the catalog, settings, history, item types, tag
// rules) is forwarded to the Python server, which still owns the catalog. So
// are the two /backend reads it keeps data from: lot details and the closed
// won/lost pages. The Python server reads the login token this one keeps from
// the shared database (its --shared-login mode).
//
// Because the server is logged in to your account (and can bid), every request
// except the app's static files needs this app's own password (a session
// cookie, SameSite=Strict) once one is set. State-changing requests also need
// an `X-TLX-Client` header, which another site can't add without a CORS
// preflight that's never answered; websocket upgrades must come from this
// server's own Origin. Without a password, the Host header must be a local name
// (stops DNS rebinding).
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import { resolve, sep } from 'node:path';

import type { Server } from 'bun';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { getCookie } from 'hono/cookie';

import { isRecord, prop } from './json';
import { connectUpstream, relayData, type RelayData } from './relay';
import type { SiteSession } from './session';
import { SITE, VERSION, WS_URL } from './site';
import type { Store } from './store';

const MAX_BODY = 4 * 1024 * 1024;
const SESSION_COOKIE = 'tlx_session';
const SESSION_MAX_AGE = 90 * 24 * 3600;
export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];
const PUBLIC_PATHS = new Set(['/api/me', '/api/app-login', '/api/health']);
// Request headers passed through to the site's API (the rest are dropped).
const PROXY_HEADERS = [
  'Accept',
  'Content-Type',
  'X-CSRF-Protection',
  'X-Bid-Surface',
  'X-Bid-Type',
];
// ...and to the Python server.
const BACKEND_HEADERS = [...PROXY_HEADERS, 'X-TLX-Client', 'X-TLX-Active'];
// /backend reads the Python server keeps data from, so they go through it.
const BACKEND_READS = [
  /^\/backend\/v1\/auctions\/lots\/[^/]+\/\d+\/$/,
  /^\/backend\/v1\/auctions\/control-panel\/closed\/(won|lost)\/$/,
];
const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/tlx': 'index.html',
  '/tlx/': 'index.html',
  '/tags': 'tags.html',
  '/tags/': 'tags.html',
};

/** Sends a request on to the Python server; the path includes the query. */
export type Backend = (req: Request, path: string) => Promise<Response>;

export interface Deps {
  store: Store;
  session: SiteSession;
  backend: Backend;
  password: string | null;
  allowHosts?: string[];
  tls?: boolean;
  staticDir: string;
  siteFetch?: typeof fetch;
  wsUrl?: string;
  /** Pause after a wrong app password, to slow down guessing. */
  wrongPasswordDelayMs?: number;
}

type Env = { Bindings: Server<RelayData> }; // Bun passes its server to fetch

class BadRequest extends Error {}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
const error = (status: number, message: string) => json({ error: message }, status);

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.arrayBuffer();
  let d: unknown;
  try {
    d = body.byteLength ? JSON.parse(new TextDecoder().decode(body)) : null;
  } catch {
    throw new BadRequest('Invalid JSON');
  }
  if (!isRecord(d)) {
    throw new BadRequest('Expected a JSON object');
  }
  return d;
}

/** The hostname of a Host header, lowercase and without IPv6 brackets ('' if unreadable). */
function hostname(host: string | undefined): string {
  try {
    return new URL(`http://${host ?? ''}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

const digest = (s: string) => createHash('sha256').update(s).digest();
const samePassword = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** A /backend forwarder for the Python server at `base`, sending `key` if it needs one. */
export function backendAt(
  base: string,
  key: string | null,
  fetchImpl: typeof fetch = fetch,
): Backend {
  return async (req, path) => {
    const headers = new Headers();
    for (const h of BACKEND_HEADERS) {
      const v = req.headers.get(h);
      if (v) {
        headers.set(h, v);
      }
    }
    if (key) {
      headers.set('X-TLX-Backend-Key', key);
    }
    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const res = await fetchImpl(base + path, {
      method: req.method,
      headers,
      redirect: 'manual',
      ...(hasBody ? { body: await req.arrayBuffer() } : {}),
    });
    // fetch has already undone any compression; this server compresses its own replies.
    const out = new Headers();
    for (const h of ['Content-Type', 'Cache-Control']) {
      const v = res.headers.get(h);
      if (v) {
        out.set(h, v);
      }
    }
    return new Response(req.method === 'HEAD' ? null : res.body, {
      status: res.status,
      headers: out,
    });
  };
}

export function createApp(deps: Deps) {
  const { store, session, password } = deps;
  const hosts = new Set([...LOCAL_HOSTS, ...(deps.allowHosts ?? []).map(hostname)]);
  const siteFetch = deps.siteFetch ?? fetch;
  const staticDir = resolve(deps.staticDir);
  const app = new Hono<Env>();

  const sessionId = (c: Context) => getCookie(c, SESSION_COOKIE) ?? null;
  const unlocked = (c: Context) => {
    if (!password) {
      return true;
    }
    const sid = sessionId(c);
    return sid !== null && store.hasSession(sid, SESSION_MAX_AGE);
  };
  const secure = (c: Context) => Boolean(deps.tls) || c.req.header('X-Forwarded-Proto') === 'https';
  const cookie = (c: Context, value: string, maxAge: number) =>
    `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure(c) ? '; Secure' : ''}`;
  const me = (c: Context, locked = !unlocked(c)) => ({
    version: VERSION,
    app: { locked, password: Boolean(password) },
    site: locked ? null : session.status(),
  });
  /** Forward to the Python server, with a fresh token in the database for it to use. */
  const toBackend = async (c: Context) => {
    await session.token();
    const url = new URL(c.req.url);
    try {
      return await deps.backend(c.req.raw, url.pathname + url.search);
    } catch (e) {
      if (e instanceof BadRequest) {
        throw e;
      }
      return error(502, `The catalog server isn’t responding: ${String(e)}`);
    }
  };

  app.onError((e) => {
    if (e instanceof BadRequest) {
      return error(400, e.message);
    }
    console.error(e);
    return error(500, 'Internal error');
  });
  app.notFound(() => error(404, 'Not found'));

  // Headers on every reply.
  app.use(async (c, next) => {
    await next();
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'no-referrer');
    if (!c.res.headers.has('Cache-Control')) {
      c.res.headers.set('Cache-Control', 'no-store');
    }
  });
  app.use(compress({ encoding: 'gzip' }));
  app.use(bodyLimit({ maxSize: MAX_BODY, onError: () => error(400, 'Request body too large') }));

  // Host, CSRF and password checks.
  app.use(async (c, next) => {
    const path = c.req.path;
    const host = hostname(c.req.header('Host'));
    if (!password && !hosts.has(host)) {
      return error(403, `Host '${host}' not allowed (use --allow-host, or set a password)`);
    }
    if (!['GET', 'HEAD'].includes(c.req.method) && !c.req.header('X-TLX-Client')) {
      return error(403, 'Missing X-TLX-Client header');
    }
    const guarded = ['/api/', '/backend/', '/ws'].some((p) => path.startsWith(p));
    if (guarded && !PUBLIC_PATHS.has(path) && !unlocked(c)) {
      return error(401, 'app_locked');
    }
    return next();
  });

  // -- this server's API ------------------------------------------------------
  app.get('/api/health', () => json({ ok: true, version: VERSION }));
  app.get('/api/me', (c) => json(me(c)));
  app.post('/api/app-login', async (c) => {
    const given = text(prop(await readJson(c.req.raw), 'password'));
    if (!password || samePassword(given, password)) {
      const sid = randomBytes(32).toString('base64url');
      store.addSession(sid);
      const res = json(me(c, false));
      res.headers.set('Set-Cookie', cookie(c, sid, SESSION_MAX_AGE));
      return res;
    }
    await Bun.sleep(deps.wrongPasswordDelayMs ?? 1000);
    return error(401, 'Wrong password.');
  });
  app.post('/api/app-logout', (c) => {
    const sid = sessionId(c);
    if (sid) {
      store.dropSession(sid);
    }
    const res = json(me(c, Boolean(password)));
    res.headers.set('Set-Cookie', cookie(c, '', 0));
    return res;
  });
  app.post('/api/site-login', async (c) => {
    const d = await readJson(c.req.raw);
    const failed = await session.login(text(prop(d, 'email')).trim(), text(prop(d, 'password')));
    if (!failed) {
      // Pick up your standings and watchlist when a pull is allowed.
      const pull = new Request('http://backend/api/pull', {
        method: 'POST',
        headers: { 'X-TLX-Client': '1' },
      });
      deps
        .backend(pull, '/api/pull')
        .catch((e: unknown) => console.warn(`pull request failed: ${String(e)}`));
    }
    return json({ error: failed, ...me(c) });
  });
  app.post('/api/site-logout', async (c) => {
    await session.logout();
    return json(me(c));
  });
  app.all('/api/*', toBackend);

  // -- the site's API ---------------------------------------------------------
  app.all('/backend/v1/*', async (c) => {
    const url = new URL(c.req.url);
    if (url.pathname.split('/').includes('..')) {
      return error(404, 'Not found');
    }
    const method = c.req.method;
    if (method === 'GET' && BACKEND_READS.some((re) => re.test(url.pathname))) {
      return toBackend(c);
    }
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      ? await c.req.raw.arrayBuffer()
      : null;
    const send = async (token: string | null) => {
      const headers = new Headers();
      for (const h of PROXY_HEADERS) {
        const v = c.req.header(h);
        if (v) {
          headers.set(h, v);
        }
      }
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return siteFetch(SITE + url.pathname + url.search, {
        method,
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
        ...(body ? { body } : {}),
      });
    };
    let res: Response;
    try {
      const token = await session.token();
      res = await send(token);
      // A 401 means the request wasn't processed, so retrying is safe even for bids.
      if (res.status === 401 && token) {
        const fresh = await session.rejected(token);
        if (fresh) {
          res = await send(fresh);
        }
        if (res.status === 401 && method === 'GET') {
          res = await send(null); // fall back to anonymous data
        }
      }
    } catch (e) {
      return error(502, `Couldn’t reach the site: ${String(e)}`);
    }
    return new Response(method === 'HEAD' ? null : await res.arrayBuffer(), {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    });
  });

  // -- the site's websocket -----------------------------------------------------
  app.get('/ws', async (c) => {
    const server = c.env as Server<RelayData> | undefined; // absent outside Bun.serve (tests)
    if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket' || !server) {
      return error(400, 'Expected a websocket upgrade');
    }
    const origin = c.req.header('Origin');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        // an unreadable Origin is cross-origin
      }
      if (originHost !== (c.req.header('Host') ?? '').toLowerCase()) {
        return error(403, 'Cross-origin websocket');
      }
    }
    const protocols = (c.req.header('Sec-WebSocket-Protocol') ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    let upstream: WebSocket;
    try {
      upstream = await connectUpstream(deps.wsUrl ?? WS_URL, protocols);
    } catch (e) {
      return error(502, `Couldn’t reach the live-updates server: ${String(e)}`);
    }
    const headers = upstream.protocol ? { 'Sec-WebSocket-Protocol': upstream.protocol } : undefined;
    if (
      !server.upgrade(c.req.raw, { data: relayData(upstream), ...(headers ? { headers } : {}) })
    ) {
      upstream.close();
      return error(400, 'Websocket upgrade failed');
    }
    return new Response(null); // Bun answers the upgrade itself
  });

  // -- the app itself -----------------------------------------------------------
  app.on(['GET', 'HEAD'], '*', async (c) => {
    const name = PAGES[c.req.path] ?? c.req.path.replace(/^\/+/, '');
    const path = resolve(staticDir, name);
    const file = Bun.file(path);
    if (!path.startsWith(staticDir + sep) || !(await file.exists())) {
      return error(404, 'Not found');
    }
    // Built assets have content hashes in their names; the page itself must always be fresh.
    const cache = name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    return new Response(c.req.method === 'HEAD' ? null : file, {
      headers: { 'Content-Type': file.type, 'Cache-Control': cache },
    });
  });

  return app;
}
