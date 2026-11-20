// Background lot detail fetcher: pulls the detail page for every open lot that
// doesn't have one saved yet (one request at a time, with a short pause
// between), so brands, models, descriptions and images fill in for the whole
// catalog even when no tab is open. Visible cards in the browser still fetch
// immediately through /backend, and anything saved there is skipped here.
import { MINUTE } from '../shared/constants';
import type { RawLotDetail } from '../shared/lot';
import { isRecord } from './json';
import { log, Waker } from './log';
import { ApiError, type SiteApi } from './site';
import type { Store } from './store';

export const DETAIL_PAUSE_MS = 500; // between detail requests
export const RETRY_MS = 15 * MINUTE; // retry after a failure, with no pull to wake it

export type DetailsStore = Pick<Store, 'pendingDetails' | 'hasLotDetail' | 'saveLotDetail'>;

export class Details {
  /** Called after a pass saves one or more details (e.g. to refresh groups/history and item types). */
  afterFetch: () => void = () => {};
  private readonly waker = new Waker();
  private readonly missing = new Set<number>(); // 404s seen in this process

  constructor(
    private readonly store: DetailsStore,
    private readonly site: Pick<SiteApi, 'get'>,
    private readonly sleep: (ms: number) => Promise<unknown> = Bun.sleep,
  ) {}

  wake(): void {
    this.waker.wake();
  }

  async runForever(): Promise<never> {
    for (;;) {
      await this.waker.wait(RETRY_MS);
      try {
        await this.fetchMissing();
      } catch (e) {
        log.error('fetching lot details crashed', e); // keep the loop alive no matter what
      }
    }
  }

  /** Fetch and save the detail of every open lot that doesn't have one yet. */
  async fetchMissing(): Promise<number> {
    const allPending = this.store.pendingDetails();
    const pendingIds = new Set(allPending.map(row => row.id));
    for (const id of this.missing) {
      if (!pendingIds.has(id)) {
        this.missing.delete(id);
      }
    }
    const pending = allPending.filter(row => !this.missing.has(row.id));
    if (!pending.length) {
      return 0;
    }
    log.info(`fetching details of ${pending.length} lots`);
    let done = 0;
    try {
      for (const row of pending) {
        if (this.store.hasLotDetail(row.id)) {
          continue; // fetched by a client while we were working through the queue
        }
        let raw: Record<string, unknown>;
        try {
          raw = await this.site.get(`/v1/auctions/lots/${row.auctionPeriod}/${row.id}/`);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            this.missing.add(row.id);
            await this.sleep(DETAIL_PAUSE_MS);
            continue;
          }
          log.warn(`lot details stopped after ${done} of ${pending.length}: ${String(e)}`);
          return done;
        }
        if (isRecord(raw) && typeof raw['id'] === 'number') {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the site's lot detail (see tests/fixtures/site)
          this.store.saveLotDetail(raw as unknown as RawLotDetail);
          done += 1;
        }
        await this.sleep(DETAIL_PAUSE_MS);
      }
      log.info(`fetched ${done} lot details`);
      return done;
    } finally {
      if (done > 0) {
        this.afterFetch();
      }
    }
  }
}
