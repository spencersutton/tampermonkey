// Full catalog pulls, with load rules that keep requests to the site down (a
// port of the Python server's catalog.py).
//
// - A full pull happens at most once per interval (the synced `tlxSyncMinutes`
//   setting, never under MIN_SYNC_MINUTES), measured from the start of the last
//   pull, successful or not, so errors don't cause retries either.
// - By default it only pulls while some app tab is visible and has been used in
//   the last ACTIVE_WINDOW (the app says so on each poll). With
//   `backgroundMinutes` set, it also pulls that often with no one watching, so
//   saved searches keep counting new lots while the browser is closed.
// - Pages are fetched one at a time, by a single puller loop.
//
// Account fields (your standing, watchlist) come from the server's own site
// login (session.ts). A pull made while logged out keeps the account fields
// from the previous pull rather than wiping them. Each lot keeps the item type
// already known for it (itemtypes.ts labels the rest after the pull) and gets
// the past closes matching it (history.ts, which then asks the site for the
// final prices of the lots that just left the catalog).
import { DEFAULT_SYNC_MINUTES, KEYS, MIN_SYNC_MINUTES } from '../shared/keys';
import { endsAtMs } from '../shared/lot';
import type { History } from './history';
import { log, Waker } from './log';
import type { SiteSession } from './session';
import { ApiError, LIST_PAGE_SIZE, type SiteApi } from './site';
import type { CatalogMeta, Lot, Store } from './store';

const MINUTE_MS = 60_000;
const ACTIVE_WINDOW_MS = 10 * MINUTE_MS; // pull only if a tab was in use this recently
const CHECK_EVERY_MS = 15_000; // between checks whether a pull is due
const ACCOUNT_FIELDS = ['your_standing', 'is_watchlisted', 'has_bid'] as const;

export interface Progress {
  done: number;
  total: number | null;
}

export type PullRequest = 'busy' | 'not-due' | 'started';

/** What a pull needs from the store (a narrow type, so tests can stand in for it). */
export type CatalogStore = Pick<
  Store,
  'meta' | 'writeMeta' | 'setting' | 'allLots' | 'annotateItems' | 'replaceAll'
>;

export class Catalog {
  progress: Progress | null = null;
  error: string | null = null;
  /** Called after each successful pull (e.g. to label the new titles). */
  afterPull: () => void = () => {};
  private lastActive = 0; // epoch ms of the last poll from a tab in use
  private requested = false;
  private readonly waker = new Waker();
  private readonly backgroundMs: number;

  constructor(
    private readonly store: CatalogStore,
    private readonly session: Pick<SiteSession, 'token' | 'rejected'>,
    private readonly history: Pick<History, 'annotate' | 'wake'>,
    private readonly site: Pick<SiteApi, 'fetchLotPage'>,
    backgroundMinutes = 0,
    private readonly now: () => number = Date.now,
  ) {
    this.backgroundMs = backgroundMinutes * MINUTE_MS;
  }

  // -- what clients tell us -----------------------------------------------------
  /** Record a poll, and whether the tab that made it is in use. */
  heartbeat(active: boolean): void {
    if (active) {
      this.lastActive = this.now();
      if (this.due()) {
        this.waker.wake();
      }
    }
  }

  // -- schedule -------------------------------------------------------------------
  /** Minimum time between full pulls, from the synced setting. */
  intervalMs(): number {
    const m = this.store.setting(KEYS.syncMinutes);
    return Math.max(MIN_SYNC_MINUTES, typeof m === 'number' ? m : DEFAULT_SYNC_MINUTES) * MINUTE_MS;
  }

  /** Epoch ms when the next full pull is allowed. */
  nextPullAt(meta: CatalogMeta = this.store.meta()): number {
    return meta.pullStartedAt === null ? 0 : meta.pullStartedAt + this.intervalMs();
  }

  due(): boolean {
    return this.now() >= this.nextPullAt();
  }

