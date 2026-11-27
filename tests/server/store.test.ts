import { beforeEach, describe, expect, test } from 'bun:test';

// The store (src/server/store.ts), ported from the Python server's
// test_brands.py, test_metadata.py, test_itemtypes.py and test_tags.py.
import { SQL } from 'bun';

import type { Store } from '../../src/server/store';
import { KEYS } from '../../src/shared/keys';
import { rawDetail, rawLot } from '../raw-lot.mjs';
import { testDb } from './pg';

const db = testDb();
const byId = (lots: Lot[]) => new Map(lots.map(lot => [lot.id, lot]));

describe('brands and models from lot details', () => {
  let schema: string;
  let store: Store;
  const lots = [1, 2, 3].map(i => rawLot({ id: i, title: `Item ${i}` }));
  beforeEach(async () => {
    schema = db.nextSchema();
    store = await db.openStore(schema);
    await store.replaceAll(lots);
  });

  test('the catalog tells uncached details from known missing brands', async () => {
    const before = await store.seq();
    await store.saveLotDetail({ id: 1, brand: '  Acme  ', model: '  D-1  ' });
    await store.saveLotDetail({ id: 2, brand: null, model: '   ' });
    const catalog = byId((await store.changes(0)).lots);
    expect(catalog.get(1)).toMatchObject({ brand: 'Acme', model: 'D-1' });
    expect(catalog.get(2)).toMatchObject({ brand: null, model: null });
    expect(catalog.get(3)).not.toHaveProperty('brand');
    expect(catalog.get(3)).not.toHaveProperty('model');
    expect(new Set((await store.changes(before)).lots.map(l => l.id))).toEqual(new Set([1, 2]));
  });

  test('details survive reopening the database and catalog refreshes', async () => {
    await store.saveLotDetail({ id: 1, brand: 'Acme', model: 'D-1' });
    await store.saveLotDetail({ id: 2, brand: null });
    const reopened = await db.openStore(schema);
    const before = await reopened.seq();
    await reopened.replaceAll(structuredClone(lots));
    expect(await reopened.seq()).toBe(before); // joined brands must not cause spurious catalog changes
    expect((await reopened.changes(before)).lots).toEqual([]);
    const catalog = byId((await reopened.changes(0)).lots);
    expect(catalog.get(1)).toMatchObject({ brand: 'Acme', model: 'D-1' });
    expect(catalog.get(2)?.brand).toBeNull();
    await reopened.replaceAll(lots.map(lot => ({ ...lot, current_price: 25 })));
    expect((await reopened.changes(before)).lots[0]).toMatchObject({ brand: 'Acme', model: 'D-1' });
  });

  test('only brand, model or description changes publish catalog deltas', async () => {
    await store.saveLotDetail({ id: 1, brand: 'Acme', description: 'Initial' });
    let before = await store.seq();
    await store.saveLotDetail({ id: 1, brand: 'Acme', description: 'Initial', lot_fee: 5 });
    expect(await store.seq()).toBe(before);
    await store.saveLotDetail({ id: 1, brand: 'Acme', description: 'Updated' });
    expect((await store.changes(before)).lots.map(l => [l.id, l.description])).toEqual([
      [1, 'Updated'],
    ]);
    before = await store.seq();
    await store.saveLotDetail({ id: 1, brand: 'Other', description: 'Updated' });
    expect((await store.changes(before)).lots.map(l => [l.id, l.brand])).toEqual([[1, 'Other']]);
    before = await store.seq();
    await store.saveLotDetail({ id: 1, brand: '', description: 'Updated' });
    expect((await store.changes(before)).lots.map(l => [l.id, l.brand])).toEqual([[1, null]]);
  });

  test('cached details are there when a lot enters the catalog', async () => {
    const before = await store.seq();
    await store.saveLotDetail({ id: 4, brand: 'Already cached' });
    expect(await store.seq()).toBe(before); // closed or unknown lots must not bump the catalog sequence
    await store.replaceAll([...lots, rawLot({ id: 4 })]);
    expect(byId((await store.changes(0)).lots).get(4)?.brand).toBe('Already cached');
  });

  test('model-only changes and removals publish deltas', async () => {
    await store.saveLotDetail({ id: 1, brand: null, model: 'D-1' });
    let before = await store.seq();
    await store.saveLotDetail({ id: 1, brand: null, model: ' D-1 ', lot_fee: 3 });
    expect(await store.seq()).toBe(before);
    await store.saveLotDetail({ id: 1, brand: null, model: 'D-2' });
    expect((await store.changes(before)).lots.map(l => [l.id, l.model])).toEqual([[1, 'D-2']]);
    before = await store.seq();
    await store.saveLotDetail({ id: 1, brand: null, model: null });
    expect((await store.changes(before)).lots.map(l => [l.id, l.model])).toEqual([[1, null]]);
  });
});

