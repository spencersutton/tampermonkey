import { beforeEach, describe, expect, test } from 'bun:test';

import { History } from '../../src/server/history';
import { Labeller } from '../../src/server/itemtypes';
import { ApiError, SiteApi } from '../../src/server/site';
import type { Store } from '../../src/server/store';
// Past closes, duplicate groups and final prices (src/server/history.ts), and
// item identity across the store.
import { rawLot } from '../raw-lot.mjs';
import { fixture } from './harness';
import { testDb } from './pg';

const db = testDb();

const LATER = 4_000_000_000_000; // an endsAt far in the future
const item = (id: number, title = 'Cordless drill', fields: Partial<Lot> = {}): Lot => ({
  ...rawLot({ id, title, ends_at: new Date(LATER).toISOString() }),
  brand: 'Acme',
  model: 'D-100',
  ...fields,
});
// Closed, sold lots.
const sold = (id: number, title = 'Cordless drill', fields: Partial<Lot> = {}): Lot => ({
  ...rawLot({
    id,
    title,
    ends_at: new Date(1000).toISOString(),
    current_price: 20,
    status: 'sold',
    bid_count: 1,
  }),
  brand: 'Acme',
  model: 'D-100',
  ...fields,
});

/** A site API that fails every request: history must not ask the site unless a test says so. */
const noSite = new SiteApi((() =>
  Promise.reject(new Error('no site in this test'))) as unknown as typeof fetch);

async function stores(schema = db.nextSchema()) {
  const store = await db.openStore(schema);
  const history = new History(store, noSite, () => Promise.resolve());
  const addOpen = async (...items: Lot[]) => {
    for (const i of items) {
      await store.saveLotDetail(i);
    }
    await store.replaceAll(items.map(i => structuredClone(i)));
  };
  const addClosed = async (...items: Lot[]) => {
    for (const i of items) {
      await store.saveLotDetail(i);
      await store.finishClose(i.id, i);
    }
  };
  const groupOf = async (id: number) => (await store.lot(id))?.groupId;
  return { schema, store, history, addOpen, addClosed, groupOf };
}

describe('stored matching', () => {
  test('groups are stored, and late details regroup with a catalog delta', async () => {
    const { store, history, addOpen, groupOf } = await stores();
    await addOpen(item(1), item(2, 'Different title'), item(3, 'Saw', { model: 'S-1' }));
    await history.refresh();
    expect(await Promise.all([1, 2, 3].map(groupOf))).toEqual([1, 1, undefined]);
    let before = await store.seq();
    await store.saveLotDetail(item(2, 'Different title', { model: 'D-200' }));
    await history.refresh();
    expect(await Promise.all([1, 2].map(groupOf))).toEqual([undefined, undefined]);
    expect(new Set((await store.changes(before)).lots.map(l => l.id))).toEqual(new Set([1, 2]));
    before = await store.seq();
    await history.refresh();
    expect(await store.seq()).toBe(before); // an unchanged catalog publishes nothing
  });

  test('a pull groups the whole catalog before storing it', async () => {
    const { store, history, groupOf } = await stores();
    const pulled = [item(1), item(2, 'Other wording'), item(3, 'Saw', { model: 'S-1' })];
    await history.annotate(pulled);
    await store.replaceAll(pulled);
    expect(await Promise.all([1, 2, 3].map(groupOf))).toEqual([1, 1, undefined]);
  });

  test('closed lots list matching open lots that have not ended: never themselves, ended lots or other models', async () => {
    const { history, addOpen } = await stores();
    await addOpen(
      item(1),
      item(2, 'Cordless drill', { model: null }),
      item(3, 'Cordless drill', { model: 'D-200' }),
      item(4, 'Cordless drill', { ends_at: new Date(0).toISOString() }),
      item(5, 'Saw', { brand: null, model: null }),
    );
    const closed: Record<string, unknown>[] = [
      { lot_id: 90, title: 'Something else', brand: 'Acme', model: 'D-100' },
      { lot_id: 91, title: 'saw' },
      { lot_id: 1, title: 'Cordless drill', brand: 'Acme', model: 'D-100' },
    ];
    await history.relisted(closed);
    expect(closed.map(c => (c['relisted'] as number[]).toSorted())).toEqual([[1], [5], [2]]);
  });
});

