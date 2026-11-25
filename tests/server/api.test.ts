import { describe, expect, test } from 'bun:test';

// This server's own /api endpoints, ported from the Python server's API tests
// (test_itemtypes.py, test_metadata.py, test_tags.py, test_identity.py).
import { rawLot } from '../raw-lot.mjs';
import { setup } from './harness';
import { testDb } from './pg';

testDb();

const lot = (id: number, title = 'Drill', fields: Partial<Lot> = {}): Lot => ({
  ...rawLot({ id, title }),
  ...fields,
});

describe('/api/catalog', () => {
  test('a full reply, then only what changed, with the id list for deltas', async () => {
    const { request, store } = await setup();
    await store.replaceAll([lot(1), lot(2, 'Saw')]);
    const first = await (await request('/api/catalog')).json();
    expect(first).toMatchObject({ seq: 1, full: true, ids: null, progress: null, error: null });
    expect(first.lots.map((l: Lot) => l.id)).toEqual([1, 2]);
    expect(first.meta).toEqual({ fetchedAt: null, pullStartedAt: null, count: 0, authed: false });
    expect(first.nextPullAt).toBe(0);
    await store.replaceAll([lot(1, 'Drill', { current_price: 5 })]);
    const delta = await (await request('/api/catalog?since=1')).json();
    expect(delta).toMatchObject({ seq: 2, full: false, ids: [1] });
    expect(delta.lots.map((l: Lot) => [l.id, l.current_price])).toEqual([[1, 5]]);
    expect((await (await request('/api/catalog?since=99')).json()).full).toBe(true);
    expect((await (await request('/api/catalog?since=bad')).json()).full).toBe(true);
  });

  test('the Refresh button starts a pull only when one is allowed', async () => {
    const { post, store } = await setup();
    expect((await (await post('/api/pull')).json()).result).toBe('started');
    await store.writeMeta({ pullStartedAt: Date.now() });
    const body = await (await post('/api/pull')).json();
    expect(body.result).toBe('not-due');
    expect(body.nextPullAt).toBe(body.meta.pullStartedAt + 5 * 60_000);
  });
});

describe('/api/settings', () => {
  test('settings are saved by key and read back with the revision', async () => {
    const { request, send } = await setup();
    expect(await (await send('PUT', '/api/settings/tlxSyncMinutes', { value: 2 })).json()).toEqual({
      rev: 1,
    });
    expect(await (await request('/api/settings')).json()).toEqual({
      rev: 1,
      values: { tlxSyncMinutes: 2 },
    });
    expect((await send('PUT', '/api/settings/bad-key', { value: 1 })).status).toBe(400);
    expect((await send('PUT', '/api/settings/x', { other: 1 })).status).toBe(400);
  });

  test('filterTypes validates an array of strings and persists to filter_types', async () => {
    const { request, send, store } = await setup();
    expect(
      await (await send('PUT', '/api/settings/filterTypes', { value: ['saw', 'drill'] })).json(),
    ).toEqual({ rev: 1 });
    expect(await (await request('/api/settings')).json()).toEqual({
      rev: 1,
      values: { filterTypes: ['drill', 'saw'] },
    });
    expect(await store.filterTypes()).toEqual(['drill', 'saw']);
    expect((await send('PUT', '/api/settings/filterTypes', { value: 'drill' })).status).toBe(400);
    expect((await send('PUT', '/api/settings/filterTypes', { value: [1] })).status).toBe(400);
  });
});

describe('/api/lot-metadata', () => {
  test('saved item details only, never from the site, and only for the right period', async () => {
    const { request, store, siteCalls } = await setup();
    await store.saveLotDetail({
      id: 1,
      auction_period: 'test',
      description: 'Saved',
      brand: 'Acme',
      model: 'D1',
      lot_fee: 2,
    });
    const get = async (query: string) => {
      const res = await request(`/api/lot-metadata?${query}`);
      return [res.status, await res.json()];
    };
    expect(await get('id=1&auctionPeriod=test')).toEqual([
      200,
      { metadata: { description: 'Saved', brand: 'Acme', model: 'D1', lot_fee: 2 } },
    ]);
    expect(await get('id=99&auctionPeriod=test')).toEqual([200, { metadata: null }]);
    expect(await get('id=1&auctionPeriod=other')).toEqual([200, { metadata: null }]);
    for (const query of ['', 'id=1', 'id=0&auctionPeriod=test', 'id=bad&auctionPeriod=test']) {
      expect((await get(query))[0]).toBe(400);
    }
    expect(siteCalls).toEqual([]);
  });

  test('it obeys the app guards', async () => {
    const { request, store } = await setup({ password: 'fixture-password' });
    expect((await request('/api/lot-metadata?id=1&auctionPeriod=test')).status).toBe(401);
    await store.addSession('fixture-session');
    const res = await request('/api/lot-metadata?id=1&auctionPeriod=test', {
      headers: { Cookie: 'tlx_session=fixture-session' },
    });
    expect(res.status).toBe(200);
    expect(
      (await request('/api/lot-metadata?id=1&auctionPeriod=test', { host: 'untrusted.example' }))
        .status,
    ).toBe(401);
  });
});

