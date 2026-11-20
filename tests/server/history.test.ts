// Past closes, duplicate groups and final prices (src/server/history.ts), and
// item identity across the store, ported from the Python server's
// test_matching.py and test_identity.py.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { History } from '../../src/server/history';
import { Labeller } from '../../src/server/itemtypes';
import { ApiError, SiteApi } from '../../src/server/site';
import { type Lot, Store } from '../../src/server/store';
import { fixture } from './harness';

const dir = mkdtempSync(join(tmpdir(), 'tlx-history-'));
afterAll(() => rmSync(dir, { recursive: true }));
let n = 0;
const dbPath = () => join(dir, `${++n}.db`);

const LATER = 4_000_000_000_000; // an endsAt far in the future
const item = (id: number, title = 'Cordless drill', fields: Partial<Lot> = {}): Lot => ({
  id,
  title,
  brand: 'Acme',
  model: 'D-100',
  condition: null,
  ends_at: new Date(LATER).toISOString(),
  ...fields,
});
// test_identity.py's lots: closed ones, sold.
const sold = (id: number, title = 'Cordless drill', fields: Partial<Lot> = {}): Lot => ({
  id,
  title,
  brand: 'Acme',
  model: 'D-100',
  auction_period: 'test',
  ends_at: new Date(1000).toISOString(),
  current_price: 20,
  condition: null,
  status: 'sold',
  bid_count: 1,
  category: { value: 'tools', label: 'Tools' },
  ...fields,
});

/** A site API that fails every request: history must not ask the site unless a test says so. */
const noSite = new SiteApi((() =>
  Promise.reject(new Error('no site in this test'))) as unknown as typeof fetch);

function stores(path = dbPath()) {
  const store = new Store(path);
  const history = new History(store, noSite, () => Promise.resolve());
  const addOpen = (...items: Lot[]) => {
    items.forEach(i => store.saveLotDetail(i));
    store.replaceAll(items.map(i => structuredClone(i)));
  };
  const addClosed = (...items: Lot[]) => {
    for (const i of items) {
      store.saveLotDetail(i);
      store.finishClose(i.id, i);
    }
  };
  const groupOf = (id: number) => store.lot(id)?.groupId;
  return { path, store, history, addOpen, addClosed, groupOf };
}