describe('lot metadata', () => {
  const raw = rawDetail({
    id: 1,
    title: 'Drill',
    description: 'Saved description',
    brand: 'Acme',
    model: 'D1',
    lot_fee: 2,
    current_price: 17,
    bid_count: 3,
    status: 'open',
    version: 5,
    ends_at: '2030-01-01T00:00:00Z',
    your_standing: { is_leading: true, your_max_bid: 20 },
    is_watchlisted: true,
    bid_history: [{ bidder_label: 'Private bidder', amount: 17, is_you: true }],
    images: [
      { position: 1, image_thumb: 'thumb.jpg', image_card: 'card.jpg', image_large: 'large.jpg' },
    ],
  });
  const expected = {
    description: 'Saved description',
    brand: 'Acme',
    model: 'D1',
    lot_fee: 2,
    images: [
      { position: 1, image_thumb: 'thumb.jpg', image_card: 'card.jpg', image_large: 'large.jpg' },
    ],
  };

  test('metadata survives restart and lot removal, without auction or account fields', async () => {
    const schema = db.nextSchema();
    const store = await db.openStore(schema);
    await store.replaceAll([raw]);
    await store.saveLotDetail(raw);
    await store.replaceAll([]);
    const reopened = await db.openStore(schema);
    expect(await reopened.lotMetadata(1, 'test')).toEqual(expected);
    expect(await reopened.lotMetadata(1, 'different-period')).toBeNull();
    expect(await reopened.lotMetadata(2, 'test')).toBeNull();
    await reopened.saveLotDetail({ ...raw, description: 'Corrected', images: [] });
    expect(await reopened.lotMetadata(1, 'test')).toEqual({
      ...expected,
      description: 'Corrected',
      images: [],
    });
  });

  test('leading Quantity and trailing Lot Number/Brand are stripped from description', async () => {
    const store = await db.openStore();
    await store.saveLotDetail({
      ...raw,
      id: 10,
      description: 'Quantity: 6,\n\nImpact driver kit.\n\nLot Number: 21810009,\nBrand: Lasko,',
    });
    await store.saveLotDetail({
      ...raw,
      id: 11,
      description: 'Quantity: 24,\r\n\r\nBox of bolts.\r\n\r\nLot Number: 21810010,',
    });
    await store.saveLotDetail({
      ...raw,
      id: 12,
      description: 'Quantity: 3,\n\nLot Number: 21811735,',
    });
    await store.saveLotDetail({
      ...raw,
      id: 13,
      description: 'No boilerplate here.',
    });

    expect(await store.lotMetadata(10, 'test')).toMatchObject({
      description: 'Impact driver kit.',
      quantity: 6,
    });
    expect(await store.lotMetadata(11, 'test')).toMatchObject({
      description: 'Box of bolts.',
      quantity: 24,
    });
    expect(await store.lotMetadata(12, 'test')).toMatchObject({
      description: '',
      quantity: 3,
    });
    const noQty = await store.lotMetadata(13, 'test');
    expect(noQty?.description).toBe('No boilerplate here.');
    expect(noQty).not.toHaveProperty('quantity');

    const rows = [
      ...(await store.sql.unsafe(
        'SELECT lot_id, quantity, description FROM lot_details WHERE lot_id IN (10, 11, 12, 13) ORDER BY lot_id',
      )),
    ];
    expect(rows).toEqual([
      { lot_id: '10', quantity: 6, description: 'Impact driver kit.' },
      { lot_id: '11', quantity: 24, description: 'Box of bolts.' },
      { lot_id: '12', quantity: 3, description: '' },
      { lot_id: '13', quantity: null, description: 'No boilerplate here.' },
    ]);
  });
});

