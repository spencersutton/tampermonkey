// Catalog source for the web app, which the tlx server (server/, Python)
// serves: the server pulls the full catalog, stores it, and records when each
// lot was first seen; this page just fetches what changed. The server also
// keeps the SERVER_KEYS settings, so every device using it shares filters,
// hidden lots, custom categories and saved searches.
//
// Each poll tells the server whether this tab is in use (it only pulls while
// some tab is, unless run with --background-minutes). Its pulls use its own
// login to the site, so they include your standing and watchlist.
import { authReady, onAuthChange, refreshSession } from './auth';
import { batch, signal } from '@preact/signals';
import { error, fetchedAt, inUse, loaded, lotBrands, lotModels, lots, progress, trackActivity, updateItemType } from './catalog';
import { itemIdentity, sameItemType, type ItemIdentity } from '../shared/names';
import { applySetting, setSaveHook, type Key } from './settings';
import { DEFAULTS, KEYS, SERVER_KEYS } from '../shared/keys';
import { toast } from './toast';
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
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
  meta: { fetchedAt: number | null };
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
/** Local corrections not yet included in a catalog poll; protect them from an older in-flight reply. */
const typeEdits = new Map<number, { identity: ItemIdentity; itemType: string; seq: number }>();

/** Take the server's pull status. */
function applyStatus(s: Status) {
  const skew = s.now - Date.now(); // server clock minus ours
  const next = instantFromEpochMilliseconds(s.nextPullAt - skew);
  const fetched = s.meta.fetchedAt ? instantFromEpochMilliseconds(s.meta.fetchedAt) : null;
  batch(() => {
    nextAt = next;
    fetchedAt.value = fetched;
    progress.value = s.progress;
    error.value = s.error;
  });
}

/** Merge a catalog reply into memory. */
export function applyCatalog(r: CatalogReply) {
  const pulled = r.lots.map(normalizeCatalogLot);
  batch(() => {
    applyStatus(r);
    const brands = new Map(lotBrands.peek());
    const models = new Map(lotModels.peek());
    for (const lot of pulled) {
      if (lot.brand !== undefined) brands.set(lot.id, lot.brand?.trim() || null);
      if (lot.model !== undefined) models.set(lot.id, lot.model?.trim() || null);
    }
    lotBrands.value = brands;
    lotModels.value = models;
    for (const [id, edit] of typeEdits) {
      if (r.seq >= edit.seq) typeEdits.delete(id);
    }
    const cur = lots.peek();
    if (r.full || r.lots.length || (r.ids && r.ids.length !== cur.size)) {
      const next = new Map(r.full ? [] : cur);
      if (r.ids) {
        const keep = new Set(r.ids);
        next.forEach((_, id) => keep.has(id) || next.delete(id));
      }
      for (const fresh of pulled) {
        const mine = cur.get(fresh.id);
        // Keep newer live prices, but take server-owned metadata from the poll.
        next.set(fresh.id, mine && mine.version > fresh.version
          ? { ...mine, firstSeenAt: fresh.firstSeenAt, itemType: fresh.itemType, pastCloses: fresh.pastCloses }
          : fresh);
      }
      for (const [id, lot] of next) {
        for (const edit of typeEdits.values()) {
          if (sameItemType(itemIdentity(lot, { brands, models }), edit.identity)) {
            next.set(id, { ...lot, itemType: edit.itemType });
          }
        }
      }
      lots.value = next;
    }
    seq = r.seq;
    loaded.value = true;
  });
}

/** Report a failed request in the status bar. Signals ignore unchanged values. */
function setServerError(err: unknown) {
  batch(() => {
    error.value = err instanceof Error ? err.message : String(err);
    loaded.value = true;
  });
}

let pollTimer = 0;
let polling: Promise<void> | null = null;

/** Fetch catalog changes, load settings at startup, then schedule the next poll. */
function poll(): Promise<void> {
  return (polling ??= (async () => {
    clearTimeout(pollTimer);
    try {
      await authReady();
      const r = await call<CatalogReply>('GET', `/api/catalog?since=${seq}`, undefined, { 'X-TLX-Active': inUse() ? '1' : '0' });
      applyCatalog(r);
      await loadSettings();
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

/** Every closed lot matching this item's identity or title fallback, most recent first. */
export const fetchPastCloses = (id: number) =>
  call<{ closes: ServerPastCloseDetail[] }>('GET', `/api/history?id=${id}`).then((r) => r.closes.map(normalizePastClose));

/** Persist an item correction and update cards, sorting and category matching immediately. */
export async function setItemType(lotId: number, itemType: string): Promise<string> {
  const reply = await call<ItemIdentity & { itemType: string; seq: number }>('PUT', '/api/item-type', { lotId, itemType });
  const identity = { title: reply.title, brand: reply.brand, model: reply.model };
  typeEdits.delete(lotId);
  typeEdits.set(lotId, { identity, itemType: reply.itemType, seq: reply.seq });
  updateItemType(identity, reply.itemType);
  return reply.itemType;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const serverKeys = new Set<Key>(SERVER_KEYS);
/** Whether the server's settings have been loaded into this tab. */
export const settingsLoaded = signal(false);
let markSettingsReady: () => void;
/** Resolves once settings and the initial catalog have loaded. */
export const settingsReady = new Promise<void>((resolve) => (markSettingsReady = resolve));

function decodeSetting(key: Key, value: unknown): unknown {
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

function encodeSetting(key: Key, value: unknown): unknown {
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

/** Persist a shared setting without keeping a browser copy or retry queue. */
async function sendSetting(key: Key, value: unknown) {
  try {
    const serverValue = encodeSetting(key, value);
    await call('PUT', `/api/settings/${encodeURIComponent(key)}`, { value: serverValue });
  } catch (err) {
    toast('bad', `Couldn’t save ${key}: ${err instanceof Error ? err.message : String(err)}. This change has not been saved.`);
  }
}

/** Read shared settings from the server; absent values use defaults, never localStorage. */
async function loadSettings() {
  if (settingsLoaded.peek()) {
    return;
  }
  const r = await call<{ values: Record<string, unknown> }>('GET', '/api/settings');
  const values = SERVER_KEYS.map((key) => [key, decodeSetting(key, Object.hasOwn(r.values, key) ? r.values[key] : DEFAULTS[key])] as const);
  batch(() => {
    for (const [key, value] of values) {
      applySetting(key, value as never);
    }
    settingsLoaded.value = true;
  });
  markSettingsReady();
}

/** Start catalog polling and server-backed setting saves. */
export function startCatalog() {
  setSaveHook((key, value) => serverKeys.has(key) && void sendSetting(key, value));
  trackActivity(() => void poll());
  // A new login (or logout) changes what the server's pulls will see; check in now.
  onAuthChange(() => void poll());
  void poll();
}
