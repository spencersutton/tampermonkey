import { describe, expect, test } from 'bun:test';

import { DETAIL_PAUSE, Details } from '../../src/server/details';
import { SiteApi } from '../../src/server/site';
// Background fetching of open lot details (src/server/details.ts).
import { rawLot } from '../raw-lot.mjs';
import { fixture } from './harness';
import { testDb } from './pg';

const db = testDb();
const detailWithBrand = fixture('lot-detail-with-brand-model.json').body as Record<string, unknown>;
const detailWithoutBrand = fixture('lot-detail-without-brand-model.json').body as Record<
  string,
  unknown
>;

const lot = (id: number, fields: Partial<Lot> = {}): Lot => ({
  ...rawLot({
    id,
    title: `Item ${id}`,
    auction_period: 'p1',
    ends_at: `2030-01-0${id}T00:00:00Z`,
  }),
  ...fields,
});

describe('Details', () => {
  test('fetches missing open lot details ending soonest first, saves them, and fires afterFetch', async () => {
    const store = await db.openStore();
    await store.replaceAll([
      lot(3, { ends_at: '2030-01-03T00:00:00Z' }),
      lot(1, { ends_at: '2030-01-01T00:00:00Z' }),
      lot(2, { ends_at: '2030-01-02T00:00:00Z' }),
      lot(4, { auction_period: '' }),
    ]);
    // Lot 2 already has a saved detail; it should not be requested.
    await store.saveLotDetail({ id: 2, auction_period: 'p1', title: 'Item 2', brand: 'Saved' });
    const beforeSeq = await store.seq();

    const paths: string[] = [];
    const pauses: Duration[] = [];
    const site = new SiteApi((async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      const id = Number(path.split('/').at(-2));
      const base = id === 1 ? detailWithBrand : { ...detailWithoutBrand, brand: '', model: null };
      return Response.json({ ...base, id, auction_period: 'p1' });
    }) as typeof fetch);

    const details = new Details(store, site, d => {
      pauses.push(d);
      return Promise.resolve();
    });
    let afterCalls = 0;
    details.afterFetch = () => void afterCalls++;

    expect(await details.fetchMissing()).toBe(2);
    expect(paths).toEqual(['/backend/v1/auctions/lots/p1/1/', '/backend/v1/auctions/lots/p1/3/']);
    expect(pauses).toEqual([DETAIL_PAUSE, DETAIL_PAUSE]);
    expect(afterCalls).toBe(1);

    // Saved details bump seq so clients pick up brand/model on the next catalog poll.
    const changedIds = (await store.changes(beforeSeq)).lots.map(l => l.id).toSorted();
    expect(changedIds).toEqual([1, 3]);
    expect((await store.lot(1))?.brand).toBe((detailWithBrand['brand'] as string).trim());
    expect((await store.lot(3))?.brand).toBeNull();
    expect(await store.pendingDetails()).toEqual([]);

    // A second pass is a no-op and does not fire afterFetch.
    expect(await details.fetchMissing()).toBe(0);
    expect(afterCalls).toBe(1);
  });

  test('skips lots whose detail is saved by a client while the background pass is running', async () => {
    const store = await db.openStore();
    await store.replaceAll([lot(1), lot(2)]);

    const requested: number[] = [];
    const site = new SiteApi((async (input: string | URL | Request) => {
      const id = Number(new URL(String(input)).pathname.split('/').at(-2));
      requested.push(id);
      if (id === 1) {
        // Simulate the browser fetching visible lot 2 while lot 1 is in flight.
        await store.saveLotDetail({
          id: 2,
          auction_period: 'p1',
          title: 'Item 2',
          brand: 'FromTab',
        });
      }
      return Response.json({ ...detailWithBrand, id, auction_period: 'p1' });
    }) as typeof fetch);

    const details = new Details(store, site, () => Promise.resolve());
    expect(await details.fetchMissing()).toBe(1);
    expect(requested).toEqual([1]);
    expect((await store.lot(2))?.brand).toBe('FromTab');
  });

  test('remembers 404 lots across passes until removed, and stops early on transient errors', async () => {
    const store = await db.openStore();
    await store.replaceAll([lot(1), lot(2), lot(3), lot(4)]);

    const requested: number[] = [];
    let failLot3 = true;
    const site = new SiteApi((async (input: string | URL | Request) => {
      const id = Number(new URL(String(input)).pathname.split('/').at(-2));
      requested.push(id);
      if (id === 1) {
        return new Response('Not found', { status: 404 });
      }
      if (id === 3 && failLot3) {
        return new Response('Rate limited', { status: 429 });
      }
      return Response.json({ ...detailWithBrand, id, auction_period: 'p1' });
    }) as typeof fetch);

    const details = new Details(store, site, () => Promise.resolve());
    let afterCalls = 0;
    details.afterFetch = () => void afterCalls++;

    // Pass 1: 1 is 404 (skipped), 2 succeeds, 3 is 429 (stops early before 4).
    expect(await details.fetchMissing()).toBe(1);
    expect(requested).toEqual([1, 2, 3]);
    expect(afterCalls).toBe(1); // lot 2 was saved, so afterFetch still runs

    // Pass 2: 1 is remembered as 404 (not requested again), 2 is saved, 3 and 4 succeed.
    failLot3 = false;
    requested.length = 0;
    expect(await details.fetchMissing()).toBe(2);
    expect(requested).toEqual([3, 4]);
    expect(afterCalls).toBe(2);
  });

  test('enqueued new lots are fetched immediately ahead of pending backfill, even before replaceAll', async () => {
    const store = await db.openStore();
    // Lot 1 is already in the catalog without a detail; lot 2 already has a saved detail.
    await store.replaceAll([
      lot(1, { ends_at: '2030-01-01T00:00:00Z' }),
      lot(2, { ends_at: '2030-01-02T00:00:00Z' }),
    ]);
    await store.saveLotDetail({ id: 2, auction_period: 'p1', title: 'Item 2', brand: 'Saved' });

    const requested: number[] = [];
    const site = new SiteApi((async (input: string | URL | Request) => {
      const id = Number(new URL(String(input)).pathname.split('/').at(-2));
      requested.push(id);
      return Response.json({ ...detailWithBrand, id, auction_period: 'p1' });
    }) as typeof fetch);

    const details = new Details(store, site, () => Promise.resolve());
    // Lots 10 and 11 were just seen on a catalog page before replaceAll() has run;
    // lot 2 is already saved, lot 12 has no auction_period, and lot 10 is passed twice.
    await details.enqueue([lot(10), lot(2), lot(11), lot(10), lot(12, { auction_period: '' })]);

    expect(await details.fetchMissing()).toBe(3);
    expect(requested).toEqual([10, 11, 1]);
    expect(await store.hasLotDetail(10)).toBe(true);
    expect(await store.hasLotDetail(11)).toBe(true);
    expect(await store.hasLotDetail(1)).toBe(true);
  });
});
