// The catalog: every live lot, held in memory for the view. The tlx server
// (server/) pulls and stores it, and the page fetches what changed (see
// source.ts). Between pulls prices for lots on screen stay current over the
// site's websocket (see live.ts), and opening a lot fetches just that lot
// (cached for DETAIL_TTL).
import { signal } from '@preact/signals';
import { fetchLotDetail } from './api';
import type { Lot, LotDetail } from './types';
import { MINUTE } from './util';

/** How long a fetched lot detail is reused. */
const DETAIL_TTL = 2 * MINUTE;
/** Auto-refresh only if the page was used this recently. */
export const ACTIVE_WINDOW = 10 * MINUTE;

export interface SyncProgress {
  done: number;
  total: number | null;
}

/** First read from the server finished. */
export const loaded = signal(false);
/**
 * Every live lot, by id. A catalog reply that changes any lots replaces the
 * Map; websocket and lot detail updates change it in place and bump `rev`.
 */
export const lots = signal(new Map<number, Lot>());
/** Bumps on every in-place lot update; read it (or getLot) to follow live prices. */
export const rev = signal(0);
/** When the last complete pull finished. */
export const fetchedAt = signal<Temporal.Instant | null>(null);
/** A pull running. */
export const progress = signal<SyncProgress | null>(null);
export const error = signal<string | null>(null);

/** Look up a lot by id, following its live updates. */
export function getLot(id: number): Lot | undefined {
  void rev.value;
  return lots.value.get(id);
}

// ---------------------------------------------------------------------------
// Incremental updates (websocket, lot detail)
// ---------------------------------------------------------------------------
/** Apply a partial update if it is newer than what we have (by `version`). */
export function updateLot(id: number, patch: Partial<Lot>, opts: { force?: boolean } = {}) {
  const cur = lots.peek().get(id);
  if (!cur || (!opts.force && patch.version != null && patch.version <= cur.version)) {
    return;
  }
  lots.peek().set(id, { ...cur, ...patch });
  rev.value = rev.peek() + 1;
}

/** Apply a saved item type to every catalog listing with this exact title. */
export function updateTitleItemType(title: string, itemType: string) {
  const next = new Map(lots.peek());
  for (const [id, lot] of next) {
    if (lot.title === title) {
      next.set(id, { ...lot, itemType });
    }
  }
  lots.value = next;
}

/** Lot detail cache (or the in-flight request), by lot id. */
const details = new Map<number, { at: number; data?: LotDetail; promise?: Promise<LotDetail> }>();

/** Brands from server-cached or newly fetched details; null means the site supplied no brand. */
export const lotBrands = signal(new Map<number, string | null>());

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
      lotBrands.value = new Map(lotBrands.peek()).set(lot.id, d.brand?.trim() || null);
      // oxlint-disable-next-line no-unused-vars
      const { description, brand, model, bidHistory, similar, ...base } = d;
      const cur = lots.peek().get(lot.id);
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
