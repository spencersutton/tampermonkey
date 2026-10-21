// Catalog source for the standalone build: this browser pulls the full
// catalog itself and caches it in IndexedDB.
//
// Load rules (keep this as close to an ordinary visitor as possible):
// - A full pull happens only when the cache is older than the interval
//   (never under MIN_SYNC_MINUTES), only while this tab is visible and has
//   been used recently, and only in one tab at a time. The interval is
//   measured from the start of the last pull, successful or not, so errors
//   don't cause retries either.
// - Pages are fetched one at a time.
import { fetchLotPage, isAuthenticated, LIST_PAGE_SIZE } from './api';
import { changed, inUse, keepNewer, setUpdateHook, state, trackActivity, type CatalogSource, type PullResult } from './catalog';
import { putLots, readAll, readMeta, replaceAll, writeMeta } from './db';
import { getSetting, onSetting } from './gm';
import { DEFAULT_SYNC_MINUTES, KEYS, MIN_SYNC_MINUTES } from '../shared/keys';
import type { Lot } from './types';
import { MINUTE } from './util';

/** How often to check whether a full pull is due. */
const CHECK_EVERY = 15_000;

/** Minimum time between full pulls, from settings (never under MIN_SYNC_MINUTES). */
function syncIntervalMs(): number {
  const m = Number(getSetting(KEYS.syncMinutes));
  return Math.max(MIN_SYNC_MINUTES, Number.isFinite(m) ? m : DEFAULT_SYNC_MINUTES) * MINUTE;
}

/** Epoch ms when the next full pull is allowed. */
function nextPullAt(meta = state.meta): number {
  return meta.pullStartedAt == null ? 0 : meta.pullStartedAt + syncIntervalMs();
}

// ---------------------------------------------------------------------------
// Cross-tab coordination
// ---------------------------------------------------------------------------
/** Lets tabs tell each other when a pull starts or finishes. */
const channel = new BroadcastChannel('tlx-catalog');
type Msg = { type: 'synced' } | { type: 'meta' };
const broadcast = (msg: Msg) => channel.postMessage(msg);

channel.addEventListener('message', async (e: MessageEvent<Msg>) => {
  if (e.data?.type === 'synced') {
    await reloadFromDb();
  } else if (e.data?.type === 'meta') {
    state.meta = await readMeta();
    changed();
  }
});

/** Replace the in-memory catalog with the IndexedDB copy (e.g. after another tab pulled). */
async function reloadFromDb() {
  const { lots, meta } = await readAll();
  Object.assign(state, { lots: keepNewer(new Map(lots.map((l) => [l.id, l]))), meta, loaded: true });
  changed();
}

// ---------------------------------------------------------------------------
// Full pull
// ---------------------------------------------------------------------------
/** Whether this tab is currently pulling. */
let pulling = false;

/** Run a full pull if it's due and no other tab is already doing one. */
async function pullCatalog(): Promise<PullResult> {
  if (pulling) {
    return 'busy';
  }
  pulling = true;
  try {
    // One tab at a time; if another tab is pulling, it will broadcast the result.
    return await navigator.locks.request('tlx-catalog-pull', { ifAvailable: true }, (lock) => (lock ? runPull() : 'busy'));
  } finally {
    pulling = false;
  }
}

/** Fetch every catalog page, merge with what we have, and store the result. */
async function runPull(): Promise<PullResult> {
  // Re-check against the shared record: another tab may have just pulled.
  const meta = await readMeta();
  if (Date.now() < nextPullAt(meta)) {
    if (meta.fetchedAt !== state.meta.fetchedAt) {
      await reloadFromDb();
    }
    return 'not-due';
  }
  state.meta = await writeMeta({ pullStartedAt: Date.now() });
  broadcast({ type: 'meta' });

  const firstLoad = state.lots.size === 0;
  const startedAt = Date.now();
  const pulled = new Map<number, Lot>();
  // Lots not in the previous pull are new (saved searches count them); on the
  // very first pull everything is treated as already listed.
  const stamp = (l: Lot): Lot => {
    const prev = state.lots.get(l.id);
    return { ...l, firstSeenAt: prev ? (prev.firstSeenAt ?? 0) : firstLoad ? 0 : startedAt };
  };
  state.error = null;
  state.progress = { done: 0, total: null };
  changed();
  try {
    let pages = 1;
    let count = 0;
    for (let page = 1; page <= pages; page++) {
      const d = await fetchLotPage(page);
      if (page === 1) {
        count = d.count;
        pages = Math.max(1, Math.ceil(d.count / LIST_PAGE_SIZE));
      }
      for (const l of d.results) {
        pulled.set(l.id, stamp(l));
        // With nothing cached yet, show lots as they arrive.
        if (firstLoad) {
          state.lots.set(l.id, pulled.get(l.id)!);
        }
      }
      state.progress = { done: pulled.size, total: count };
      changed();
      if (!d.results.length) {
        break;
      }
    }

    keepNewer(pulled);
    // If lots closed mid-pull, page boundaries shift and a few lots can be
    // skipped; keep still-open ones from the previous pull until next time.
    if (pulled.size < count) {
      const now = Date.now();
      for (const [id, l] of state.lots) {
        if (!pulled.has(id) && l.endsAt > now) {
          pulled.set(id, l);
        }
      }
    }

    await replaceAll([...pulled.values()], { fetchedAt: Date.now(), count, authed: isAuthenticated() });
    state.lots = pulled;
    state.meta = await readMeta();
    broadcast({ type: 'synced' });
    return 'done';
  } catch (err) {
    // On a first load, the partial results stay on screen (not persisted).
    state.error = `Catalog refresh failed: ${(err as Error).message || err}`;
    return 'error';
  } finally {
    state.progress = null;
    changed();
  }
}

// ---------------------------------------------------------------------------
// Saving incremental updates (websocket, lot detail)
// ---------------------------------------------------------------------------
/** Updated lots waiting to be written to IndexedDB. */
const dirty = new Map<number, Lot>();
let flushTimer = 0;

/** Queue a lot to be saved; writes are batched every couple of seconds. */
function persistSoon(lot: Lot) {
  dirty.set(lot.id, lot);
  flushTimer ||= window.setTimeout(() => {
    flushTimer = 0;
    const batch = [...dirty.values()];
    dirty.clear();
    void putLots(batch).catch(() => {});
  }, 2000);
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
/** Start a pull if the cache is stale and the tab is visible and in use. */
function maybeAutoPull() {
  if (state.loaded && !pulling && inUse() && Date.now() >= nextPullAt()) {
    void pullCatalog();
  }
}

export const source: CatalogSource = {
  /** Load the cache, track activity, and start the auto-pull timer. */
  async start() {
    setUpdateHook(persistSoon);
    trackActivity(maybeAutoPull);
    onSetting(KEYS.syncMinutes, changed);
    try {
      await reloadFromDb();
    } catch (err) {
      state.loaded = true;
      state.error = `Couldn’t read the local cache: ${(err as Error).message || err}`;
      changed();
    }
    maybeAutoPull();
    window.setInterval(maybeAutoPull, CHECK_EVERY);
  },
  pullCatalog,
  nextPullAt: () => nextPullAt(),
  Settings: () => null,
};