const item = (id: number, title = 'Drill', fields: Partial<Lot> = {}): Lot => ({
  ...rawLot({ id, title }),
  ...fields,
});

describe('item types', () => {
  let schema: string;
  let store: Store;
  const tools = { value: 'tools' };
  const label = (
    title: string,
    type: string,
  ): [{ title: string; category: { value: string } }, string] => [{ title, category: tools }, type];
  beforeEach(async () => {
    schema = db.nextSchema();
    store = await db.openStore(schema);
    await store.replaceAll([item(1), item(2), item(3, 'Saw')]);
  });

  test('a manual correction touches every exact title match and leaves other lots alone', async () => {
    await store.saveLotTypes([label('Drill', 'battery'), label('Saw', 'saw')]);
    const before = await store.seq();
    await store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    const changes = await store.changes(before);
    expect(new Set(changes.lots.map(l => l.id))).toEqual(new Set([1, 2]));
    expect(changes.lots.every(l => l.itemType === 'drill driver')).toBe(true);
    expect([(await store.lot(1))?.itemType, (await store.lot(3))?.itemType]).toEqual([
      'drill driver',
      'saw',
    ]);
  });

  test('corrections survive reopening, catalog refreshes and future relistings', async () => {
    await store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    const reopened = await db.openStore(schema);
    await reopened.replaceAll([item(1, 'Drill', { current_price: 20 }), item(4)]);
    expect(
      new Set(
        (await reopened.allLots())
          .values()
          .toArray()
          .map(l => l.itemType),
      ),
    ).toEqual(new Set(['drill driver']));
    expect(await reopened.untypedItems()).toEqual([]);
  });

  test('automatic writes never replace corrections or bump their sequence', async () => {
    await store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    const before = await store.seq();
    await store.saveLotTypes([label('Drill', 'battery')]);
    expect(await store.seq()).toBe(before);
    expect((await store.lot(1))?.itemType).toBe('drill driver');
    await store.saveLotTypes([label('Drill', 'battery'), label('Saw', 'saw')]);
    expect((await store.changes(before)).lots.map(l => l.id)).toEqual([3]);
  });

  test('the same type can be marked manual, then corrected, without an unneeded delta', async () => {
    await store.saveLotTypes([label('Drill', 'drill driver')]);
    const before = await store.seq();
    await store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    expect(await store.seq()).toBe(before);
    await store.saveLotTypes([label('Drill', 'battery')]);
    expect(await store.seq()).toBe(before);
    await store.saveLotTypes([label('Drill', 'hammer drill')], { manual: true });
    expect((await store.lot(1))?.itemType).toBe('hammer drill');
  });

  test('common types are counted per site category', async () => {
    await store.saveLotTypes([
      label('Drill', 'drill driver'),
      label('Saw', 'saw'),
      label('Other', 'saw'),
    ]);
    expect(await store.commonTypes('tools', 5)).toEqual(['saw', 'drill driver']);
    expect(await store.commonTypes(null, 5)).toEqual([]);
  });
});