describe('/api/item-type', () => {
  const put = async (
    s: Awaited<ReturnType<typeof setup>>,
    body: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await s.send('PUT', '/api/item-type', body, headers);
    return [res.status, await res.json()];
  };

  test('saves the tidied type and replies with the changed lots and catalog sequence', async () => {
    const s = await setup();
    await s.store.replaceAll([lot(1), lot(2)]);
    const before = await s.store.seq();
    expect(await put(s, { lotId: 1, itemType: '  "Drill   Driver."  ' })).toEqual([
      200,
      { lotIds: [1, 2], itemType: 'drill driver', seq: before + 1 },
    ]);
    expect(
      new Set(
        (await s.store.allLots())
          .values()
          .toArray()
          .map(l => l.itemType),
      ),
    ).toEqual(new Set(['drill driver']));
    await s.store.saveLotTypes([[{ title: 'Drill', category: { value: 'tools' } }, 'battery']]);
    expect((await s.store.lot(1))?.itemType).toBe('drill driver');
  });

  test('corrections follow the same identity, not the same title of another model', async () => {
    const s = await setup();
    await s.store.replaceAll([lot(1), lot(2, 'Different title'), lot(3)]);
    await s.store.saveLotDetail({ id: 1, brand: 'Acme', model: 'D-100' });
    await s.store.saveLotDetail({ id: 2, brand: 'Acme', model: 'D-100' });
    await s.store.saveLotDetail({ id: 3, brand: 'Acme', model: 'D-200' });
    const [status, body] = await put(s, { lotId: 1, itemType: 'driver' });
    expect(status).toBe(200);
    expect(body.lotIds).toEqual([1, 2]);
    expect(await s.store.lot(3)).not.toHaveProperty('itemType');
  });

  test('a missing lot is a 404', async () => {
    const s = await setup();
    expect(await put(s, { lotId: 99, itemType: 'drill' })).toEqual([
      404,
      { error: 'No such catalog lot' },
    ]);
  });

  test('bad ids, types and JSON shapes are refused without changes', async () => {
    const s = await setup();
    await s.store.replaceAll([lot(1), lot(2)]);
    const before = await s.store.seq();
    for (const body of [
      [],
      null,
      {},
      { lotId: true, itemType: 'drill' },
      { lotId: '1', itemType: 'drill' },
      { lotId: 0, itemType: 'drill' },
      { lotId: -1, itemType: 'drill' },
      { lotId: 2 ** 64, itemType: 'drill' },
      { lotId: 1.5, itemType: 'drill' },
      { lotId: 1, itemType: null },
      { lotId: 1, itemType: 3 },
      { lotId: 1, itemType: '   ' },
      { lotId: 1, itemType: '...' },
      { lotId: 1, itemType: 'drill\x00' },
      { lotId: 1, itemType: 'x'.repeat(61) },
    ]) {
      const [status, data] = await put(s, body);
      expect([JSON.stringify(body), status]).toEqual([JSON.stringify(body), 400]);
      expect(data.error).toBeTruthy();
    }
    expect(await s.store.seq()).toBe(before);
  });

  test('the CSRF header and app password guard corrections', async () => {
    const s = await setup({ password: 'test-only-password' });
    await s.store.replaceAll([lot(1)]);
    const res = await s.request('/api/item-type', { method: 'PUT', body: '{}' });
    expect(res.status).toBe(403);
    expect((await put(s, { lotId: 1, itemType: 'drill driver' }))[0]).toBe(401);
    expect((await s.store.lot(1))?.itemType).toBeUndefined();
    await s.store.addSession('test-session');
    expect(
      (
        await put(s, { lotId: 1, itemType: 'drill driver' }, { Cookie: 'tlx_session=test-session' })
      )[0],
    ).toBe(200);
  });
});

describe('/api/history', () => {
  test('closed lots matching an open lot, most recent first', async () => {
    const { request, store } = await setup();
    await store.replaceAll([
      lot(1, 'Cordless drill', { ends_at: new Date(100).toISOString() }),
      lot(2, 'Cordless drill', { ends_at: new Date(200).toISOString() }),
      lot(3, 'Saw'),
    ]);
    await store.replaceAll([lot(3, 'Saw'), lot(4, 'Cordless drill')]);
    const body = await (await request('/api/history?id=4')).json();
    expect(body.closes.map((c: { id: number }) => c.id)).toEqual([2, 1]);
    expect(body.closes[0]).toMatchObject({
      title: 'Cordless drill',
      endsAt: 200,
      final: false,
      sold: false,
    });
    expect((await request('/api/history?id=99')).status).toBe(400);
    expect((await request('/api/history')).status).toBe(400);
  });
});
