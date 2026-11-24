// The store (src/server/store.ts), ported from the Python server's
// test_brands.py, test_metadata.py, test_itemtypes.py and test_tags.py.
import { Database } from 'bun:sqlite';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Lot, Store } from '../../src/server/store';
import { KEYS } from '../../src/shared/keys';
import { rawDetail, rawLot } from '../raw-lot.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tlx-store-'));
afterAll(() => rmSync(dir, { recursive: true }));
let n = 0;
const dbPath = () => join(dir, `${++n}.db`);
const byId = (lots: Lot[]) => new Map(lots.map(lot => [lot.id, lot]));

describe('brands and models from lot details', () => {
  let path: string;
  let store: Store;
  const lots = [1, 2, 3].map(i => rawLot({ id: i, title: `Item ${i}` }));
  beforeEach(() => {
    path = dbPath();
    store = new Store(path);
    store.replaceAll(lots);
  });

  test('the catalog tells uncached details from known missing brands', () => {
    const before = store.seq();
    store.saveLotDetail({ id: 1, brand: '  Acme  ', model: '  D-1  ' });
    store.saveLotDetail({ id: 2, brand: null, model: '   ' });
    const catalog = byId(store.changes(0).lots);
    expect(catalog.get(1)).toMatchObject({ brand: 'Acme', model: 'D-1' });
    expect(catalog.get(2)).toMatchObject({ brand: null, model: null });
    expect(catalog.get(3)).not.toHaveProperty('brand');
    expect(catalog.get(3)).not.toHaveProperty('model');
    expect(new Set(store.changes(before).lots.map(l => l.id))).toEqual(new Set([1, 2]));
  });

  test('details survive reopening the database and catalog refreshes', () => {
    store.saveLotDetail({ id: 1, brand: 'Acme', model: 'D-1' });
    store.saveLotDetail({ id: 2, brand: null });
    const reopened = new Store(path);
    const before = reopened.seq();
    reopened.replaceAll(structuredClone(lots));
    expect(reopened.seq()).toBe(before); // joined brands must not cause spurious catalog changes
    expect(reopened.changes(before).lots).toEqual([]);
    const catalog = byId(reopened.changes(0).lots);
    expect(catalog.get(1)).toMatchObject({ brand: 'Acme', model: 'D-1' });
    expect(catalog.get(2)?.brand).toBeNull();
    reopened.replaceAll(lots.map(lot => ({ ...lot, current_price: 25 })));
    expect(reopened.changes(before).lots[0]).toMatchObject({ brand: 'Acme', model: 'D-1' });
  });

  test('only brand changes publish catalog deltas', () => {
    store.saveLotDetail({ id: 1, brand: 'Acme' });
    let before = store.seq();
    store.saveLotDetail({ id: 1, brand: 'Acme', description: 'Updated' });
    expect(store.seq()).toBe(before);
    store.saveLotDetail({ id: 1, brand: 'Other' });
    expect(store.changes(before).lots.map(l => [l.id, l.brand])).toEqual([[1, 'Other']]);
    before = store.seq();
    store.saveLotDetail({ id: 1, brand: '' });
    expect(store.changes(before).lots.map(l => [l.id, l.brand])).toEqual([[1, null]]);
  });

  test('cached details are there when a lot enters the catalog', () => {
    const before = store.seq();
    store.saveLotDetail({ id: 4, brand: 'Already cached' });
    expect(store.seq()).toBe(before); // closed or unknown lots must not bump the catalog sequence
    store.replaceAll([...lots, rawLot({ id: 4 })]);
    expect(byId(store.changes(0).lots).get(4)?.brand).toBe('Already cached');
  });

  test('model-only changes and removals publish deltas', () => {
    store.saveLotDetail({ id: 1, brand: null, model: 'D-1' });
    let before = store.seq();
    store.saveLotDetail({ id: 1, brand: null, model: ' D-1 ', description: 'Updated' });
    expect(store.seq()).toBe(before);
    store.saveLotDetail({ id: 1, brand: null, model: 'D-2' });
    expect(store.changes(before).lots.map(l => [l.id, l.model])).toEqual([[1, 'D-2']]);
    before = store.seq();
    store.saveLotDetail({ id: 1, brand: null, model: null });
    expect(store.changes(before).lots.map(l => [l.id, l.model])).toEqual([[1, null]]);
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

  test('metadata survives restart and lot removal, without auction or account fields', () => {
    const path = dbPath();
    const store = new Store(path);
    store.replaceAll([raw]);
    store.saveLotDetail(raw);
    store.replaceAll([]);
    const reopened = new Store(path);
    expect(reopened.lotMetadata(1, 'test')).toEqual(expected);
    expect(reopened.lotMetadata(1, 'different-period')).toBeNull();
    expect(reopened.lotMetadata(2, 'test')).toBeNull();
    reopened.saveLotDetail({ ...raw, description: 'Corrected', images: [] });
    expect(reopened.lotMetadata(1, 'test')).toEqual({
      ...expected,
      description: 'Corrected',
      images: [],
    });
  });
});

const item = (id: number, title = 'Drill', fields: Partial<Lot> = {}): Lot => ({
  id,
  title,
  category: { value: 'tools', label: 'Tools' },
  version: 1,
  ...fields,
});

describe('item types', () => {
  let path: string;
  let store: Store;
  const tools = { value: 'tools' };
  const label = (
    title: string,
    type: string,
  ): [{ title: string; category: { value: string } }, string] => [{ title, category: tools }, type];
  beforeEach(() => {
    path = dbPath();
    store = new Store(path);
    store.replaceAll([item(1), item(2), item(3, 'Saw')]);
  });

  test('a manual correction touches every exact title match and leaves other lots alone', () => {
    store.saveLotTypes([label('Drill', 'battery'), label('Saw', 'saw')]);
    const before = store.seq();
    store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    const changes = store.changes(before);
    expect(new Set(changes.lots.map(l => l.id))).toEqual(new Set([1, 2]));
    expect(changes.lots.every(l => l.itemType === 'drill driver')).toBe(true);
    expect([store.lot(1)?.itemType, store.lot(3)?.itemType]).toEqual(['drill driver', 'saw']);
  });

  test('corrections survive reopening, catalog refreshes and future relistings', () => {
    store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    const reopened = new Store(path);
    reopened.replaceAll([item(1, 'Drill', { current_price: 20 }), item(4)]);
    expect(
      new Set(
        reopened
          .allLots()
          .values()
          .toArray()
          .map(l => l.itemType),
      ),
    ).toEqual(new Set(['drill driver']));
    expect(reopened.untypedItems()).toEqual([]);
  });

  test('automatic writes never replace corrections or bump their sequence', () => {
    store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    const before = store.seq();
    store.saveLotTypes([label('Drill', 'battery')]);
    expect(store.seq()).toBe(before);
    expect(store.lot(1)?.itemType).toBe('drill driver');
    store.saveLotTypes([label('Drill', 'battery'), label('Saw', 'saw')]);
    expect(store.changes(before).lots.map(l => l.id)).toEqual([3]);
  });

  test('the same type can be marked manual, then corrected, without an unneeded delta', () => {
    store.saveLotTypes([label('Drill', 'drill driver')]);
    const before = store.seq();
    store.saveLotTypes([label('Drill', 'drill driver')], { manual: true });
    expect(store.seq()).toBe(before);
    store.saveLotTypes([label('Drill', 'battery')]);
    expect(store.seq()).toBe(before);
    store.saveLotTypes([label('Drill', 'hammer drill')], { manual: true });
    expect(store.lot(1)?.itemType).toBe('hammer drill');
  });

  test('common types are counted per site category', () => {
    store.saveLotTypes([
      label('Drill', 'drill driver'),
      label('Saw', 'saw'),
      label('Other', 'saw'),
    ]);
    expect(store.commonTypes('tools', 5)).toEqual(['saw', 'drill driver']);
    expect(store.commonTypes(null, 5)).toEqual([]);
  });
});

describe('settings and sessions', () => {
  test('settings keep a revision; clients newer than the database get everything', () => {
    const store = new Store(':memory:');
    expect(store.putSetting('a', 1)).toBe(1);
    expect(store.putSetting('b', { x: [1] })).toBe(2);
    expect(store.settings(1)).toEqual({ rev: 2, values: { b: { x: [1] } } });
    expect(store.settings(99)).toEqual({ rev: 2, values: { a: 1, b: { x: [1] } } });
    expect(store.setting('a')).toBe(1);
    expect(store.setting('missing')).toBeUndefined();
  });

  test('filterTypes is stored in its own filter_types table with revision tracking', () => {
    const store = new Store(':memory:');
    expect(store.setting(KEYS.filterTypes)).toBeUndefined();
    expect(store.settings()).toEqual({ rev: 0, values: {} });
    expect(store.filterTypes()).toEqual([]);

    expect(store.putSetting(KEYS.filterTypes, [' Saw ', 'drill', 'DRILL', ''])).toBe(1);
    expect(store.filterTypes()).toEqual(['drill', 'saw']);
    expect(store.setting(KEYS.filterTypes)).toEqual(['drill', 'saw']);
    expect(store.settings(0)).toEqual({ rev: 1, values: { filterTypes: ['drill', 'saw'] } });
    expect(store.settings(1)).toEqual({ rev: 1, values: {} });
    expect(store.settings(99)).toEqual({ rev: 1, values: { filterTypes: ['drill', 'saw'] } });
    // Must live in filter_types, not in the settings blob table.
    expect(store.db.query('SELECT 1 FROM settings WHERE key = ?').get(KEYS.filterTypes)).toBeNull();
    expect(
      store.db.query<{ type: string }, []>('SELECT type FROM filter_types ORDER BY type').all(),
    ).toEqual([{ type: 'drill' }, { type: 'saw' }]);

    expect(store.putSetting(KEYS.filterTypes, [])).toBe(2);
    expect(store.setting(KEYS.filterTypes)).toEqual([]);
    expect(store.settings(1)).toEqual({ rev: 2, values: { filterTypes: [] } });
  });

  test('existing settings.filterTypes rows migrate into filter_types on open', () => {
    const path = dbPath();
    const raw = new Database(path, { create: true });
    raw.run('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    raw.run(
      'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, rev INTEGER NOT NULL)',
    );
    raw.run("INSERT INTO meta (key, value) VALUES ('settingsRev', '10')");
    raw
      .query('INSERT INTO settings (key, value, rev) VALUES (?, ?, ?)')
      .run(KEYS.filterTypes, JSON.stringify(['phone case', 'Drill', 'drill']), 8);
    raw.close();

    const store = new Store(path);
    expect(store.filterTypes()).toEqual(['drill', 'phone case']);
    expect(store.setting(KEYS.filterTypes)).toEqual(['drill', 'phone case']);
    expect(store.settings(7)).toEqual({
      rev: 10,
      values: { filterTypes: ['drill', 'phone case'] },
    });
    expect(store.settings(8)).toEqual({ rev: 10, values: {} });
    expect(store.db.query('SELECT 1 FROM settings WHERE key = ?').get(KEYS.filterTypes)).toBeNull();
    store.close();

    // Reopening is idempotent and keeps migrated rows.
    const reopened = new Store(path);
    expect(reopened.filterTypes()).toEqual(['drill', 'phone case']);
    reopened.close();
  });

  test('catalog meta merges patches and survives odd saved values', () => {
    const store = new Store(':memory:');
    expect(store.meta()).toEqual({ fetchedAt: null, pullStartedAt: null, count: 0, authed: false });
    store.setMeta('catalog', { fetchedAt: 'x', count: 3.7, authed: 1 });
    expect(store.meta()).toEqual({ fetchedAt: null, pullStartedAt: null, count: 3, authed: false });
    expect(store.writeMeta({ pullStartedAt: 5 }).pullStartedAt).toBe(5);
  });
});