  private wanted(meta: CatalogMeta): boolean {
    const now = this.now();
    if (this.requested || now - this.lastActive <= ACTIVE_WINDOW_MS) {
      return true;
    }
    if (this.backgroundMs) {
      return now >= (meta.pullStartedAt ?? 0) + Math.max(this.intervalMs(), this.backgroundMs);
    }
    return false;
  }

  /** The Refresh button: start a pull now if one is allowed. */
  requestPull(): PullRequest {
    if (this.progress) {
      return 'busy';
    }
    if (!this.due()) {
      return 'not-due';
    }
    this.requested = true;
    this.waker.wake();
    return 'started';
  }

  async runForever(): Promise<never> {
    for (;;) {
      await this.waker.wait(CHECK_EVERY_MS);
      const meta = this.store.meta();
      if (this.now() >= this.nextPullAt(meta) && this.wanted(meta)) {
        this.requested = false;
        try {
          await this.pull();
        } catch (e) {
          log.error('pull crashed', e); // keep the loop alive no matter what
        }
      }
    }
  }

  // -- the pull ---------------------------------------------------------------------
  /** Fetch every catalog page, merge with what we have, and store the result. */
  async pull(): Promise<void> {
    const started = this.now();
    this.store.writeMeta({ pullStartedAt: started });
    const prev = this.store.allLots();
    const firstLoad = !prev.size;
    let token = await this.session.token();
    this.error = null;
    this.progress = { done: 0, total: null };
    log.info(`pull started (${token ? 'logged in' : 'anonymous'})`);

    const stamp = (lot: Lot, authed: boolean): Lot => {
      // Lots not in the previous pull are new (saved searches count them);
      // on the very first pull everything is treated as already listed.
      const old = prev.get(lot.id);
      if (old) {
        lot.firstSeenAt = old.firstSeenAt || 0;
      } else {
        lot.firstSeenAt = firstLoad ? 0 : started;
      }
      if (!authed && old) {
        for (const key of ACCOUNT_FIELDS) {
          if (old[key] !== undefined) {
            Object.assign(lot, { [key]: old[key] });
          }
        }
      }
      return lot;
    };

    try {
      let pulled = new Map<number, Lot>();
      let pages = 1;
      let count = 0;
      let page = 1;
      while (page <= pages) {
        let d;
        try {
          d = await this.site.fetchLotPage(page, token);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 401 || !token) {
            throw e;
          }
          // The token was rejected: refresh it, or go on without it, and start over so every page agrees.
          token = await this.session.rejected(token);
          log.info(`token rejected; ${token ? 'refreshed' : 'pulling anonymously'}`);
          [pulled, pages, page] = [new Map(), 1, 1];
          continue;
        }
        if (page === 1) {
          count = d.count;
          pages = Math.max(1, Math.ceil(d.count / LIST_PAGE_SIZE));
        }
        for (const lot of d.results) {
          pulled.set(lot.id, stamp(lot, token !== null));
        }
        this.progress = { done: pulled.size, total: count };
        if (!d.results.length) {
          break;
        }
        page += 1;
      }

      // If lots closed mid-pull, page boundaries shift and a few lots can be
      // skipped; keep still-open ones from the previous pull until next time.
      if (pulled.size < count) {
        const now = this.now();
        for (const [id, lot] of prev) {
          if (!pulled.has(id) && endsAtMs(lot) > now) {
            pulled.set(id, lot);
          }
        }
      }

      this.store.annotateItems(pulled.values());
      this.history.annotate(pulled.values());
      const seq = this.store.replaceAll(pulled.values(), {
        fetchedAt: this.now(),
        count,
        authed: token !== null,
      });
      log.info(
        `pull done: ${pulled.size} lots in ${((this.now() - started) / 1000).toFixed(1)}s (seq ${seq})`,
      );
      this.history.wake();
      this.afterPull();
    } catch (e) {
      if (!(e instanceof ApiError)) {
        throw e;
      }
      this.error = `Catalog refresh failed: ${e.message}`;
      log.warn(this.error);
    } finally {
      this.progress = null;
    }
  }
}
