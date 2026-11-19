// Past closing prices: what earlier matching items closed at (a port of the
// Python server's history.py; the matching itself is src/shared/identity.ts).
//
// When a lot leaves the catalog, the store keeps a slim row of it in
// `closed_lots` with the last price a pull saw. Lots get most of their bids in
// the last minutes, so after each pull the closer loop asks the site for each
// newly closed lot once (one request at a time, a short pause between), and
// records its final price and whether it sold. Closed lots are kept for good;
// at about 200 bytes each that's well under 100 MB a year.
//
// Each open lot gets `pastCloses`: how many closed lots match it and the most
// recent few of them, so a card can show what the item usually goes for.
// GET /api/history?id=N lists every match for the lot popup. Open lots listing
// the same item get a shared `groupId`, which the app folds into one card, and
// the site's Won/Lost pages get `relisted`: open lots matching each closed one.
import { DEFAULT_NAME_MATCH, ItemIndex, setGroups } from '../shared/identity';
import { endsAtMs, type RawLotDetail } from '../shared/lot';
import { isRecord } from './json';
import { log, Waker } from './log';
import { ApiError, type SiteApi } from './site';
import type { ClosedLot, Lot, PastClose, Store } from './store';

const RECENT = 8; // closes attached to each lot
export const HISTORY_LIMIT = 200; // closes listed in the lot popup
const DETAIL_PAUSE_MS = 500; // between final-price requests

/** A closed lot as attached to an open lot's `pastCloses`. */
const close = (row: ClosedLot): PastClose => ({
  id: row.id,
  price: row.price,
  endsAt: row.endsAt,
  condition: row.condition,
  sold: row.sold,
  final: row.final,
});

export class History {
  private readonly store: Store;
  private readonly site: SiteApi;
  private readonly sleep: (ms: number) => Promise<unknown>;
  private readonly waker = new Waker();
  private cache: { version: number; index: ItemIndex<ClosedLot> } | null = null;
  private open: { seq: number; index: ItemIndex<Lot & { endsAt: number }> } | null = null;

  constructor(store: Store, site: SiteApi, sleep: (ms: number) => Promise<unknown> = Bun.sleep) {
    this.store = store;
    this.site = site;
    this.sleep = sleep;
  }

  // -- matching ---------------------------------------------------------------
  /** Rebuilt when closed lots or their saved identities change. */
  private index(): ItemIndex<ClosedLot> {
    const version = this.store.closedRev();
    if (this.cache?.version !== version) {
      this.cache = { version, index: new ItemIndex(this.store.closedLots(), DEFAULT_NAME_MATCH) };
    }
    return this.cache.index;
  }

  /** Closed lots matching this lot, most recent first. */
  closesFor(lot: Lot): ClosedLot[] {
    return this.index().matches(lot);
  }

  private annotateOne(lot: Lot, index: ItemIndex<ClosedLot>) {
    const rows = index.matches(lot);
    if (rows.length) {
      lot.pastCloses = { n: rows.length, recent: rows.slice(0, RECENT).map(close) };
    } else {
      delete lot.pastCloses;
    }
  }

  /** Set (or drop) `pastCloses` on each lot, and `groupId` across them (pass the whole catalog). */
  annotate(lots: Iterable<Lot>): void {
    const list = [...lots];
    const index = this.index();
    for (const lot of list) {
      this.annotateOne(lot, index);
    }
    setGroups(list);
  }

  /**
   * Set `relisted` on each closed lot (as the site's Won/Lost pages list them): the open lots
   * matching it.
   */
  relisted(closed: Record<string, unknown>[], idField = 'lot_id'): void {
    const seq = this.store.seq();
    if (this.open?.seq !== seq) {
      this.open = {
        seq,
        index: new ItemIndex(
          this.store.allLots().values().map((lot) => ({ ...lot, endsAt: endsAtMs(lot) })),
          DEFAULT_NAME_MATCH,
        ),
      };
    }
    const { index } = this.open;
    const now = Date.now();
    for (const c of closed) {
      const id = c[idField];
      const text = (key: string) => (typeof c[key] === 'string' ? c[key] : null);
      const item = {
        id: typeof id === 'number' ? id : -1,
        title: text('title') ?? '',
        brand: text('brand'),
        model: text('model'),
      };
      c['relisted'] = index
        .matches(item)
        .filter((lot) => lot.endsAt > now)
        .map((lot) => lot.id);
    }
  }

  /** Re-annotate the stored lots after closes or identities change. */
  refresh(): void {
    const index = this.index();
    const n = this.store.updateLots((lots) => {
      for (const lot of lots) {
        this.annotateOne(lot, index);
      }
      setGroups(lots);
    });
    if (n) {
      log.info(`past closes changed on ${n} lots`);
    }
  }

  // -- final prices -------------------------------------------------------------
  wake(): void {
    this.waker.wake();
  }

  async runForever(): Promise<never> {
    for (;;) {
      await this.waker.wait();
      try {
        await this.finalize();
        this.refresh();
      } catch (e) {
        log.error('recording closed lots crashed', e); // keep the loop alive no matter what
      }
    }
  }

  /** Ask the site for the final price of every closed lot that doesn't have one yet. */
  async finalize(): Promise<void> {
    const pending = this.store.pendingCloses(Date.now());
    if (!pending.length) {
      return;
    }
    log.info(`fetching final prices of ${pending.length} closed lots`);
    let done = 0;
    for (const row of pending) {
      let raw: Record<string, unknown>;
      try {
        raw = await this.site.get(`/v1/auctions/lots/${row.auctionPeriod}/${row.id}/`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          this.store.finishClose(row.id, null); // gone from the site: keep the last price seen
          await this.sleep(DETAIL_PAUSE_MS);
          continue;
        }
        log.warn(`final prices stopped after ${done} of ${pending.length}: ${String(e)}`);
        return;
      }
      if (!isRecord(raw) || typeof raw['id'] !== 'number') {
        continue;
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the site's lot detail (see tests/fixtures/site)
      const detail = raw as unknown as RawLotDetail;
      this.store.saveLotDetail(detail);
      if (detail.status === 'live' && endsAtMs(detail) > Date.now()) {
        this.store.dropClose(row.id); // back in the catalog: the next pull has it
      } else if (detail.status === 'sold' || detail.status === 'unsold') {
        this.store.finishClose(row.id, detail);
        done += 1;
      }
      await this.sleep(DETAIL_PAUSE_MS);
    }
    log.info(`recorded ${done} final prices`);
  }
}
