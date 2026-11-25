// Background lot detail fetcher: pulls the detail page for every new lot as
// soon as a catalog pull sees it (and backfills any open lots still missing
// one, one request at a time with a short pause between), so brands, models,
// descriptions and images are ready right away even when no tab is open.
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
  private readonly queued = new Map<number, string>(); // newly seen lots waiting for immediate fetch (id -> auctionPeriod)

  constructor(
    private readonly store: DetailsStore,
    private readonly site: Pick<SiteApi, 'get'>,
    private readonly sleep: (ms: number) => Promise<unknown> = Bun.sleep,
  ) {}

  wake(): void {
    this.waker.wake();
  }

  /** Queue newly seen lots that don't have a saved detail yet and wake the fetcher immediately. */
  async enqueue(lots: Iterable<Pick<Lot, 'id' | 'auction_period'>>): Promise<void> {
    let added = false;
    for (const lot of lots) {
      const period = lot.auction_period;
      if (
        !period ||
        this.missing.has(lot.id) ||
        this.queued.has(lot.id) ||
        (await this.store.hasLotDetail(lot.id))
      ) {
        continue;
      }
      this.queued.set(lot.id, period);
      added = true;
    }
    if (added) {
      this.wake();
    }
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

  /**
   * Pull the next lot to fetch: newly enqueued lots first, then remaining open lots ending soonest
   * first.
   */
  private nextFromQueue(): { id: number; auctionPeriod: string } | null {
    const first = this.queued.entries().next();
    if (first.done) {
      return null;
    }
    const [id, auctionPeriod] = first.value;
    this.queued.delete(id);
    return { id, auctionPeriod };
  }

  /** Fetch and save the detail of every newly seen or open lot that doesn't have one yet. */
  async fetchMissing(): Promise<number> {
    const allPending = await this.store.pendingDetails();
    const pendingIds = new Set(allPending.map(row => row.id));
    for (const id of this.missing) {
      if (!pendingIds.has(id) && !this.queued.has(id)) {
        this.missing.delete(id);
      }
    }
    const pending = allPending.filter(row => !this.missing.has(row.id));
    let pendingIdx = 0;
    const total = this.queued.size + pending.filter(row => !this.queued.has(row.id)).length;
    if (!total) {
      return 0;
    }
    log.info(`fetching details of ${total} lots`);
    let done = 0;
    try {
      for (;;) {
        const row = this.nextFromQueue() ?? pending[pendingIdx++] ?? null;
        if (!row) {
          break;
        }
        if (this.missing.has(row.id) || (await this.store.hasLotDetail(row.id))) {
          continue;
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
          log.warn(`lot details stopped after ${done} of ${total}: ${String(e)}`);
          return done;
        }
        if (isRecord(raw) && typeof raw['id'] === 'number') {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the site's lot detail (see tests/fixtures/site)
          await this.store.saveLotDetail(raw as unknown as RawLotDetail);
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
