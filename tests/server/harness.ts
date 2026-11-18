// A whole server in memory for HTTP tests: the real store, catalog, history and
// app, with the site faked (next-auth by FakeSite, the API by real captured
// replies unless a test answers itself).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../../src/server/app';
import { Catalog } from '../../src/server/catalog';
import { History } from '../../src/server/history';
import { SiteSession } from '../../src/server/session';
import { SiteApi } from '../../src/server/site';
import { Store } from '../../src/server/store';
import { FakeSite } from './fake-site';

export interface Captured {
  request: { path: string };
  status: number;
  contentType: string;
  body: unknown;
}
export const fixture = (name: string): Captured =>
  JSON.parse(readFileSync(new URL(`../fixtures/site/${name}`, import.meta.url), 'utf8'));
const CAPTURED = [
  'lots-newly-listed.json',
  'lots-ending-soonest.json',
  'lot-detail-with-brand-model.json',
  'lot-detail-without-brand-model.json',
].map(fixture);
const NOT_FOUND = fixture('lot-detail-not-found.json');

export const staticRoot = mkdtempSync(join(tmpdir(), 'tlx-app-'));
const staticDir = join(staticRoot, 'static');
mkdirSync(join(staticDir, 'assets'), { recursive: true });
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>TL Catalog</title>');
writeFileSync(join(staticDir, 'tags.html'), '<!doctype html><title>Tags</title>');
writeFileSync(
  join(staticDir, 'assets', 'app-1234.js'),
  `console.log(${JSON.stringify('x'.repeat(5000))});`,
);
writeFileSync(join(staticRoot, 'secret.txt'), 'not for the web');

export interface SiteCall {
  method: string;
  path: string;
  headers: Headers;
  body: string;
}

export interface Options {
  password?: string;
  loggedIn?: boolean;
  /** Answer the site's API; by default, captured replies for their paths and a 404 otherwise. */
  site?: (call: SiteCall) => Response;
}

export async function setup(options: Options = {}) {
  const store = new Store(':memory:');
  const fake = new FakeSite();
  const siteCalls: SiteCall[] = [];
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
    const captured = CAPTURED.find((c) => c.request.path === call.path) ?? NOT_FOUND;
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
  const site = new SiteApi(siteFetch);
  const history = new History(store, site, () => Promise.resolve());
  const catalog = new Catalog(store, session, history, site);
  const pulls: string[] = [];
  const requestPull = catalog.requestPull.bind(catalog);
  catalog.requestPull = () => {
    const result = requestPull();
    pulls.push(result);
    return result;
  };
  const app = createApp({
    store,
    session,
    catalog,
    history,
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
  const send = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    request(path, {
      method,
      headers: { 'X-TLX-Client': '1', 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    send('POST', path, body, headers);
  return { store, fake, session, site, history, catalog, pulls, siteCalls, request, send, post };
}