describe('stored matching', () => {
  test('groups are stored, and late details regroup with a catalog delta', () => {
    const { store, history, addOpen, groupOf } = stores();
    addOpen(item(1), item(2, 'Different title'), item(3, 'Saw', { model: 'S-1' }));
    history.refresh();
    expect([1, 2, 3].map(groupOf)).toEqual([1, 1, undefined]);
    let before = store.seq();
    store.saveLotDetail(item(2, 'Different title', { model: 'D-200' }));
    history.refresh();
    expect([1, 2].map(groupOf)).toEqual([undefined, undefined]);
    expect(new Set(store.changes(before).lots.map(l => l.id))).toEqual(new Set([1, 2]));
    before = store.seq();
    history.refresh();
    expect(store.seq()).toBe(before); // an unchanged catalog publishes nothing
  });

  test('a pull groups the whole catalog before storing it', () => {
    const { store, history, groupOf } = stores();
    const pulled = [item(1), item(2, 'Other wording'), item(3, 'Saw', { model: 'S-1' })];
    history.annotate(pulled);
    store.replaceAll(pulled);
    expect([1, 2, 3].map(groupOf)).toEqual([1, 1, undefined]);
  });

  test('closed lots list matching open lots that have not ended: never themselves, ended lots or other models', () => {
    const { history, addOpen } = stores();
    addOpen(
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
    history.relisted(closed);
    expect(closed.map(c => (c['relisted'] as number[]).toSorted())).toEqual([[1], [5], [2]]);
  });
});

describe('identity', () => {
  test('history prefers identity, with title fallback in either direction', () => {
    const { history, addClosed } = stores();
    addClosed(
      sold(1, 'Entirely different title', { ends_at: new Date(100).toISOString() }),
      sold(2, 'Cordless drill', { model: 'D-200', ends_at: new Date(200).toISOString() }),
      sold(3, 'Cordless drill', { brand: null, ends_at: new Date(300).toISOString() }),
      sold(4, 'Cordless drill', {
        brand: ' ACME ',
        model: ' d-100 ',
        ends_at: new Date(400).toISOString(),
      }),
    );
    const ids = (lot: Lot) => history.closesFor(lot).map(r => r.id);
    expect(ids(sold(10))).toEqual([4, 3, 1]);
    expect(ids(sold(10, 'Cordless drill', { model: null }))).toEqual([4, 3, 2]);
    expect(ids(sold(4))).toEqual([3, 1]); // the same lot is never its own history
    expect(ids(sold(10, 'Unrelated title', { model: null }))).toEqual([]);
  });

  test('history uses a fixed title threshold, not the retired setting', () => {
    const { store, history, addClosed } = stores();
    const title = 'Cordless drill with battery charger case bits belt clip';
    addClosed(
      sold(1, `${title} manual`, { brand: null }),
      sold(2, 'Cordless drill with battery charger', { brand: null }),
    );
    for (const value of [50, 100]) {
      store.putSetting('tlxNameMatch', value);
      expect(history.closesFor(sold(3, title, { brand: null })).map(r => r.id)).toEqual([1]);
    }
  });

  test('saved identity changes rebuild the history index and publish updated past closes', () => {
    const { path, store, history, addOpen, addClosed } = stores();
    addOpen(sold(10, 'Open tool'));
    addClosed(sold(1, 'Old listing', { model: 'D-200' }));
    history.refresh();
    expect(store.lot(10)).not.toHaveProperty('pastCloses');
    const before = store.seq();
    store.saveLotDetail(sold(1, 'Old listing'));
    history.refresh();
    const changed = store.changes(before).lots;
    expect(changed.map(l => l.id)).toEqual([10]);
    expect(changed[0]?.pastCloses?.n).toBe(1);
    store.saveLotDetail(sold(10, 'Open tool', { model: 'D-300' }));
    history.refresh();
    expect(store.lot(10)).not.toHaveProperty('pastCloses');
    expect(new History(new Store(path), noSite).closesFor(sold(11))).toEqual(
      history.closesFor(sold(11)),
    );
  });

  test('type corrections share a known identity, not identical titles of other models', () => {
    const { store, addOpen } = stores();
    addOpen(
      sold(1),
      sold(2, 'Another title'),
      sold(3, 'Cordless drill', { model: 'D-200' }),
      sold(4, 'Cordless drill', { model: null }),
    );
    let before = store.seq();
    store.saveLotTypes([[store.lot(1)!, 'driver']], { manual: true });
    expect(new Set(store.changes(before).lots.map(l => l.id))).toEqual(new Set([1, 2, 4]));
    expect(store.lot(3)).not.toHaveProperty('itemType');
    store.saveLotTypes([[store.lot(3)!, 'hammer drill']], { manual: true });
    expect(store.lot(1)?.itemType).toBe('driver');
    expect(store.lot(3)?.itemType).toBe('hammer drill');
    before = store.seq();
    store.saveLotTypes([[store.lot(2)!, 'battery']]);
    expect(store.lot(2)?.itemType).toBe('driver');
    expect(store.seq()).toBe(before);
  });

  test('identity labels survive restarts and relisting', () => {
    const { path, store, addOpen } = stores();
    addOpen(sold(1));
    store.saveLotTypes([[store.lot(1)!, 'driver']], { manual: true });
    store.replaceAll([]);
    const reopened = new Store(path);
    const fresh = sold(5, 'New description');
    reopened.saveLotDetail(fresh);
    reopened.replaceAll([fresh]);
    expect(reopened.lot(5)?.itemType).toBe('driver');
    expect(reopened.untypedItems()).toEqual([]);
  });

  test('identity labels beat title-only automatic labels, but not manual corrections', () => {
    const { store, addOpen } = stores();
    const titleOnly = { title: 'Cordless drill', category: { value: 'tools' } };
    addOpen(sold(1));
    store.saveLotTypes([[store.lot(1)!, 'driver']]);
    store.saveLotTypes([[titleOnly, 'battery']]);
    expect(store.lot(1)?.itemType).toBe('driver');
    store.saveLotTypes([[titleOnly, 'hammer drill']], { manual: true });
    expect(store.lot(1)?.itemType).toBe('hammer drill');
    store.saveLotTypes([[store.lot(1)!, 'driver']]);
    expect(store.lot(1)?.itemType).toBe('hammer drill');
  });

  test('the latest manual correction wins when either identity is missing', () => {
    const { store, addOpen } = stores();
    addOpen(sold(1), sold(2, 'Cordless drill', { model: null }));
    store.saveLotTypes([[{ title: 'Cordless drill', category: { value: 'tools' } }, 'battery']], {
      manual: true,
    });
    store.saveLotTypes([[store.lot(1)!, 'driver']], { manual: true });
    expect(store.lot(2)?.itemType).toBe('driver');
    store.saveLotTypes([[store.lot(2)!, 'hammer drill']], { manual: true });
    expect(store.lot(1)?.itemType).toBe('hammer drill');
    store.saveLotDetail(sold(2, 'Cordless drill', { model: 'D-200' }));
    store.saveLotTypes([[store.lot(1)!, 'drill']], { manual: true });
    expect(store.lot(2)?.itemType).toBe('hammer drill'); // different complete identities no longer share corrections
  });

  test('late details reassign types and publish deltas, without spurious changes on refresh', () => {
    const { store, addOpen } = stores();
    addOpen(sold(1), sold(2, 'Other title', { model: null }));
    store.saveLotTypes([[store.lot(1)!, 'driver']], { manual: true });
    let before = store.seq();
    store.saveLotDetail(sold(2, 'Other title'));
    expect(store.lot(2)?.itemType).toBe('driver');
    expect(store.changes(before).lots.map(l => l.id)).toContain(2);
    before = store.seq();
    const pulled = store
      .allLots()
      .values()
      .toArray()
      .map(({ brand: _b, model: _m, itemType: _t, ...rest }) => rest);
    store.replaceAll(pulled);
    expect(store.seq()).toBe(before);
    store.saveLotDetail(sold(2, 'Other title', { model: 'Different' }));
    expect(store.lot(2)).not.toHaveProperty('itemType');
  });

  test('the labeller asks once per known identity, and a correction made meanwhile wins', async () => {
    const { store, addOpen } = stores();
    addOpen(sold(1), sold(2, 'Different title'), sold(3, 'Saw', { model: 'S-1' }));
    const labeller = new Labeller(store, '');
    labeller.ask = (_category, titles) => {
      expect(titles).toEqual(['Cordless drill', 'Saw']);
      store.saveLotTypes([[store.lot(2)!, 'driver']], { manual: true });
      return Promise.resolve(
        new Map([
          [1, 'battery'],
          [2, 'saw'],
        ]),
      );
    };
    await labeller.labelAll();
    expect(store.lot(1)?.itemType).toBe('driver');
    expect(store.lot(2)?.itemType).toBe('driver');
    expect(store.lot(3)?.itemType).toBe('saw');
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
  beforeEach(() => {
    store = new Store(':memory:');
    store.replaceAll([
      sold(1, 'Drill', { status: 'live', bid_count: 2 }),
      sold(2),
      sold(3),
      sold(4),
    ]);
    store.replaceAll([]); // all four close, with the last price seen
  });
  const closed = () => new Map(store.closedLots().map(c => [c.id, c]));

  test("the site's final state is recorded, lots still live are dropped, and lots it no longer has keep the last price", async () => {
    expect(closed().get(1)).toMatchObject({ final: false, sold: true, price: 20 });
    await history(path => {
      const id = Number(path.split('/').at(-2));
      if (id === 1) return { ...detail, id, status: 'sold', current_price: 31, bid_count: 5 };
      if (id === 2) return { ...detail, id, status: 'unsold', bid_count: 0 };
      if (id === 3)
        return { ...detail, id, status: 'live', ends_at: new Date(LATER).toISOString() };
      return 404;
    }).finalize();
    expect(calls).toEqual([1, 2, 3, 4].map(id => `/backend/v1/auctions/lots/test/${id}/`));
    const after = closed();
    expect(after.get(1)).toMatchObject({ final: true, sold: true, price: 31, bidCount: 5 });
    expect(after.get(2)).toMatchObject({ final: true, sold: false });
    expect(after.has(3)).toBe(false); // back in the catalog: the next pull has it
    expect(after.get(4)).toMatchObject({ final: false, price: 20 });
    expect(store.pendingCloses(Date.now())).toEqual([]);
    expect(store.lotMetadata(1, detail['auction_period'] as string)?.brand).toBe(
      detail['brand'] as string,
    );
  });

  test('a failing site stops the run, leaving the rest for next time', async () => {
    await history(() => 500).finalize();
    expect(calls.length).toBe(1);
    expect(store.pendingCloses(Date.now()).length).toBe(4);
  });

  test('ApiError carries the status', () => {
    expect(new ApiError('x', 404).status).toBe(404);
  });
});
