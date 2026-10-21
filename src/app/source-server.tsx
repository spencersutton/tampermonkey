// Catalog source for the server build: the tlx server (server/, Python)
// pulls the full catalog, stores it, and records when each lot was first
// seen; this page just fetches what changed. The server also keeps the
// SYNCED_KEYS settings, so every browser using it shares filters, hidden lots,
// custom categories and saved searches.
//
// Requests go through GM_xmlhttpRequest, so no CORS, mixed-content or
// local-network rules get in the way of reaching http://127.0.0.1.
//
// Each poll tells the server whether this tab is in use (it only pulls while
// some tab is, unless run with --background-minutes) and passes the site
// login token, so its pulls include your standing and watchlist.
import { GM_xmlhttpRequest } from 'vite-plugin-monkey/dist/client';
import { authToken, isAuthenticated } from './api';
import { authReady, onAuthChange } from './auth';
import { changed, inUse, keepNewer, state, trackActivity, type CatalogSource, type PullResult } from './catalog';
import type { CatalogMeta } from './db';
import { applySetting, getSetting, onSetting, setSaveHook, useSetting, type Key } from './gm';
import { DEFAULTS, KEYS, SYNCED_KEYS } from '../shared/keys';
import type { Lot } from './types';

/** Poll interval while a pull is running (for the progress bar), while visible, and while hidden. */
const POLL_PULLING = 2_000;
const POLL_VISIBLE = 15_000;
const POLL_HIDDEN = 60_000;
const TIMEOUT = 30_000;

class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number, // 0 = unreachable
  ) {
    super(message);
  }
}

/** The server address from settings, without a trailing slash. */
const baseUrl = () => String(getSetting(KEYS.serverUrl) || DEFAULTS[KEYS.serverUrl]).replace(/\/+$/, '');

/** Call the tlx server and parse its JSON reply. */
function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const key = String(getSetting(KEYS.serverKey) || '');
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method,
      url: baseUrl() + path,
      headers: {
        Accept: 'application/json',
        'X-TLX-Client': '1',
        ...(key ? { 'X-TLX-Key': key } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      data: body === undefined ? undefined : JSON.stringify(body),
      timeout: TIMEOUT,
      responseType: 'text',
      onload: (res) => {
        let data: any = null;
        try {
          data = JSON.parse(res.responseText);
        } catch {
          // not JSON; handled below
        }
        if (res.status >= 200 && res.status < 300 && data) {
          resolve(data as T);
        } else {
          reject(new ServerError(data?.error || `tlx server replied ${res.status}`, res.status));
        }
      },
      onerror: () => reject(new ServerError(`Can’t reach the tlx server at ${baseUrl()}. Is it running?`, 0)),
      ontimeout: () => reject(new ServerError(`The tlx server at ${baseUrl()} didn’t answer.`, 0)),
    });
  });
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------
interface Status {
  now: number;
  meta: CatalogMeta;
  nextPullAt: number;
  progress: { done: number; total: number | null } | null;
  error: string | null;
}

interface CatalogReply extends Status {
  seq: number;
  full: boolean;
  ids: number[] | null; // every current lot id (delta replies only)
  lots: Lot[]; // lots changed since the requested sequence
}

/** Last catalog sequence applied here (0 = have nothing). */
let seq = 0;
/** Server clock minus ours, so its next-pull time counts down correctly here. */
let skew = 0;
/** When the server allows the next pull, in our clock. */
let nextAt = 0;
/** Why the last request to the server failed, if it did. */
let serverError: string | null = null;

/** Take the server's pull status. */
function applyStatus(s: Status) {
  skew = s.now - Date.now();
  nextAt = s.nextPullAt - skew;
  state.meta = s.meta;
  state.progress = s.progress;
  state.error = s.error;
}

/** Merge a catalog reply into memory. */
function applyCatalog(r: CatalogReply) {
  const before = { seq, fetchedAt: state.meta.fetchedAt, progress: JSON.stringify(state.progress), error: state.error };
  applyStatus(r);
  if (r.full || r.lots.length || (r.ids && r.ids.length !== state.lots.size)) {
    // A new Map, so views keyed on the catalog's identity recompute.
    const next = new Map(r.full ? [] : state.lots);
    if (r.ids) {
      const keep = new Set(r.ids);
      next.forEach((_, id) => keep.has(id) || next.delete(id));
    }
    r.lots.forEach((l) => next.set(l.id, l));
    state.lots = r.full ? keepNewer(next) : mergeChanged(next, r.lots);
  }
  seq = r.seq;
  const wasLoaded = state.loaded;
  state.loaded = true;
  if (
    !wasLoaded ||
    before.seq !== seq ||
    before.fetchedAt !== state.meta.fetchedAt ||
    before.progress !== JSON.stringify(state.progress) ||
    before.error !== state.error
  ) {
    changed();
  }
}

