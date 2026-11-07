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
import { batch } from '@preact/signals';
import { error, inUse, loaded, lots, meta, progress, trackActivity, updateTitleItemType, type CatalogMeta } from './catalog';
import { applySetting, getSetting, setSaveHook, type Key } from './settings';
import { DEFAULTS, KEYS, SYNCED_KEYS } from '../shared/keys';
import type { Lot, PastClose, PastCloseDetail } from './types';

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
      // oxlint-disable-next-line unicorn/no-invalid-fetch-options
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
  meta: Omit<CatalogMeta, 'fetchedAt' | 'pullStartedAt'> & { fetchedAt: number | null; pullStartedAt: number | null };
  nextPullAt: number;
  progress: { done: number; total: number | null } | null;
  error: string | null;
}

type ServerPastClose = Omit<PastClose, 'endsAt'> & { endsAt: number };
type ServerPastCloseDetail = Omit<PastCloseDetail, 'endsAt'> & { endsAt: number };
type ServerLot = Omit<Lot, 'endsAt' | 'firstSeenAt' | 'pastCloses'> & {
  endsAt: number;
  firstSeenAt?: number;
  pastCloses?: { n: number; recent: ServerPastClose[] };
};

interface CatalogReply extends Status {
  seq: number;
  full: boolean;
  ids: number[] | null; // every current lot id (delta replies only)
  lots: ServerLot[]; // lots changed since the requested sequence
}

function instantFromEpochMilliseconds(ms: number): Temporal.Instant {
  if (!Number.isSafeInteger(ms)) {
    throw new TypeError('Invalid epoch-millisecond timestamp from the tlx server');
  }
  return Temporal.Instant.fromEpochMilliseconds(ms);
}

function normalizePastClose<T extends ServerPastClose>(close: T): Omit<T, 'endsAt'> & { endsAt: Temporal.Instant } {
  return { ...close, endsAt: instantFromEpochMilliseconds(close.endsAt) };
}

function normalizeCatalogLot(lot: ServerLot): Lot {
  return {
    ...lot,
    endsAt: instantFromEpochMilliseconds(lot.endsAt),
    firstSeenAt: lot.firstSeenAt == null ? undefined : instantFromEpochMilliseconds(lot.firstSeenAt),
    pastCloses: lot.pastCloses && { ...lot.pastCloses, recent: lot.pastCloses.recent.map(normalizePastClose) },
  };
}

/** Last catalog sequence applied here (0 = have nothing). */
let seq = 0;
/** When the server allows the next pull, in our clock. */
let nextAt: Temporal.Instant | null = null;
/** Why the last request to the server failed, if it did. */
let serverError: string | null = null;
/** Local corrections not yet included in a catalog poll; protect them from an older in-flight reply. */
const typeEdits = new Map<string, { itemType: string; seq: number }>();

/** Take the server's pull status. */
function applyStatus(s: Status) {
  const skew = s.now - Date.now(); // server clock minus ours
  nextAt = instantFromEpochMilliseconds(s.nextPullAt - skew);
  meta.value = {
    ...s.meta,
    fetchedAt: s.meta.fetchedAt ? instantFromEpochMilliseconds(s.meta.fetchedAt) : null,
    pullStartedAt: s.meta.pullStartedAt == null ? null : instantFromEpochMilliseconds(s.meta.pullStartedAt),
  };
  progress.value = s.progress;
  error.value = s.error;
}

/** Merge a catalog reply into memory. */
export function applyCatalog(r: CatalogReply) {
  const pulled = r.lots.map(normalizeCatalogLot);
  batch(() => {
    applyStatus(r);
    const cur = lots.peek();
    if (r.full || r.lots.length || (r.ids && r.ids.length !== cur.size)) {
      const next = new Map(r.full ? [] : cur);
      if (r.ids) {
        const keep = new Set(r.ids);
        next.forEach((_, id) => keep.has(id) || next.delete(id));
      }
      pulled.forEach((l) => next.set(l.id, l));
      const merged = keepNewer(next, pulled);
      for (const [title, edit] of typeEdits) {
        if (r.seq < edit.seq) {
          for (const [id, lot] of merged) {
            if (lot.title === title) {
              merged.set(id, { ...lot, itemType: edit.itemType });
            }
          }
        }
      }
      lots.value = merged;
    }
    for (const [title, edit] of typeEdits) {
      if (r.seq >= edit.seq) {
        typeEdits.delete(title);
      }
    }
    seq = r.seq;
    loaded.value = true;
  });
}

/**
 * Websocket updates that arrived since the server's pull may be newer (by
 * `version`) than the lots it sent, so those win, keeping the pull's
 * first-seen time and authoritative item type.
 */
function keepNewer(next: Map<number, Lot>, pulled: Lot[]): Map<number, Lot> {
  for (const fresh of pulled) {
    const mine = lots.peek().get(fresh.id);
    if (mine && mine.version > fresh.version) {
      next.set(fresh.id, { ...mine, firstSeenAt: fresh.firstSeenAt, itemType: fresh.itemType });
    }
  }
  return next;
}

/** Report a failed request in the status bar (once it changes). */
function setServerError(err: unknown) {
  const message = (err as Error).message || String(err);
  if (message !== serverError) {
    serverError = message;
    batch(() => {
      error.value = message;
      loaded.value = true;
    });
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
      let wait = document.visibilityState === 'visible' ? POLL_VISIBLE : POLL_HIDDEN;
      if (progress.peek()) {
        wait = POLL_PULLING;
      }
      pollTimer = window.setTimeout(() => void poll(), wait);
    }
  })());
}

