// Catalog source for the web app, which the tlx server (server/, Python)
// serves: the server pulls the full catalog, stores it, and records when each
// lot was first seen; this page just fetches what changed. The server also
// keeps the SYNCED_KEYS settings, so every device using it shares filters,
// hidden lots, custom categories and saved searches.
//
// Each poll tells the server whether this tab is in use (it only pulls while
// some tab is, unless run with --background-minutes). Its pulls use its own
// login to the site, so they include your standing and watchlist.
import { authReady, onAuthChange, refreshSession } from './auth';
import { changed, inUse, state, trackActivity, type CatalogMeta } from './catalog';
import { applySetting, getSetting, setSaveHook, type Key } from './settings';
import { DEFAULTS, SYNCED_KEYS } from '../shared/keys';
import type { Lot } from './types';

/** Poll interval while a pull is running (for the progress bar), while visible, and while hidden. */
const POLL_PULLING = 2_000;
const POLL_VISIBLE = 15_000;
const POLL_HIDDEN = 60_000;
const TIMEOUT = 30_000;

/** Call the tlx server and parse its JSON reply. */
async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        Accept: 'application/json',
        'X-TLX-Client': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Can’t reach the tlx server. Check your connection.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    void refreshSession(); // the app got locked: the page shows the password prompt
  }
  if (!res.ok || !data) {
    throw new Error(data?.error || `tlx server replied ${res.status}`);
  }
  return data as T;
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
/** When the server allows the next pull, in our clock. */
let nextAt = 0;
/** Why the last request to the server failed, if it did. */
let serverError: string | null = null;

/** Take the server's pull status. */
function applyStatus(s: Status) {
  const skew = s.now - Date.now(); // server clock minus ours
  nextAt = s.nextPullAt - skew;
  state.meta = s.meta;
  state.progress = s.progress;
  state.error = s.error;
}

/** Merge a catalog reply into memory. */
function applyCatalog(r: CatalogReply) {
  const before = { seq, fetchedAt: state.meta.fetchedAt, progress: JSON.stringify(state.progress), error: state.error, loaded: state.loaded };
  applyStatus(r);
  if (r.full || r.lots.length || (r.ids && r.ids.length !== state.lots.size)) {
    // A new Map, so views keyed on the catalog's identity recompute.
    const next = new Map(r.full ? [] : state.lots);
    if (r.ids) {
      const keep = new Set(r.ids);
      next.forEach((_, id) => keep.has(id) || next.delete(id));
    }
    r.lots.forEach((l) => next.set(l.id, l));
    state.lots = keepNewer(next, r.lots);
  }
  seq = r.seq;
  state.loaded = true;
  if (
    !before.loaded ||
    before.seq !== seq ||
    before.fetchedAt !== state.meta.fetchedAt ||
    before.progress !== JSON.stringify(state.progress) ||
    before.error !== state.error
  ) {
    changed();
  }
}

/**
 * Websocket updates that arrived since the server's pull may be newer (by
 * `version`) than the lots it sent, so those win, keeping the pull's
 * first-seen time.
 */
function keepNewer(next: Map<number, Lot>, lots: Lot[]): Map<number, Lot> {
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
      const r = await call<CatalogReply>('GET', `/api/catalog?since=${seq}`, undefined, { 'X-TLX-Active': inUse() ? '1' : '0' });
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

/** The Refresh button: ask the server to pull now; it refuses if the interval hasn't passed. */
export async function pullCatalog() {
  try {
    applyStatus(await call<Status>('POST', '/api/pull'));
    changed();
    // Poll soon so the progress bar shows up.
    window.setTimeout(() => void poll(), 500);
  } catch (err) {
    setServerError(err);
  }
}

/** Epoch ms when the next full pull is allowed. */
export const nextPullAt = () => nextAt;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const synced = new Set<Key>(SYNCED_KEYS);
/** Last settings revision applied here (0 = not synced yet). */
let settingsRev = 0;
let markSynced: () => void;
/** Resolves once the first settings sync has finished (the catalog has loaded by then too). */
export const settingsSynced = new Promise<void>((resolve) => (markSynced = resolve));
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
 * Pull settings changed on the server since last time. The first sync takes
 * the server's values, and sends up any setting it doesn't have yet but this
 * browser does.
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
  if (first) {
    markSynced();
  }
}

/** Load what the server has and keep it fresh. */
export function startCatalog() {
  setSaveHook((key, value) => synced.has(key) && void sendSetting(key, value));
  trackActivity(() => void poll());
  // A new login (or logout) changes what the server's pulls will see; check in now.
  onAuthChange(() => void poll());
  void poll();
}