describe('identity', () => {
  test('history prefers identity, with title fallback in either direction', async () => {
    const { history, addClosed } = await stores();
    await addClosed(
      sold(1, 'Entirely different title', { ends_at: new Date(100).toISOString() }),
      sold(2, 'Cordless drill', { model: 'D-200', ends_at: new Date(200).toISOString() }),
      sold(3, 'Cordless drill', { brand: null, ends_at: new Date(300).toISOString() }),
      sold(4, 'Cordless drill', {
        brand: ' ACME ',
        model: ' d-100 ',
        ends_at: new Date(400).toISOString(),
      }),
    );
    const ids = async (lot: Lot) => (await history.closesFor(lot)).map(r => r.id);
    expect(await ids(sold(10))).toEqual([4, 3, 1]);
    expect(await ids(sold(10, 'Cordless drill', { model: null }))).toEqual([4, 3, 2]);
    expect(await ids(sold(4))).toEqual([3, 1]); // the same lot is never its own history
    expect(await ids(sold(10, 'Unrelated title', { model: null }))).toEqual([]);
  });

  test('history uses a fixed title threshold, not the retired setting', async () => {
    const { store, history, addClosed } = await stores();
    const title = 'Cordless drill with battery charger case bits belt clip';
    await addClosed(
      sold(1, `${title} manual`, { brand: null }),
      sold(2, 'Cordless drill with battery charger', { brand: null }),
    );
    for (const value of [50, 100]) {
      await store.putSetting('tlxNameMatch', value);
      expect((await history.closesFor(sold(3, title, { brand: null }))).map(r => r.id)).toEqual([
        1,
      ]);
    }
  });

  test('saved identity changes rebuild the history index and publish updated past closes', async () => {
    const { schema, store, history, addOpen, addClosed } = await stores();
    await addOpen(sold(10, 'Open tool'));
    await addClosed(sold(1, 'Old listing', { model: 'D-200' }));
    await history.refresh();
    expect(await store.lot(10)).not.toHaveProperty('pastCloses');
    const before = await store.seq();
    await store.saveLotDetail(sold(1, 'Old listing'));
    await history.refresh();
    const changed = (await store.changes(before)).lots;
    expect(changed.map(l => l.id)).toEqual([10]);
    expect(changed[0]?.pastCloses?.n).toBe(1);
    await store.saveLotDetail(sold(10, 'Open tool', { model: 'D-300' }));
    await history.refresh();
    expect(await store.lot(10)).not.toHaveProperty('pastCloses');
    expect(await new History(await db.openStore(schema), noSite).closesFor(sold(11))).toEqual(
      await history.closesFor(sold(11)),
    );
  });

  test('type corrections share a known identity, not identical titles of other models', async () => {
    const { store, addOpen } = await stores();
    await addOpen(
      sold(1),
      sold(2, 'Another title'),
      sold(3, 'Cordless drill', { model: 'D-200' }),
      sold(4, 'Cordless drill', { model: null }),
    );
    let before = await store.seq();
    await store.saveLotTypes([[(await store.lot(1))!, 'driver']], { manual: true });
    expect(new Set((await store.changes(before)).lots.map(l => l.id))).toEqual(new Set([1, 2, 4]));
    expect(await store.lot(3)).not.toHaveProperty('itemType');
    await store.saveLotTypes([[(await store.lot(3))!, 'hammer drill']], { manual: true });
    expect((await store.lot(1))?.itemType).toBe('driver');
    expect((await store.lot(3))?.itemType).toBe('hammer drill');
    before = await store.seq();
    await store.saveLotTypes([[(await store.lot(2))!, 'battery']]);
    expect((await store.lot(2))?.itemType).toBe('driver');
    expect(await store.seq()).toBe(before);
  });

  test('identity labels survive restarts and relisting', async () => {
    const { schema, store, addOpen } = await stores();
    await addOpen(sold(1));
    await store.saveLotTypes([[(await store.lot(1))!, 'driver']], { manual: true });
    await store.replaceAll([]);
    const reopened = await db.openStore(schema);
    const fresh = sold(5, 'New description');
    await reopened.saveLotDetail(fresh);
    await reopened.replaceAll([fresh]);
    expect((await reopened.lot(5))?.itemType).toBe('driver');
    expect(await reopened.untypedItems()).toEqual([]);
  });

  test('identity labels beat title-only automatic labels, but not manual corrections', async () => {
    const { store, addOpen } = await stores();
    const titleOnly = { title: 'Cordless drill', category: { value: 'tools' } };
    await addOpen(sold(1));
    await store.saveLotTypes([[(await store.lot(1))!, 'driver']]);
    await store.saveLotTypes([[titleOnly, 'battery']]);
    expect((await store.lot(1))?.itemType).toBe('driver');
    await store.saveLotTypes([[titleOnly, 'hammer drill']], { manual: true });
    expect((await store.lot(1))?.itemType).toBe('hammer drill');
    await store.saveLotTypes([[(await store.lot(1))!, 'driver']]);
    expect((await store.lot(1))?.itemType).toBe('hammer drill');
  });

  test('the latest manual correction wins when either identity is missing', async () => {
    const { store, addOpen } = await stores();
    await addOpen(sold(1), sold(2, 'Cordless drill', { model: null }));
    await store.saveLotTypes(
      [[{ title: 'Cordless drill', category: { value: 'tools' } }, 'battery']],
      {
        manual: true,
      },
    );
    await store.saveLotTypes([[(await store.lot(1))!, 'driver']], { manual: true });
    expect((await store.lot(2))?.itemType).toBe('driver');
    await store.saveLotTypes([[(await store.lot(2))!, 'hammer drill']], { manual: true });
    expect((await store.lot(1))?.itemType).toBe('hammer drill');
    await store.saveLotDetail(sold(2, 'Cordless drill', { model: 'D-200' }));
    await store.saveLotTypes([[(await store.lot(1))!, 'drill']], { manual: true });
    expect((await store.lot(2))?.itemType).toBe('hammer drill'); // different complete identities no longer share corrections
  });

  test('late details reassign types and publish deltas, without spurious changes on refresh', async () => {
    const { store, addOpen } = await stores();
    await addOpen(sold(1), sold(2, 'Other title', { model: null }));
    await store.saveLotTypes([[(await store.lot(1))!, 'driver']], { manual: true });
    let before = await store.seq();
    await store.saveLotDetail(sold(2, 'Other title'));
    expect((await store.lot(2))?.itemType).toBe('driver');
    expect((await store.changes(before)).lots.map(l => l.id)).toContain(2);
    before = await store.seq();
    const pulled = (await store.allLots())
      .values()
      .toArray()
      .map(({ brand: _b, model: _m, itemType: _t, ...rest }) => rest);
    await store.replaceAll(pulled);
    expect(await store.seq()).toBe(before);
    await store.saveLotDetail(sold(2, 'Other title', { model: 'Different' }));
    expect(await store.lot(2)).not.toHaveProperty('itemType');
  });

  test('the labeller asks once per known identity, and a correction made meanwhile wins', async () => {
    const { store, addOpen } = await stores();
    await addOpen(sold(1), sold(2, 'Different title'), sold(3, 'Saw', { model: 'S-1' }));
    const labeller = new Labeller(store, '');
    labeller.ask = async (_category, titles) => {
      expect(titles).toEqual(['Cordless drill', 'Saw']);
      await store.saveLotTypes([[(await store.lot(2))!, 'driver']], { manual: true });
      return new Map([
        [1, 'battery'],
        [2, 'saw'],
      ]);
    };
    await labeller.labelAll();
    expect((await store.lot(1))?.itemType).toBe('driver');
    expect((await store.lot(2))?.itemType).toBe('driver');
    expect((await store.lot(3))?.itemType).toBe('saw');
  });
});

