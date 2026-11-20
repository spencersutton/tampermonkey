import { batch, signal } from '@preact/signals';

import { MINUTE } from '../shared/constants';
import { DEFAULTS, SERVER_KEYS } from '../shared/keys';
// Catalog source for the web app, which the tlx server (src/server/) serves: the server pulls the full catalog, stores it, and records when each
// lot was first seen; this page just fetches what changed. The server also
// keeps the SERVER_KEYS settings, so every device using it shares filters,
// hidden lots, custom categories and saved searches.
//
// The server pulls on its own schedule, whether or not a tab is open. Its pulls use its own
// login to the site, so they include your standing and watchlist.
import { authReady, onAuthChange, refreshSession } from './auth';
import {
  error,
  fetchedAt,
  loaded,
  lotBrands,
  lotModels,
  lots,
  progress,
  updateItemType,
} from './catalog';
import { applySetting, setSaveHook, type Key } from './settings';
import { toast } from './toast';
import type { Lot, PastCloseDetail } from './types';
import { errorMessage } from './util';
import '../shared/arrayToSet';

/** Poll interval while a pull is running (for the progress bar), while visible, and while hidden. */
const POLL_PULLING = 2_000;
const POLL_VISIBLE = 15_000;
const POLL_HIDDEN = MINUTE;
const TIMEOUT = 30_000;

/** Call the tlx server and parse its JSON reply. */
async function call<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
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
/** Local corrections not yet included in a catalog poll; protect them from an older in-flight reply. */
const typeEdits = new Map<number, { lotIds: number[]; itemType: string; seq: number }>();

/** Take the server's pull status. */
function applyStatus(s: Status) {
  const skew = s.now - Date.now(); // server clock minus ours
  const next = s.nextPullAt - skew;
  const fetched = s.meta.fetchedAt || null;
  batch(() => {
    nextAt = next;
    fetchedAt.value = fetched;
    progress.value = s.progress;
    error.value = s.error;
  });
}

/** Merge a catalog reply into memory. */
export function applyCatalog(r: CatalogReply) {
  batch(() => {
    applyStatus(r);
    const brands = new Map(lotBrands.peek());
    const models = new Map(lotModels.peek());
    for (const lot of r.lots) {
      if (lot.brand !== undefined) {
        brands.set(lot.id, lot.brand?.trim() || null);
      }
      if (lot.model !== undefined) {
        models.set(lot.id, lot.model?.trim() || null);
      }
    }
    lotBrands.value = brands;
    lotModels.value = models;
    for (const [id, edit] of typeEdits) {
      if (r.seq >= edit.seq) {
        typeEdits.delete(id);
      }
    }
    const cur = lots.peek();
    if (r.full || r.lots.length || (r.ids && r.ids.length !== cur.size)) {
      const next = new Map(r.full ? [] : cur);
      if (r.ids) {
        const keep = r.ids.toSet();
        next.forEach((_, id) => keep.has(id) || next.delete(id));
      }
      for (const fresh of r.lots) {
        const mine = cur.get(fresh.id);
        // Keep newer live prices, but take server-owned metadata from the poll.
        next.set(
          fresh.id,
          mine && mine.version > fresh.version
            ? {
                ...mine,
                firstSeenAt: fresh.firstSeenAt,
                itemType: fresh.itemType,
                tags: fresh.tags,
                pastCloses: fresh.pastCloses,
                groupId: fresh.groupId,
              }
            : fresh,
        );
      }
      for (const edit of typeEdits.values()) {
        for (const id of edit.lotIds) {
          const lot = next.get(id);
          if (lot) {
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
    error.value = errorMessage(err);
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
      const r = await call<CatalogReply>('GET', `/api/catalog?since=${seq}`);
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
export const nextPullAt = () => nextAt;

/** Every closed lot matching this item's identity or title fallback, most recent first. */
export const fetchPastCloses = (id: number) =>
  call<{ closes: PastCloseDetail[] }>('GET', `/api/history?id=${id}`).then(r => r.closes);

/** Persist an item correction and update cards, sorting and category matching immediately. */
export async function setItemType(lotId: number, itemType: string): Promise<string> {
  const reply = await call<{ lotIds: number[]; itemType: string; seq: number }>(
    'PUT',
    '/api/item-type',
    { lotId, itemType },
  );
  typeEdits.delete(lotId);
  typeEdits.set(lotId, { lotIds: reply.lotIds, itemType: reply.itemType, seq: reply.seq });
  updateItemType(reply.lotIds, reply.itemType);
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
export const settingsReady = new Promise<void>(resolve => (markSettingsReady = resolve));

/** Persist a shared setting without keeping a browser copy or retry queue. */
async function sendSetting(key: Key, value: unknown) {
  try {
    await call('PUT', `/api/settings/${encodeURIComponent(key)}`, { value });
  } catch (err) {
    toast('bad', `Couldn’t save ${key}: ${errorMessage(err)}. This change has not been saved.`);
  }
}

/** Read shared settings from the server; absent values use defaults, never localStorage. */
async function loadSettings() {
  if (settingsLoaded.peek()) {
    return;
  }
  const r = await call<{ values: Record<string, unknown> }>('GET', '/api/settings');
  const values = SERVER_KEYS.map(
    key => [key, Object.hasOwn(r.values, key) ? r.values[key] : DEFAULTS[key]] as const,
  );
  batch(() => {
    for (const [key, value] of values) {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      applySetting(key, value as never);
    }
    settingsLoaded.value = true;
  });
  markSettingsReady();
}

/** Start catalog polling and server-backed setting saves. */
export function startCatalog() {
  setSaveHook((key, value) => serverKeys.has(key) && void sendSetting(key, value));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void poll();
    }
  });
  // A new login (or logout) changes what the server's pulls will see; check in now.
  onAuthChange(() => void poll());
  void poll();
}