/** The Refresh button: ask the server to pull now; it refuses if the interval hasn't passed. */
export async function pullCatalog() {
  try {
    applyStatus(await call<Status>('POST', '/api/pull'));
    // Poll soon so the progress bar shows up.
    window.setTimeout(() => void poll(), 500);
  } catch (err) {
    setServerError(err);
  }
}

/** When the next full pull is allowed. */
export const nextPullAt = () => nextAt ?? Temporal.Instant.from('1970-01-01T00:00:00Z');

/** Every closed lot whose name matches this open lot's, most recent first. */
export const fetchPastCloses = (id: number) =>
  call<{ closes: ServerPastCloseDetail[] }>('GET', `/api/history?id=${id}`).then((r) => r.closes.map(normalizePastClose));

/** Persist a title-based correction and update cards, sorting and category matching immediately. */
export async function setItemType(lotId: number, itemType: string): Promise<string> {
  const reply = await call<{ title: string; itemType: string; seq: number }>('PUT', '/api/item-type', { lotId, itemType });
  typeEdits.set(reply.title, { itemType: reply.itemType, seq: reply.seq });
  updateTitleItemType(reply.title, reply.itemType);
  return reply.itemType;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const synced = new Set<Key>(SYNCED_KEYS);
/** Whether the server's settings have been loaded into this tab. */
let settingsLoaded = false;
let markSynced: () => void;
/** Resolves once the first settings sync has finished (the catalog has loaded by then too). */
export const settingsSynced = new Promise<void>((resolve) => (markSynced = resolve));
/** Synced settings saved here that the server hasn't confirmed yet. */
const unsent = new Map<Key, unknown>();

function serverSettingToLocal(key: Key, value: unknown): unknown {
  if (key === KEYS.lastVisit) {
    if (value == null) return null;
    if (typeof value !== 'number') throw new TypeError('Invalid last visit from the tlx server');
    return instantFromEpochMilliseconds(value);
  }
  if (key === KEYS.savedSearches) {
    if (!Array.isArray(value)) throw new TypeError('Invalid saved searches from the tlx server');
    return value.map((search: unknown) => {
      if (!search || typeof search !== 'object' || !('lastViewedAt' in search) || typeof search.lastViewedAt !== 'number') {
        throw new TypeError('Invalid saved search timestamp from the tlx server');
      }
      return { ...search, lastViewedAt: instantFromEpochMilliseconds(search.lastViewedAt) };
    });
  }
  return value;
}

function localSettingToServer(key: Key, value: unknown): unknown {
  if (key === KEYS.lastVisit) {
    if (value == null) return null;
    if (!(value instanceof Temporal.Instant)) throw new TypeError('Invalid last visit for the tlx server');
    return value.epochMilliseconds;
  }
  if (key === KEYS.savedSearches) {
    if (!Array.isArray(value)) throw new TypeError('Invalid saved searches for the tlx server');
    return value.map((search: unknown) => {
      if (!search || typeof search !== 'object' || !('lastViewedAt' in search) || !(search.lastViewedAt instanceof Temporal.Instant)) {
        throw new TypeError('Invalid saved search timestamp for the tlx server');
      }
      return { ...search, lastViewedAt: search.lastViewedAt.epochMilliseconds };
    });
  }
  return value;
}

/** Send a synced setting to the server; if that fails, it's retried on the next poll. */
async function sendSetting(key: Key, value: unknown) {
  unsent.set(key, value);
  const serverValue = localSettingToServer(key, value);
  try {
    await call('PUT', `/api/settings/${encodeURIComponent(key)}`, { value: serverValue });
    if (unsent.get(key) === value) {
      unsent.delete(key);
    }
  } catch {
    // stays in `unsent`
  }
}

/**
 * Retry unsent settings, and on the first sync take the server's values and
 * send up any setting it doesn't have yet but this browser does. Later polls
 * don't pull, so changes from other tabs and devices wait for a refresh.
 */
async function syncSettings() {
  await Promise.all([...unsent].map(([k, v]) => sendSetting(k, v)));
  if (settingsLoaded) {
    return;
  }
  const r = await call<{ rev: number; values: Record<string, unknown> }>('GET', '/api/settings?since=0');
  for (const [key, value] of Object.entries(r.values)) {
    if (synced.has(key as Key) && !unsent.has(key as Key)) {
      const localValue = serverSettingToLocal(key as Key, value);
      if (JSON.stringify(localValue) !== JSON.stringify(getSetting(key as Key))) {
        applySetting(key as Key, localValue as never);
      }
    }
  }
  for (const key of synced) {
    const mine = getSetting(key);
    if (!(key in r.values) && JSON.stringify(mine) !== JSON.stringify(DEFAULTS[key])) {
      void sendSetting(key, mine);
    }
  }
  settingsLoaded = true;
  markSynced();
}

/** Load what the server has and keep it fresh. */
export function startCatalog() {
  setSaveHook((key, value) => synced.has(key) && void sendSetting(key, value));
  trackActivity(() => void poll());
  // A new login (or logout) changes what the server's pulls will see; check in now.
  onAuthChange(() => void poll());
  void poll();
}
