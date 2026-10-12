// The catalog: every live lot, cached in IndexedDB and refreshed by a full
// pull no more often than the configured interval.
//
// Load rules (keep this as close to an ordinary visitor as possible):
// - A full pull happens only when the cache is older than the interval
//   (never under MIN_SYNC_MINUTES), only while this tab is visible and has
//   been used recently, and only in one tab at a time. The interval is
//   measured from the start of the last pull, successful or not, so errors
//   don't cause retries either.
// - Pages are fetched one at a time.
// - Between pulls, prices for lots on screen stay current over the site's
//   websocket (see live.ts), and opening a lot fetches just that lot
//   (cached for DETAIL_TTL).
import { useEffect, useState } from 'preact/hooks';
import { fetchLotDetail, fetchLotPage, isAuthenticated, LIST_PAGE_SIZE } from './api';
import { putLots, readAll, readMeta, replaceAll, writeMeta, EMPTY_META, type CatalogMeta } from './db';
import { getSetting, onSetting } from './gm';
import { DEFAULT_SYNC_MINUTES, KEYS, MIN_SYNC_MINUTES } from '../shared/keys';
import type { Lot, LotDetail } from './types';

const DETAIL_TTL = 2 * 60_000;
const ACTIVE_WINDOW = 10 * 60_000; // auto-refresh only if the page was used this recently
const CHECK_EVERY = 15_000;

export interface SyncProgress {
  done: number;
  total: number | null;
}

interface CatalogState {
  loaded: boolean; // IndexedDB read finished
  lots: Map<number, Lot>;
  meta: CatalogMeta;
  progress: SyncProgress | null; // a pull running in this tab
  error: string | null;
  rev: number; // bumps on every change
}

const state: CatalogState = {
  loaded: false,
  lots: new Map(),
  meta: EMPTY_META,
  progress: null,
  error: null,
  rev: 0,
};

const subs = new Set<() => void>();
function changed() {
  state.rev++;
  subs.forEach((f) => f());
}

export function useCatalog(): CatalogState {
  const [, force] = useState(0);
  const renderedRev = state.rev;
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    // Effects can run well after render (e.g. in a background tab); catch up on missed changes.
    if (state.rev !== renderedRev) f();
    return () => void subs.delete(f);
  }, []);
  return state;
}

export const getLot = (id: number) => state.lots.get(id);

export function syncIntervalMs(): number {
  const m = Number(getSetting(KEYS.syncMinutes));
  return Math.max(MIN_SYNC_MINUTES, Number.isFinite(m) ? m : DEFAULT_SYNC_MINUTES) * 60_000;
}

/** Epoch ms when the next full pull is allowed. */
export function nextPullAt(meta = state.meta): number {
  return meta.pullStartedAt == null ? 0 : meta.pullStartedAt + syncIntervalMs();
}

// ---------------------------------------------------------------------------
// Cross-tab coordination
// ---------------------------------------------------------------------------
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('tlx-catalog') : null;
type Msg = { type: 'synced' } | { type: 'meta' };
channel?.addEventListener('message', (e: MessageEvent<Msg>) => {
  if (e.data?.type === 'synced') void reloadFromDb();
  else if (e.data?.type === 'meta') void readMeta().then((m) => ((state.meta = m), changed()));
});

async function reloadFromDb() {
  const { lots, meta } = await readAll();
  // Keep anything this tab saw over the websocket that is newer than the pull.
  const map = new Map(lots.map((l) => [l.id, l]));
  for (const [id, mine] of state.lots) {
    const theirs = map.get(id);
    if (theirs && mine.version > theirs.version) map.set(id, mine);
  }
  state.lots = map;
  state.meta = meta;
  state.loaded = true;
  changed();
}

// ---------------------------------------------------------------------------
// Full pull
// ---------------------------------------------------------------------------
let pulling = false;

export type PullResult = 'done' | 'not-due' | 'busy' | 'error';

export async function pullCatalog(): Promise<PullResult> {
  if (pulling) return 'busy';
  pulling = true;
  try {
    const run = () => runPull();
    // One tab at a time; if another tab is pulling, it will broadcast the result.
    if (navigator.locks) {
      const r = await navigator.locks.request('tlx-catalog-pull', { ifAvailable: true }, (lock) =>
        lock ? run() : ('busy' as const),
      );
      return r;
    }
    return await run();
  } finally {
    pulling = false;
  }
}