/** Like keepNewer, but only for the lots that just changed. */
function mergeChanged(next: Map<number, Lot>, lots: Lot[]): Map<number, Lot> {
  for (const fresh of lots) {
    const mine = state.lots.get(fresh.id);
    if (mine && mine.version > fresh.version) {
      next.set(fresh.id, { ...mine, firstSeenAt: fresh.firstSeenAt });
    }
  }
  return next;
}

/** Report a failed request in the status bar (once it changes). */
function setServerError(err: unknown) {
  const message = (err as Error).message || String(err);
  if (message !== serverError) {
    serverError = message;
    state.error = message;
    state.loaded = true;
    changed();
  }
}

let pollTimer = 0;
let polling: Promise<void> | null = null;

/** Fetch catalog changes (and settings), then schedule the next poll. */
function poll(): Promise<void> {
  return (polling ??= (async () => {
    clearTimeout(pollTimer);
    try {
      await authReady();
      const r = await call<CatalogReply>('GET', `/api/catalog?since=${seq}`, undefined, {
        'X-TLX-Active': inUse() ? '1' : '0',
        'X-TL-Token': isAuthenticated() ? (authToken() ?? '') : '',
      });
      serverError = null;
      applyCatalog(r);
      await syncSettings();
    } catch (err) {
      setServerError(err);
    } finally {
      polling = null;
      const wait = state.progress ? POLL_PULLING : document.visibilityState === 'visible' ? POLL_VISIBLE : POLL_HIDDEN;
      pollTimer = window.setTimeout(() => void poll(), wait);
    }
  })());
}

/** Ask the server to pull now; it refuses if the interval hasn't passed. */
async function pullCatalog(): Promise<PullResult> {
  try {
    const r = await call<Status & { result: 'started' | 'not-due' | 'busy' }>('POST', '/api/pull');
    applyStatus(r);
    changed();
    // Poll soon so the progress bar shows up.
    window.setTimeout(() => void poll(), 500);
    return r.result;
  } catch (err) {
    setServerError(err);
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const synced = new Set<Key>(SYNCED_KEYS);
/** Last settings revision applied here (0 = never synced with this server). */
let settingsRev = 0;
/** Synced settings saved here that the server hasn't confirmed yet. */
const unsent = new Map<Key, unknown>();

/** Send a synced setting to the server; if that fails, it's retried on the next poll. */
async function sendSetting(key: Key, value: unknown) {
  unsent.set(key, value);
  try {
    await call('PUT', `/api/settings/${encodeURIComponent(key)}`, { value });
    if (unsent.get(key) === value) {
      unsent.delete(key);
    }
  } catch {
    // stays in `unsent`
  }
}

/**
 * Pull settings changed on the server since last time. The first sync with a
 * server takes its values, and sends up any setting it doesn't have yet but
 * this browser does (so an existing setup moves over).
 */
async function syncSettings() {
  await Promise.all([...unsent].map(([k, v]) => sendSetting(k, v)));
  const first = settingsRev === 0;
  const r = await call<{ rev: number; values: Record<string, unknown> }>('GET', `/api/settings?since=${settingsRev}`);
  for (const [key, value] of Object.entries(r.values)) {
    if (synced.has(key as Key) && !unsent.has(key as Key) && JSON.stringify(value) !== JSON.stringify(getSetting(key as Key))) {
      applySetting(key as Key, value as never);
    }
  }
  if (first) {
    for (const key of synced) {
      const mine = getSetting(key);
      if (!(key in r.values) && JSON.stringify(mine) !== JSON.stringify(DEFAULTS[key])) {
        void sendSetting(key, mine);
      }
    }
  }
  settingsRev = r.rev;
}

/** Start over against a different server (or key). */
function reconnect() {
  seq = 0;
  settingsRev = 0;
  serverError = null;
  void poll();
}

/** Server address and key, under Settings. */
function ServerSettings() {
  const [url, setUrl] = useSetting(KEYS.serverUrl);
  const [key, setKey] = useSetting(KEYS.serverKey);
  return (
    <>
      <label class="field">
        <span>tlx server address</span>
        <input
          type="url"
          value={url}
          placeholder={DEFAULTS[KEYS.serverUrl]}
          onChange={(e) => setUrl(e.currentTarget.value.trim() || DEFAULTS[KEYS.serverUrl])}
        />
      </label>
      <label class="field">
        <span>tlx server key (if it was started with --key)</span>
        <input type="password" value={key} autocomplete="off" onChange={(e) => setKey(e.currentTarget.value.trim())} />
      </label>
    </>
  );
}

export const source: CatalogSource = {
  async start() {
    setSaveHook((key, value) => synced.has(key) && void sendSetting(key, value));
    trackActivity(() => void poll());
    onSetting(KEYS.serverUrl, reconnect);
    onSetting(KEYS.serverKey, reconnect);
    // A new login (or logout) changes what the server's pulls can see; tell it now.
    onAuthChange(() => void poll());
    await poll();
  },
  pullCatalog,
  nextPullAt: () => nextAt,
  Settings: ServerSettings,
};