describe('settings and sessions', () => {
  test('settings keep a revision; clients newer than the database get everything', async () => {
    const store = await db.openStore();
    expect(await store.putSetting('a', 1)).toBe(1);
    expect(await store.putSetting('b', { x: [1] })).toBe(2);
    expect(await store.settings(1)).toEqual({ rev: 2, values: { b: { x: [1] } } });
    expect(await store.settings(99)).toEqual({ rev: 2, values: { a: 1, b: { x: [1] } } });
    expect(await store.setting('a')).toBe(1);
    expect(await store.setting('missing')).toBeUndefined();
  });

  test('filterTypes is stored in its own filter_types table with revision tracking', async () => {
    const store = await db.openStore();
    expect(await store.setting(KEYS.filterTypes)).toBeUndefined();
    expect(await store.settings()).toEqual({ rev: 0, values: {} });
    expect(await store.filterTypes()).toEqual([]);

    expect(await store.putSetting(KEYS.filterTypes, [' Saw ', 'drill', 'DRILL', ''])).toBe(1);
    expect(await store.filterTypes()).toEqual(['drill', 'saw']);
    expect(await store.setting(KEYS.filterTypes)).toEqual(['drill', 'saw']);
    expect(await store.settings(0)).toEqual({ rev: 1, values: { filterTypes: ['drill', 'saw'] } });
    expect(await store.settings(1)).toEqual({ rev: 1, values: {} });
    expect(await store.settings(99)).toEqual({ rev: 1, values: { filterTypes: ['drill', 'saw'] } });
    // Must live in filter_types, not in the settings blob table.
    expect(
      await store.sql.unsafe('SELECT 1 FROM settings WHERE key = $1', [KEYS.filterTypes]),
    ).toHaveLength(0);
    expect([...(await store.sql.unsafe('SELECT type FROM filter_types ORDER BY type'))]).toEqual([
      { type: 'drill' },
      { type: 'saw' },
    ]);

    expect(await store.putSetting(KEYS.filterTypes, [])).toBe(2);
    expect(await store.setting(KEYS.filterTypes)).toEqual([]);
    expect(await store.settings(1)).toEqual({ rev: 2, values: { filterTypes: [] } });
  });

  test('existing settings.filterTypes rows migrate into filter_types on open', async () => {
    const schema = db.nextSchema();
    const raw = new SQL({ url: db.url, max: 1 });
    try {
      await raw.unsafe(`CREATE SCHEMA "${schema}"`);
      await raw.unsafe(`SET search_path TO "${schema}"`);
      await raw.unsafe('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await raw.unsafe(
        'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL)',
      );
      await raw.unsafe("INSERT INTO meta (key, value) VALUES ('settingsRev', '10')");
      await raw.unsafe('INSERT INTO settings (key, value, rev) VALUES ($1, $2, $3)', [
        KEYS.filterTypes,
        JSON.stringify(['phone case', 'Drill', 'drill']),
        8,
      ]);
    } finally {
      await raw.close();
    }

    const store = await db.openStore(schema);
    expect(await store.filterTypes()).toEqual(['drill', 'phone case']);
    expect(await store.setting(KEYS.filterTypes)).toEqual(['drill', 'phone case']);
    expect(await store.settings(7)).toEqual({
      rev: 10,
      values: { filterTypes: ['drill', 'phone case'] },
    });
    expect(await store.settings(8)).toEqual({ rev: 10, values: {} });
    expect(
      await store.sql.unsafe('SELECT 1 FROM settings WHERE key = $1', [KEYS.filterTypes]),
    ).toHaveLength(0);

    // Reopening is idempotent and keeps migrated rows.
    const reopened = await db.openStore(schema);
    expect(await reopened.filterTypes()).toEqual(['drill', 'phone case']);
  });

  test('hiddenLots is stored in its own hidden_lots table with revision tracking', async () => {
    const store = await db.openStore();
    expect(await store.setting(KEYS.hidden)).toBeUndefined();
    expect(await store.settings()).toEqual({ rev: 0, values: {} });
    expect(await store.hiddenLots()).toEqual({});

    const sample = {
      '101': { title: 'Cordless drill', ts: 1_795_471_903_166 },
      '202': { title: 'Garden rake', ts: 1_795_471_999_000 },
    };
    expect(await store.putSetting(KEYS.hidden, sample)).toBe(1);
    expect(await store.hiddenLots()).toEqual(sample);
    expect(await store.setting(KEYS.hidden)).toEqual(sample);
    expect(await store.settings(0)).toEqual({ rev: 1, values: { hiddenLots: sample } });
    expect(await store.settings(1)).toEqual({ rev: 1, values: {} });
    expect(await store.settings(99)).toEqual({ rev: 1, values: { hiddenLots: sample } });
    // Must live in hidden_lots, not in the settings blob table.
    expect(
      await store.sql.unsafe('SELECT 1 FROM settings WHERE key = $1', [KEYS.hidden]),
    ).toHaveLength(0);
    expect([
      ...(await store.sql.unsafe('SELECT lot_id, title, ts FROM hidden_lots ORDER BY lot_id')),
    ]).toEqual([
      {
        lot_id: '101',
        title: 'Cordless drill',
        ts: '1795471903166',
      },
      {
        lot_id: '202',
        title: 'Garden rake',
        ts: '1795471999000',
      },
    ]);

    expect(await store.putSetting(KEYS.hidden, {})).toBe(2);
    expect(await store.setting(KEYS.hidden)).toEqual({});
    expect(await store.settings(1)).toEqual({ rev: 2, values: { hiddenLots: {} } });
  });

  test('existing settings.hiddenLots rows migrate into hidden_lots on open', async () => {
    const schema = db.nextSchema();
    const raw = new SQL({ url: db.url, max: 1 });
    const legacy = {
      '42': { title: 'Old lamp', href: '/lots/2026-10-01/42', ts: 1_790_000_000_000 },
    };
    const expected = {
      '42': { title: 'Old lamp', ts: 1_790_000_000_000 },
    };
    try {
      await raw.unsafe(`CREATE SCHEMA "${schema}"`);
      await raw.unsafe(`SET search_path TO "${schema}"`);
      await raw.unsafe('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      await raw.unsafe(
        'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL)',
      );
      await raw.unsafe("INSERT INTO meta (key, value) VALUES ('settingsRev', '12')");
      await raw.unsafe('INSERT INTO settings (key, value, rev) VALUES ($1, $2, $3)', [
        KEYS.hidden,
        JSON.stringify(legacy),
        9,
      ]);
    } finally {
      await raw.close();
    }

    const store = await db.openStore(schema);
    expect(await store.hiddenLots()).toEqual(expected);
    expect(await store.setting(KEYS.hidden)).toEqual(expected);
    expect(await store.settings(8)).toEqual({ rev: 12, values: { hiddenLots: expected } });
    expect(await store.settings(9)).toEqual({ rev: 12, values: {} });
    expect(
      await store.sql.unsafe('SELECT 1 FROM settings WHERE key = $1', [KEYS.hidden]),
    ).toHaveLength(0);

    // Reopening is idempotent and keeps migrated rows.
    const reopened = await db.openStore(schema);
    expect(await reopened.hiddenLots()).toEqual(expected);
  });

  test('catalog meta merges patches and survives odd saved values', async () => {
    const store = await db.openStore();
    expect(await store.meta()).toEqual({
      fetchedAt: null,
      pullStartedAt: null,
      count: 0,
      authed: false,
    });
    await store.setMeta('catalog', { fetchedAt: 'x', count: 3.7, authed: 1 });
    expect(await store.meta()).toEqual({
      fetchedAt: null,
      pullStartedAt: null,
      count: 3,
      authed: false,
    });
    expect((await store.writeMeta({ pullStartedAt: 5 })).pullStartedAt).toBe(5);
  });
});
