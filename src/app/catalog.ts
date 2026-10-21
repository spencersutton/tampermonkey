// The catalog: every live lot, held in memory for the view. Where full pulls
// come from depends on the build (imported as '@source'):
// - source-local.tsx: this browser pulls the site's API itself and caches the
//   result in IndexedDB.
// - source-server.tsx: the tlx server (server/) pulls and stores it, and the
//   page fetches what changed.
// Either way, between pulls prices for lots on screen stay current over the
// site's websocket (see live.ts), and opening a lot fetches just that lot
// (cached for DETAIL_TTL).
import { useSyncExternalStore } from 'preact/compat';
import type { JSX } from 'preact';
import { fetchLotDetail } from './api';
import { EMPTY_META, type CatalogMeta } from './db';
import type { Lot, LotDetail } from './types';
import { emitter, MINUTE } from './util';

/** How long a fetched lot detail is reused. */
const DETAIL_TTL = 2 * MINUTE;
/** Auto-refresh only if the page was used this recently. */
export const ACTIVE_WINDOW = 10 * MINUTE;

export interface SyncProgress {
  done: number;
  total: number | null;
}

export interface CatalogState {
  loaded: boolean; // first read (IndexedDB or server) finished
  lots: Map<number, Lot>;
  meta: CatalogMeta;
  progress: SyncProgress | null; // a pull running
  error: string | null;
  rev: number; // bumps on every change
}

export type PullResult = 'done' | 'started' | 'not-due' | 'busy' | 'error';

/** Where full pulls come from; '@source' exports one of these as `source`. */
export interface CatalogSource {
  /** Load what's cached and start keeping it fresh. */
  start(): Promise<void>;
  /** The Refresh button: pull now if allowed. */
  pullCatalog(): Promise<PullResult>;
  /** Epoch ms when the next full pull is allowed. */
  nextPullAt(): number;
  /** Extra rows for the Settings panel. */
  Settings(): JSX.Element | null;
}

/** The single shared catalog state; components read it through useCatalog(). */
export const state: CatalogState = {
  loaded: false,
  lots: new Map(),
  meta: EMPTY_META,
  progress: null,
  error: null,
  rev: 0,
};

const { subscribe, emit } = emitter();

/** Bump the revision and re-render subscribers. */
export function changed() {
  state.rev++;
  emit();
}

/** Preact hook: the catalog state, re-rendering on every change. */
export function useCatalog(): CatalogState {
  useSyncExternalStore(subscribe, () => state.rev);
  return state;
}

/** Look up a cached lot by id. */
export const getLot = (id: number) => state.lots.get(id);

/**
 * Merge a fresh pull with what's in memory: websocket updates that arrived
 * since may be newer (by `version`), so those win, keeping the pull's
 * first-seen time.
 */
export function keepNewer(pulled: Map<number, Lot>): Map<number, Lot> {
  for (const [id, mine] of state.lots) {
    const fresh = pulled.get(id);
    if (fresh && mine.version > fresh.version) {
      pulled.set(id, { ...mine, firstSeenAt: fresh.firstSeenAt });
    }
  }
  return pulled;
}

// ---------------------------------------------------------------------------
// Incremental updates (websocket, lot detail)
// ---------------------------------------------------------------------------
/** Called with every lot changed by updateLot (the local source saves it). */
let onUpdate: (lot: Lot) => void = () => {};
export const setUpdateHook = (fn: (lot: Lot) => void) => void (onUpdate = fn);

/** Apply a partial update if it is newer than what we have (by `version`). */
export function updateLot(id: number, patch: Partial<Lot>, opts: { force?: boolean } = {}) {
  const cur = state.lots.get(id);
  if (!cur || (!opts.force && patch.version != null && patch.version <= cur.version)) {
    return;
  }
  const next = { ...cur, ...patch };
  state.lots.set(id, next);
  onUpdate(next);
  changed();
}

/** Lot detail cache (or the in-flight request), by lot id. */
const details = new Map<number, { at: number; data?: LotDetail; promise?: Promise<LotDetail> }>();

/** Fetch one lot's detail page data, cached for DETAIL_TTL; also refreshes the catalog entry. */
export function loadDetail(lot: Pick<Lot, 'id' | 'auctionPeriod'>, signal?: AbortSignal): Promise<LotDetail> {
  const hit = details.get(lot.id);
  if (hit && Date.now() - hit.at < DETAIL_TTL) {
    const cached = hit.data ? Promise.resolve(hit.data) : hit.promise;
    if (cached) {
      return cached;
    }
  }
  const promise = fetchLotDetail(lot.auctionPeriod, lot.id, signal).then(
    (d) => {
      details.set(lot.id, { at: Date.now(), data: d });
      const { description, brand, model, lotFee, bidHistory, ...base } = d;
      const cur = state.lots.get(lot.id);
      // Detail responses are authoritative for account fields even at equal versions.
      if (cur && base.version >= cur.version) {
        updateLot(lot.id, base, { force: true });
      }
      return d;
    },
    (err) => {
      details.delete(lot.id);
      throw err;
    },
  );
  details.set(lot.id, { at: Date.now(), promise });
  return promise;
}

/** Drop a lot's cached detail (e.g. after bidding, so bid history is refetched). */
export const invalidateDetail = (id: number) => void details.delete(id);

/** A lot's cached detail if it's still fresh, without fetching. */
export function cachedDetail(id: number): LotDetail | undefined {
  const hit = details.get(id);
  return hit && Date.now() - hit.at < DETAIL_TTL ? hit.data : undefined;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
/** When the user last interacted with the page. */
let lastActivity = Date.now();

/** Whether the tab is visible and was used within ACTIVE_WINDOW (auto pulls stop when it sits idle). */
export const inUse = () => document.visibilityState === 'visible' && Date.now() - lastActivity <= ACTIVE_WINDOW;

/** Track user activity; `onVisible` runs whenever the tab comes back into view. */
export function trackActivity(onVisible: () => void) {
  const markActive = () => (lastActivity = Date.now());
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const) {
    window.addEventListener(ev, markActive, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      markActive();
      onVisible();
    }
  });
}