async function runPull(): Promise<PullResult> {
  // Re-check against the shared record: another tab may have just pulled.
  const meta = await readMeta();
  if (Date.now() < nextPullAt(meta)) {
    if (meta.fetchedAt !== state.meta.fetchedAt) await reloadFromDb();
    return 'not-due';
  }
  state.meta = await writeMeta({ pullStartedAt: Date.now() });
  channel?.postMessage({ type: 'meta' } satisfies Msg);

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
      for (const l of d.results) pulled.set(l.id, stamp(l));
      state.progress = { done: pulled.size, total: count };
      // With nothing cached yet, show lots as they arrive.
      if (firstLoad) for (const l of d.results) state.lots.set(l.id, pulled.get(l.id)!);
      changed();
      if (!d.results.length) break;
    }

    // Websocket updates that arrived during the pull may be newer.
    for (const [id, mine] of state.lots) {
      const fresh = pulled.get(id);
      if (fresh && mine.version > fresh.version) pulled.set(id, { ...mine, firstSeenAt: fresh.firstSeenAt });
    }
    // If lots closed mid-pull, page boundaries shift and a few lots can be
    // skipped; keep still-open ones from the previous pull until next time.
    if (pulled.size < count) {
      const now = Date.now();
      for (const [id, l] of state.lots) if (!pulled.has(id) && l.endsAt > now) pulled.set(id, l);
    }

    const fetchedAt = Date.now();
    await replaceAll([...pulled.values()], { fetchedAt, count, authed: isAuthenticated() });
    state.lots = pulled;
    state.meta = await readMeta();
    channel?.postMessage({ type: 'synced' } satisfies Msg);
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
// Incremental updates (websocket, lot detail)
// ---------------------------------------------------------------------------
const dirty = new Map<number, Lot>();
let flushTimer = 0;
function persistSoon(lot: Lot) {
  dirty.set(lot.id, lot);
  if (!flushTimer) {
    flushTimer = window.setTimeout(() => {
      flushTimer = 0;
      const batch = [...dirty.values()];
      dirty.clear();
      void putLots(batch).catch(() => {});
    }, 2000);
  }
}

/** Apply a partial update if it is newer than what we have (by `version`). */
export function updateLot(id: number, patch: Partial<Lot>, opts: { force?: boolean } = {}) {
  const cur = state.lots.get(id);
  if (!cur) return;
  if (!opts.force && patch.version != null && patch.version <= cur.version) return;
  const next = { ...cur, ...patch };
  state.lots.set(id, next);
  persistSoon(next);
  changed();
}

const details = new Map<number, { at: number; data?: LotDetail; promise?: Promise<LotDetail> }>();

/** Fetch one lot's detail page data, cached for DETAIL_TTL; also refreshes the catalog entry. */
export function loadDetail(lot: Pick<Lot, 'id' | 'auctionPeriod'>, signal?: AbortSignal): Promise<LotDetail> {
  const hit = details.get(lot.id);
  if (hit && Date.now() - hit.at < DETAIL_TTL) {
    if (hit.data) return Promise.resolve(hit.data);
    if (hit.promise) return hit.promise;
  }
  const promise = fetchLotDetail(lot.auctionPeriod, lot.id, signal).then(
    (d) => {
      details.set(lot.id, { at: Date.now(), data: d });
      const { description, brand, model, lotFee, bidHistory, ...base } = d;
      const cur = state.lots.get(lot.id);
      // Detail responses are authoritative for account fields even at equal versions.
      if (cur && base.version >= cur.version) updateLot(lot.id, base, { force: true });
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

export function cachedDetail(id: number): LotDetail | undefined {
  const hit = details.get(id);
  return hit && Date.now() - hit.at < DETAIL_TTL ? hit.data : undefined;
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------
let lastActivity = Date.now();
const markActive = () => (lastActivity = Date.now());

function maybeAutoPull() {
  if (!state.loaded || pulling) return;
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastActivity > ACTIVE_WINDOW) return;
  if (Date.now() < nextPullAt()) return;
  void pullCatalog();
}

export async function startCatalog() {
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const)
    window.addEventListener(ev, markActive, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      markActive();
      maybeAutoPull();
    }
  });
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
}