describe('final prices', () => {
  const detail = fixture('lot-detail-with-brand-model.json').body as Record<string, unknown>;
  let store: Store;
  let calls: string[];
  const history = (reply: (path: string) => Record<string, unknown> | number) => {
    calls = [];
    const site = new SiteApi((async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      const r = reply(path);
      return typeof r === 'number'
        ? Response.json({ error: 'x' }, { status: r })
        : Response.json(r);
    }) as typeof fetch);
    return new History(store, site, () => Promise.resolve());
  };
  beforeEach(async () => {
    store = await db.openStore();
    await store.replaceAll([
      sold(1, 'Drill', { status: 'live', bid_count: 2 }),
      sold(2),
      sold(3),
      sold(4),
    ]);
    await store.replaceAll([]); // all four close, with the last price seen
  });
  const closed = async () => new Map((await store.closedLots()).map(c => [c.id, c]));

  test("the site's final state is recorded, lots still live are dropped, and lots it no longer has keep the last price", async () => {
    expect((await closed()).get(1)).toMatchObject({ final: false, sold: true, price: 20 });
    await history(path => {
      const id = Number(path.split('/').at(-2));
      if (id === 1) return { ...detail, id, status: 'sold', current_price: 31, bid_count: 5 };
      if (id === 2) return { ...detail, id, status: 'unsold', bid_count: 0 };
      if (id === 3)
        return { ...detail, id, status: 'live', ends_at: new Date(LATER).toISOString() };
      return 404;
    }).finalize();
    expect(calls).toEqual([1, 2, 3, 4].map(id => `/backend/v1/auctions/lots/test/${id}/`));
    const after = await closed();
    expect(after.get(1)).toMatchObject({ final: true, sold: true, price: 31, bidCount: 5 });
    expect(after.get(2)).toMatchObject({ final: true, sold: false });
    expect(after.has(3)).toBe(false); // back in the catalog: the next pull has it
    expect(after.get(4)).toMatchObject({ final: false, price: 20 });
    expect(await store.pendingCloses(Date.now())).toEqual([]);
    expect((await store.lotMetadata(1, detail['auction_period'] as string))?.brand).toBe(
      detail['brand'] as string,
    );
  });

  test('a failing site stops the run, leaving the rest for next time', async () => {
    await history(() => 500).finalize();
    expect(calls.length).toBe(1);
    expect((await store.pendingCloses(Date.now())).length).toBe(4);
  });

  test('ApiError carries the status', () => {
    expect(new ApiError('x', 404).status).toBe(404);
  });
});
