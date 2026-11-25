// Full catalog pulls, with load rules that keep requests to the site down (a
// port of the Python server's catalog.py).
//
// - A full pull happens at most once per interval (the synced `tlxSyncMinutes`
//   setting, never under MIN_SYNC_MINUTES), measured from the start of the last
//   pull, successful or not, so errors don't cause retries either.
// - It pulls whenever one is due, whether or not an app tab is open, so saved
//   searches keep counting new lots while the browser is closed.
// - Pages are fetched one at a time, by a single puller loop.
//
// Account fields (your standing, watchlist) come from the server's own site
// login (session.ts). A pull made while logged out keeps the account fields
// from the previous pull rather than wiping them. Each lot keeps the item type
// already known for it (itemtypes.ts labels the rest after the pull) and gets
// the past closes matching it (history.ts, which then asks the site for the
// final prices of the lots that just left the catalog).
import { DEFAULT_SYNC_MINUTES, MIN_SYNC_MINUTES, MINUTE } from '../shared/constants';
import { KEYS } from '../shared/keys';
import { endsAtMs } from '../shared/lot';
import type { History } from './history';
import { log, Waker } from './log';
import type { SiteSession } from './session';
import { ApiError, LIST_PAGE_SIZE, type SiteApi } from './site';
import type { CatalogMeta, Store } from './store';

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
  /** Called as each page of lots is seen (e.g. to fetch details for new lots right away). */
  onLotsSeen: (lots: Lot[]) => void = () => {};
  /** Called after each successful pull (e.g. to label the new titles). */
  afterPull: () => void = () => {};
  private readonly waker = new Waker();

  constructor(
    private readonly store: CatalogStore,
    private readonly session: Pick<SiteSession, 'token' | 'rejected'>,
    private readonly history: Pick<History, 'annotate' | 'wake'>,
    private readonly site: Pick<SiteApi, 'fetchLotPage'>,
    private readonly now: () => number = Date.now,
  ) {}

  // -- schedule -------------------------------------------------------------------
  /** Minimum time between full pulls, from the synced setting. */
  async intervalMs(): Promise<number> {
    const m = await this.store.setting(KEYS.syncMinutes);
    return Math.max(MIN_SYNC_MINUTES, typeof m === 'number' ? m : DEFAULT_SYNC_MINUTES) * MINUTE;
  }

  /** Epoch ms when the next full pull is allowed. */
  async nextPullAt(meta?: CatalogMeta): Promise<number> {
    const m = meta ?? (await this.store.meta());
    return m.pullStartedAt === null ? 0 : m.pullStartedAt + (await this.intervalMs());
  }

  async due(): Promise<boolean> {
    return this.now() >= (await this.nextPullAt());
  }

  /** The Refresh button: start a pull now if one is allowed. */
  async requestPull(): Promise<PullRequest> {
    if (this.progress) {
      return 'busy';
    }
    if (!(await this.due())) {
      return 'not-due';
    }
    this.waker.wake();
    return 'started';
  }

  async runForever(): Promise<never> {
    for (;;) {
      await this.waker.wait(CHECK_EVERY_MS);
      if (await this.due()) {
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
    await this.store.writeMeta({ pullStartedAt: started });
    const prev = await this.store.allLots();
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
          Object.assign(lot, { [key]: old[key] });
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
        if (d.results.length) {
          this.onLotsSeen(d.results);
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

      await this.store.annotateItems(pulled.values());
      await this.history.annotate(pulled.values());
      const seq = await this.store.replaceAll(pulled.values(), {
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
