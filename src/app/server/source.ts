// Catalog source for the web app, which the tlx server (src/server/) serves:
// the server pulls the full catalog, stores it, and records when each lot was
// first seen; this module fetches what changed and syncs shared SERVER_KEYS settings.
import { batch, signal } from '@preact/signals';

import { DEFAULTS, SERVER_KEYS } from '../../shared/keys';
import { ms } from '../../shared/time';
import { mergeCatalogLots, mergeLotDetails, type PendingTypeEdit } from '../logic/catalog';
import { errorMessage } from '../logic/util';
import {
  fetchCatalog,
  fetchPastCloses,
  fetchServerSettings,
  requestPull,
  saveItemType,
  saveServerSetting,
  type CatalogReply,
  type PullStatus,
} from './api';
import { authReady, onAuthChange } from './auth';
import {
  error,
  fetchedAt,
  loaded,
  lotBrands,
  lotDescriptions,
  lotModels,
  lotQuantities,
  lots,
  progress,
  updateItemType,
} from './catalog';
import { applySetting, setSaveHook, type Key } from './settings';
import { toast } from './toast';

export { fetchPastCloses };

/** Poll interval while a pull is running (for the progress bar), while visible, and while hidden. */
const POLL_PULLING = Duration.from({ seconds: 2 });
const POLL_VISIBLE = Duration.from({ seconds: 15 });
const POLL_HIDDEN = Duration.from({ minutes: 1 });
/** How soon to poll after asking for a pull, so the progress bar shows up. */
const POLL_AFTER_REQUEST = Duration.from({ milliseconds: 500 });

/** Last catalog sequence applied here (0 = have nothing). */
let seq = 0;
/** When the server allows the next pull, in our clock. */
let nextAt = 0;
/** Local corrections not yet included in a catalog poll; protect them from an older in-flight reply. */
const typeEdits = new Map<number, PendingTypeEdit>();

/** Take the server's pull status. */
function applyStatus(s: PullStatus) {
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
    const { brands, models, descriptions, quantities } = mergeLotDetails(
      lotBrands.peek(),
      lotModels.peek(),
      lotDescriptions.peek(),
      lotQuantities.peek(),
      r.lots,
    );
    lotBrands.value = brands;
    lotModels.value = models;
    lotDescriptions.value = descriptions;
    lotQuantities.value = quantities;
    for (const [id, edit] of typeEdits) {
      if (r.seq >= edit.seq) {
        typeEdits.delete(id);
      }
    }
    const next = mergeCatalogLots(lots.peek(), r, typeEdits.values());
    if (next) {
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

let pollTimer: ReturnType<typeof setTimeout> | number | undefined;
let polling: Promise<void> | null = null;

const schedule = (fn: () => void, wait: Duration) =>
  typeof window === 'undefined' ? setTimeout(fn, ms(wait)) : window.setTimeout(fn, ms(wait));

/** Fetch catalog changes, load settings at startup, then schedule the next poll. */
function poll(): Promise<void> {
  return (polling ??= (async () => {
    clearTimeout(pollTimer);
    try {
      await authReady();
      const r = await fetchCatalog(seq);
      applyCatalog(r);
      await loadSettings();
    } catch (err) {
      setServerError(err);
    } finally {
      polling = null;
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      let wait = visible ? POLL_VISIBLE : POLL_HIDDEN;
      if (progress.peek()) {
        wait = POLL_PULLING;
      }
      pollTimer = schedule(() => void poll(), wait);
    }
  })());
}

/** The Refresh button: ask the server to pull now; it refuses if the interval hasn't passed. */
export async function pullCatalog() {
  try {
    applyStatus(await requestPull());
    schedule(() => void poll(), POLL_AFTER_REQUEST);
  } catch (err) {
    setServerError(err);
  }
}

/** When the next full pull is allowed. */
export const nextPullAt = () => nextAt;

/** Persist an item correction and update cards, sorting and category matching immediately. */
export async function setItemType(lotId: number, itemType: string): Promise<string> {
  const reply = await saveItemType(lotId, itemType);
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
    await saveServerSetting(key, value);
  } catch (err) {
    toast('bad', `Couldn’t save ${key}: ${errorMessage(err)}. This change has not been saved.`);
  }
}

/** Read shared settings from the server; absent values use defaults, never localStorage. */
async function loadSettings() {
  if (settingsLoaded.peek()) {
    return;
  }
  const r = await fetchServerSettings();
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
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void poll();
      }
    });
  }
  // A new login (or logout) changes what the server's pulls will see; check in now.
  onAuthChange(() => void poll());
  void poll();
}
