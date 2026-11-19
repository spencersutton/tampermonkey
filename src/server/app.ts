// The HTTP side: serves the web app and everything it talks to. The app can't
// talk to the site directly: the site's API sends no CORS headers and its
// websocket only accepts its own Origin. So this server stands in for the site:
//
//   /backend/v1/...  the site's JSON API, with the server's login token added
//                    (refreshed and retried once on a 401, like the site's client)
//   /ws              the site's live-updates websocket, relayed (relay.ts)
//   /api/...         this server's own endpoints:
//     GET  /api/me                login state (this app's and the site's)
//     POST /api/app-login         {"password"}; sets the session cookie
//     POST /api/app-logout
//     POST /api/site-login        {"email", "password"}; the server signs in to the site
//     POST /api/site-logout
//     GET  /api/catalog?since=N   lots changed after sequence N, the id list, and pull status
//     POST /api/pull              start a full pull if one is allowed
//     GET  /api/lot-metadata?id=N&auctionPeriod=P   saved item details, without asking the site
//     GET  /api/settings          every synced setting, with the revision
//     PUT  /api/settings/<key>    {"value": ...}; last write wins
//     PUT  /api/item-type         {"lotId", "itemType"}; correct every listing of the same item; replies with their lotIds
//     GET  /api/history?id=N      closed lots matching item N, most recent first
//     GET  /api/tag-rules         tag rules with their lot counts, and every tag in use
//     GET  /api/tag-rules/preview?pattern=P&tag=T...   the current lots a pattern matches, by title, with the tags it'd add
//     POST /api/tag-rules         {"pattern", "tags"}; add a rule
//     PUT  /api/tag-rules/<id>    {"pattern", "tags"}; change a rule
//     DELETE /api/tag-rules/<id>
//     GET  /api/health
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

import { cleanType, MAX_TYPE_LENGTH } from '../shared/itemtype';
import type { RawLotDetail } from '../shared/lot';
import { SITE } from '../shared/site';
import type { Catalog } from './catalog';
import { HISTORY_LIMIT, type History } from './history';
import { isRecord, prop } from './json';
import { log } from './log';
import { connectUpstream, relayData, type RelayData } from './relay';
import type { SiteSession } from './session';
import { VERSION, WS_URL } from './site';
import type { Store } from './store';
import { PatternError, RuleError, TagTemplateError } from './tags';

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
// /backend replies the server keeps data from: lot details and the Won/Lost pages.
const LOT_DETAIL_PATH = /^\/backend\/v1\/auctions\/lots\/[^/]+\/\d+\/$/;
const CLOSED_PATH = /^\/backend\/v1\/auctions\/control-panel\/closed\/(won|lost)\/$/;
const SETTING_KEY = /^[A-Za-z0-9_]{1,64}$/;
const PREVIEW_LIMIT = 300;
const MAX_ID = Number.MAX_SAFE_INTEGER;
const PAGES: Record<string, string> = {
  '/': 'index.html',
  '/tlx': 'index.html',
  '/tlx/': 'index.html',
  '/tags': 'tags.html',
  '/tags/': 'tags.html',
};

export interface Deps {
  store: Store;
  session: SiteSession;
  catalog: Catalog;
  history: History;
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

/** A query parameter as an integer (like Python's int()), or null. */
function integer(v: string | undefined): number | null {
  return v !== undefined && /^\s*[+-]?\d+\s*$/.test(v) ? Number(v) : null;
}

// Characters Python's str.isprintable() refuses, other than whitespace.
const UNPRINTABLE = /(?![\s])[\p{C}\p{Zl}\p{Zp}]/u;

function ruleBody(body: Record<string, unknown>): [string, string[]] {
  const pattern = prop(body, 'pattern');
  const tags = prop(body, 'tags');
  if (
    typeof pattern !== 'string' ||
    !Array.isArray(tags) ||
    !tags.every(t => typeof t === 'string')
  ) {
    throw new BadRequest('Expected {"pattern": string, "tags": [string]}');
  }
  return [pattern, tags];
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');

const digest = (s: string) => createHash('sha256').update(s).digest();
const samePassword = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

export function createApp(deps: Deps) {
  const { store, session, catalog, history, password } = deps;
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
  const status = () => {
    const meta = store.meta();
    return {
      now: Date.now(),
      meta,
      nextPullAt: catalog.nextPullAt(meta),
      progress: catalog.progress && { ...catalog.progress },
      error: catalog.error,
    };
  };

  app.onError(e => {
    if (e instanceof BadRequest || e instanceof RuleError) {
      return error(400, e.message);
    }
    if (e instanceof PatternError || e instanceof TagTemplateError) {
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
    const guarded = ['/api/', '/backend/', '/ws'].some(p => path.startsWith(p));
    if (guarded && !PUBLIC_PATHS.has(path) && !unlocked(c)) {
      return error(401, 'app_locked');
    }
    return next();
  });

  // -- this server's API ------------------------------------------------------
  app.get('/api/health', () => json({ ok: true, version: VERSION }));
  app.get('/api/me', c => json(me(c)));
  app.post('/api/app-login', async c => {
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
  app.post('/api/app-logout', c => {
    const sid = sessionId(c);
    if (sid) {
      store.dropSession(sid);
    }
    const res = json(me(c, Boolean(password)));
    res.headers.set('Set-Cookie', cookie(c, '', 0));
    return res;
  });
  app.post('/api/site-login', async c => {
    const d = await readJson(c.req.raw);
    const failed = await session.login(text(prop(d, 'email')).trim(), text(prop(d, 'password')));
    if (!failed) {
      catalog.requestPull(); // pick up your standings and watchlist when allowed
    }
    return json({ error: failed, ...me(c) });
  });
  app.post('/api/site-logout', async c => {
    await session.logout();
    return json(me(c));
  });

  app.get('/api/catalog', c => {
    catalog.heartbeat(c.req.header('X-TLX-Active') === '1');
    const since = Math.max(0, Number.parseInt(c.req.query('since') ?? '0', 10) || 0);
    const changes = store.changes(since);
    const full = since === 0 || since > changes.seq;
    return json({
      seq: changes.seq,
      full,
      ids: full ? null : changes.ids,
      ...status(),
      lots: changes.lots,
    });
  });
  app.get('/api/lot-metadata', c => {
    const id = integer(c.req.query('id'));
    const period = c.req.query('auctionPeriod') ?? '';
    if (id === null || id <= 0 || id > MAX_ID || !period) {
      throw new BadRequest('Expected a positive lot id and auctionPeriod');
    }
    return json({ metadata: store.lotMetadata(id, period) });
  });
  app.post('/api/pull', () => json({ result: catalog.requestPull(), ...status() }));
  app.get('/api/settings', () => json(store.settings()));
  app.put('/api/settings/:key', async c => {
    const key = c.req.param('key');
    if (!SETTING_KEY.test(key)) {
      throw new BadRequest(`Bad setting key '${key}'`);
    }
    const body = await readJson(c.req.raw);
    if (!('value' in body)) {
      throw new BadRequest('Expected {"value": ...}');
    }
    return json({ rev: store.putSetting(key, body['value']) });
  });
  app.get('/api/history', c => {
    const id = integer(c.req.query('id'));
    const lot = id === null ? null : store.lot(id);
    if (!lot) {
      throw new BadRequest(id === null ? 'Expected a lot id' : 'No such open lot');
    }
    return json({ closes: history.closesFor(lot).slice(0, HISTORY_LIMIT) });
  });
  app.put('/api/item-type', async c => {
    const body = await readJson(c.req.raw);
    const id = prop(body, 'lotId');
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || id > MAX_ID) {
      throw new BadRequest('Expected a positive integer lotId');
    }
    const given = prop(body, 'itemType');
    const itemType = typeof given === 'string' ? cleanType(given) : '';
    if (
      typeof given !== 'string' ||
      given.length > MAX_TYPE_LENGTH ||
      UNPRINTABLE.test(given) ||
      !itemType
    ) {
      throw new BadRequest(`Item type must be 1 to ${MAX_TYPE_LENGTH} characters`);
    }
    const lot = store.lot(id);
    if (!lot) {
      return error(404, 'No such catalog lot');
    }
    const changed = store.saveLotTypes([[lot, itemType]], { manual: true });
    const ids = new Set([
      id,
      ...changed
        .entries()
        .filter(([, t]) => t === itemType)
        .map(([i]) => i),
    ]);
    return json({
      lotIds: ids
        .values()
        .toArray()
        .toSorted((a, b) => a - b),
      itemType,
      seq: store.seq(),
    });
  });
  app.get('/api/tag-rules', () => {
    const { rules, tags } = store.tagOverview();
    return json({ rules: rules.map(([rule, lots]) => ({ ...rule, lots })), tags });
  });
  app.get('/api/tag-rules/preview', c => {
    try {
      return json(
        store.previewTagRule(
          c.req.query('pattern') ?? '',
          c.req.queries('tag') ?? [],
          PREVIEW_LIMIT,
        ),
      );
    } catch (e) {
      if (e instanceof PatternError || e instanceof TagTemplateError) {
        return json(
          { error: e.message, field: e instanceof PatternError ? 'pattern' : 'tags' },
          400,
        );
      }
      throw e;
    }
  });
  app.post('/api/tag-rules', async c => {
    const [rule, changed] = store.addTagRule(...ruleBody(await readJson(c.req.raw)));
    return json({ rule, changed: changed.size });
  });
  app.put('/api/tag-rules/:id{[0-9]{1,9}}', async c => {
    const updated = store.updateTagRule(
      Number(c.req.param('id')),
      ...ruleBody(await readJson(c.req.raw)),
    );
    return updated
      ? json({ rule: updated[0], changed: updated[1].size })
      : error(404, 'No such tag rule');
  });
  app.delete('/api/tag-rules/:id{[0-9]{1,9}}', c => {
    const changed = store.removeTagRule(Number(c.req.param('id')));
    return changed ? json({ changed: changed.size }) : error(404, 'No such tag rule');
  });
  app.all('/api/*', () => error(404, 'Not found'));

  // -- the site's API ---------------------------------------------------------
  app.all('/backend/v1/*', async c => {
    const url = new URL(c.req.url);
    if (url.pathname.split('/').includes('..')) {
      return error(404, 'Not found');
    }
    const method = c.req.method;
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
    let data: ArrayBuffer | string = await res.arrayBuffer();
    if (method === 'GET' && res.status === 200) {
      data = keep(url.pathname, data);
    }
    return new Response(method === 'HEAD' ? null : data, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/json' },
    });
  });

  /**
   * Keep what the server wants from a site reply (lot details, closed lots' identities); returns
   * the reply to send on.
   */
  function keep(path: string, data: ArrayBuffer): ArrayBuffer | string {
    try {
      if (LOT_DETAIL_PATH.test(path)) {
        const raw: unknown = JSON.parse(new TextDecoder().decode(data));
        if (isRecord(raw) && typeof raw['id'] === 'number') {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the site's lot detail (see tests/fixtures/site)
          store.saveLotDetail(raw as unknown as RawLotDetail);
          history.wake();
        }
      } else if (CLOSED_PATH.test(path)) {
        const payload: unknown = JSON.parse(new TextDecoder().decode(data));
        const results = prop(payload, 'results');
        if (Array.isArray(results)) {
          const closed = results.filter(isRecord);
          store.annotateIdentities(closed, 'lot_id');
          history.relisted(closed);
          return JSON.stringify(payload);
        }
      }
    } catch (e) {
      log.warn(`couldn't keep data from ${path}: ${String(e)}`);
    }
    return data;
  }

  // -- the site's websocket -----------------------------------------------------
  app.get('/ws', async c => {
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
      .map(p => p.trim())
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
  app.on(['GET', 'HEAD'], '*', async c => {
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
