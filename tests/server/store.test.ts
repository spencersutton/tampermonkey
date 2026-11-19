// The store (src/server/store.ts), ported from the Python server's
// test_brands.py, test_metadata.py, test_itemtypes.py and test_tags.py.
import { Database } from 'bun:sqlite';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Lot, Store } from '../../src/server/store';
import { cleanTags } from '../../src/server/tags';
import { normalizeDetail, normalizeLot } from '../../src/shared/lot';
import { cleanTag } from '../../src/shared/tags';
import { rawLot } from '../raw-lot.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tlx-store-'));
afterAll(() => rmSync(dir, { recursive: true }));
let n = 0;
const dbPath = () => join(dir, `${++n}.db`);
const byId = (lots: Lot[]) => new Map(lots.map((lot) => [lot.id, lot]));

describe('brands and models from lot details', () => {
  let path: string;
  let store: Store;
  const lots = [1, 2, 3].map((i) => normalizeLot(rawLot({ id: i, title: `Item ${i}` })) as Lot);
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
    expect(new Set(store.changes(before).lots.map((l) => l.id))).toEqual(new Set([1, 2]));
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
    reopened.replaceAll(lots.map((lot) => ({ ...lot, currentPrice: 25 })));
    expect(reopened.changes(before).lots[0]).toMatchObject({ brand: 'Acme', model: 'D-1' });
  });

  test('only brand changes publish catalog deltas', () => {
    store.saveLotDetail({ id: 1, brand: 'Acme' });
    let before = store.seq();
    store.saveLotDetail({ id: 1, brand: 'Acme', description: 'Updated' });
    expect(store.seq()).toBe(before);
    store.saveLotDetail({ id: 1, brand: 'Other' });
    expect(store.changes(before).lots.map((l) => [l.id, l.brand])).toEqual([[1, 'Other']]);
    before = store.seq();
    store.saveLotDetail({ id: 1, brand: '' });
    expect(store.changes(before).lots.map((l) => [l.id, l.brand])).toEqual([[1, null]]);
  });

  test('cached details are there when a lot enters the catalog', () => {
    const before = store.seq();
    store.saveLotDetail({ id: 4, brand: 'Already cached' });
    expect(store.seq()).toBe(before); // closed or unknown lots must not bump the catalog sequence
    store.replaceAll([...lots, normalizeLot(rawLot({ id: 4 })) as Lot]);
    expect(byId(store.changes(0).lots).get(4)?.brand).toBe('Already cached');
  });

  test('model-only changes and removals publish deltas', () => {
    store.saveLotDetail({ id: 1, brand: null, model: 'D-1' });
    let before = store.seq();
    store.saveLotDetail({ id: 1, brand: null, model: ' D-1 ', description: 'Updated' });
    expect(store.seq()).toBe(before);
    store.saveLotDetail({ id: 1, brand: null, model: 'D-2' });
    expect(store.changes(before).lots.map((l) => [l.id, l.model])).toEqual([[1, 'D-2']]);
    before = store.seq();
    store.saveLotDetail({ id: 1, brand: null, model: null });
    expect(store.changes(before).lots.map((l) => [l.id, l.model])).toEqual([[1, null]]);
  });
});

describe('lot metadata', () => {
  const raw = rawLot({
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
    lotFee: 2,
    images: [{ thumb: 'thumb.jpg', card: 'card.jpg', large: 'large.jpg' }],
  };

  test('metadata survives restart and lot removal, without auction or account fields', () => {
    const path = dbPath();
    const store = new Store(path);
    store.replaceAll([normalizeLot(raw) as Lot]);
    store.saveLotDetail(normalizeDetail(raw));
    store.replaceAll([]);
    const reopened = new Store(path);
    expect(reopened.lotMetadata(1, 'test')).toEqual(expected);
    expect(reopened.lotMetadata(1, 'different-period')).toBeNull();
    expect(reopened.lotMetadata(2, 'test')).toBeNull();
    reopened.saveLotDetail(normalizeDetail({ ...raw, description: 'Corrected', images: [] }));
    expect(reopened.lotMetadata(1, 'test')).toEqual({
      ...expected,
      description: 'Corrected',
      images: [],
    });
  });

  test('older databases migrate without losing descriptions or inventing images', () => {
    const path = dbPath();
    const db = new Database(path);
    db.run(`CREATE TABLE lot_details (
      lot_id INTEGER PRIMARY KEY, auction_period TEXT, title TEXT NOT NULL, status TEXT,
      current_price NUMERIC, description TEXT, brand TEXT, model TEXT, lot_fee NUMERIC,
      bid_history TEXT NOT NULL, fetched_at INTEGER NOT NULL)`);
    db.run('INSERT INTO lot_details VALUES (1, ?, ?, ?, 17, ?, ?, ?, 2, ?, 1)', [
      'test',
      'Drill',
      'open',
      'Legacy description',
      'Acme',
      'D1',
      '[]',
    ]);
    db.run(
      'CREATE TABLE item_types (title TEXT PRIMARY KEY, type TEXT NOT NULL, category TEXT, at REAL NOT NULL)',
    );
    db.run("INSERT INTO item_types VALUES ('Drill', 'battery', 'tools', 0)");
    db.close();
    const migrated = new Store(path);
    expect(migrated.lotMetadata(1, 'test')).toEqual({
      description: 'Legacy description',
      brand: 'Acme',
      model: 'D1',
      lotFee: 2,
    });
    migrated.saveLotDetail(normalizeDetail(raw));
    expect(migrated.lotMetadata(1, 'test')).toEqual(expected);
    expect(migrated.itemTypes(['Drill'])).toEqual({ Drill: 'battery' });
    migrated.saveItemTypes({ Drill: ['drill driver', 'tools'] }, { manual: true });
    migrated.saveItemTypes({ Drill: ['battery', 'tools'] });
    expect(migrated.itemTypes(['Drill'])).toEqual({ Drill: 'drill driver' });
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
  beforeEach(() => {
    path = dbPath();
    store = new Store(path);
    store.replaceAll([item(1), item(2), item(3, 'Saw')]);
  });

  test('a manual correction touches every exact title match and leaves other lots alone', () => {
    store.saveItemTypes({ Drill: ['battery', 'tools'], Saw: ['saw', 'tools'] });
    const before = store.seq();
    store.saveItemTypes({ Drill: ['drill driver', 'tools'] }, { manual: true });
    const changes = store.changes(before);
    expect(new Set(changes.lots.map((l) => l.id))).toEqual(new Set([1, 2]));
    expect(changes.lots.every((l) => l.itemType === 'drill driver')).toBe(true);
    expect(store.itemTypes(['Drill', 'Saw'])).toEqual({ Drill: 'drill driver', Saw: 'saw' });
  });

  test('corrections survive reopening, catalog refreshes and future relistings', () => {
    store.saveItemTypes({ Drill: ['drill driver', 'tools'] }, { manual: true });
    const reopened = new Store(path);
    reopened.replaceAll([item(1, 'Drill', { currentPrice: 20 }), item(4)]);
    expect(new Set([...reopened.allLots().values()].map((l) => l.itemType))).toEqual(
      new Set(['drill driver']),
    );
    expect(reopened.untypedItems()).toEqual([]);
  });

  test('automatic writes never replace corrections or bump their sequence', () => {
    store.saveItemTypes({ Drill: ['drill driver', 'tools'] }, { manual: true });
    const before = store.seq();
    store.saveItemTypes({ Drill: ['battery', 'tools'] });
    expect(store.seq()).toBe(before);
    expect(store.itemTypes(['Drill'])).toEqual({ Drill: 'drill driver' });
    store.saveItemTypes({ Drill: ['battery', 'tools'], Saw: ['saw', 'tools'] });
    expect(store.changes(before).lots.map((l) => l.id)).toEqual([3]);
  });

  test('the same type can be marked manual, then corrected, without an unneeded delta', () => {
    store.saveItemTypes({ Drill: ['drill driver', 'tools'] });
    const before = store.seq();
    store.saveItemTypes({ Drill: ['drill driver', 'tools'] }, { manual: true });
    expect(store.seq()).toBe(before);
    store.saveItemTypes({ Drill: ['battery', 'tools'] });
    expect(store.seq()).toBe(before);
    store.saveItemTypes({ Drill: ['hammer drill', 'tools'] }, { manual: true });
    expect(store.itemTypes(['Drill'])).toEqual({ Drill: 'hammer drill' });
  });

  test('an explicit reset forgets manual and automatic types', () => {
    store.saveItemTypes({ Drill: ['drill driver', 'tools'] }, { manual: true });
    store.saveItemTypes({ Saw: ['saw', 'tools'] });
    const before = store.seq();
    expect(store.resetItemTypes()).toBe(2);
    expect(store.itemTypes(['Drill', 'Saw'])).toEqual({});
    expect(new Set(store.changes(before).lots.map((l) => l.id))).toEqual(new Set([1, 2, 3]));
  });

  test('common types are counted per site category', () => {
    store.saveItemTypes({
      Drill: ['drill driver', 'tools'],
      Saw: ['saw', 'tools'],
      Other: ['saw', 'tools'],
    });
    expect(store.commonTypes('tools', 5)).toEqual(['saw', 'drill driver']);
    expect(store.commonTypes(null, 5)).toEqual([]);
  });
});

describe('tags', () => {
  const knob = (id: number, title = 'Knob', fields: Partial<Lot> = {}): Lot => ({
    id,
    title,
    category: { value: 'home', label: 'Home' },
    version: 1,
    ...fields,
  });

  test('tags are tidied and attributes normalized', () => {
    expect(cleanTag('  Cabinet   Knob ')).toBe('Cabinet Knob');
    expect(cleanTag('Finish:Satin  Nickel')).toBe('Finish: Satin Nickel');
    expect(cleanTag('finish:')).toBe('finish');
    expect(cleanTag(' : ')).toBeNull();
    expect(cleanTags(['Brass', 'brass', '', 'Finish: Brass', 'finish:BRASS'])).toEqual([
      'Brass',
      'Finish: Brass',
    ]);
  });

  describe('on lots', () => {
    let store: Store;
    beforeEach(() => {
      store = new Store(':memory:');
      store.replaceAll([knob(1), knob(2), knob(3, 'Pull')]);
    });

    test('tags follow exact titles and bump the sequence', () => {
      const seq = store.seq();
      const changed = store.saveLotTags([[knob(1), ['Cabinet Knob', 'Finish: Satin Nickel']]]);
      const tags = ['Cabinet Knob', 'Finish: Satin Nickel'];
      expect(changed).toEqual(
        new Map([
          [1, tags],
          [2, tags],
        ]),
      );
      const changes = store.changes(seq);
      expect(changes.lots.map((l) => l.id).toSorted()).toEqual([1, 2]);
      expect(changes.lots[0]?.tags).toEqual(tags);
      expect(store.lot(3)).not.toHaveProperty('tags');
    });

    test('brand and model identify items across titles', () => {
      store.saveLotDetail({ id: 1, title: 'Knob', brand: 'Mila', model: 'K-1', bidHistory: [] });
      store.saveLotDetail({ id: 3, title: 'Pull', brand: 'MILA', model: 'k-1', bidHistory: [] });
      store.saveLotTags([[store.lot(1)!, ['finish: brass']]]);
      expect(store.lot(3)?.tags).toEqual(['finish: brass']);
      // Lot 2 has no brand/model, so it falls back to the exact title, as item types do.
      expect(store.lot(2)?.tags).toEqual(['finish: brass']);
    });

    test('automatic tags never replace manual ones, and reset clears them all', () => {
      store.saveLotTags([[knob(1), ['finish: brass']]], { manual: true });
      store.saveLotTags([[knob(1), ['finish: chrome']]]);
      expect(store.lot(1)?.tags).toEqual(['finish: brass']);
      store.saveLotTags([[knob(1), []]], { manual: true });
      expect(store.lot(1)).not.toHaveProperty('tags');
      store.saveLotTags([[knob(3, 'Pull'), ['x']]]);
      expect(store.resetTags()).toBe(2);
      expect(store.lot(3)).not.toHaveProperty('tags');
    });
  });

  describe('rules', () => {
    let store: Store;
    const tags = (id: number) => store.lot(id)?.tags;
    beforeEach(() => {
      store = new Store(':memory:');
      store.replaceAll([
        knob(1, 'Mila Satin Nickel Oval Cabinet Knob'),
        knob(2, 'Brass Cabinet Pull (Qty 4)'),
        knob(3, 'Cordless Drill'),
      ]);
    });

    test('rules tag matching titles case-insensitively and bump the sequence', () => {
      const seq = store.seq();
      const [rule, changed] = store.addTagRule('\\bcabinet (knob|pull)', ['Cabinet Hardware']);
      expect(rule.tags).toEqual(['Cabinet Hardware']);
      expect([...changed.keys()].toSorted()).toEqual([1, 2]);
      expect(
        store
          .changes(seq)
          .lots.map((l) => l.id)
          .toSorted(),
      ).toEqual([1, 2]);
      expect(tags(3)).toBeUndefined();
    });

    test('rule tags merge with lot tags without repeats', () => {
      store.saveLotTags(
        [
          [
            knob(1, 'Mila Satin Nickel Oval Cabinet Knob'),
            ['cabinet knob', 'finish: satin nickel'],
          ],
        ],
        {
          manual: true,
        },
      );
      store.addTagRule('satin nickel', ['Finish: SATIN Nickel']); // the same tag, ignoring case
      store.addTagRule('knob|pull', ['cabinet hardware']);
      expect(tags(1)).toEqual(['cabinet knob', 'finish: satin nickel', 'cabinet hardware']);
    });

    test('tags in use are counted ignoring case', () => {
      store.saveLotTags([[knob(1, 'Mila Satin Nickel Oval Cabinet Knob'), ['Finish: Brass']]], {
        manual: true,
      });
      store.addTagRule('brass', ['finish: brass']);
      const { tags: inUse } = store.tagOverview();
      expect(inUse.length).toBe(1);
      expect(inUse[0]?.[1]).toBe(2);
    });

    test('rules apply to future lots and go away when removed', () => {
      const [rule] = store.addTagRule('drill', ['power tool']);
      store.replaceAll([knob(3, 'Cordless Drill'), knob(4, 'Hammer Drill Kit')]);
      expect(tags(4)).toEqual(['power tool']);
      expect([...(store.removeTagRule(rule.id)?.keys() ?? [])].toSorted()).toEqual([3, 4]);
      expect(tags(4)).toBeUndefined();
      expect(store.removeTagRule(rule.id)).toBeNull();
    });

    test('reset keeps rules, and bad rules are refused', () => {
      store.addTagRule('brass', ['finish: brass']);
      store.resetTags();
      expect(tags(2)).toEqual(['finish: brass']);
      expect(() => store.addTagRule('(unclosed', ['x'])).toThrow();
      expect(() => store.addTagRule('brass', [' '])).toThrow('no tags given');
      expect(store.tagRules().length).toBe(1);
    });

    test('preview groups titles, with spans in code points and the tags they would add', () => {
      store.replaceAll([
        knob(1, '🔩 Satin Nickel Knob'),
        knob(2, '🔩 Satin Nickel Knob'),
        knob(3, 'Brass Pull'),
      ]);
      store.addTagRule('knob', ['cabinet knob']);
      const preview = store.previewTagRule('(satin) nickel', ['finish: $1', 'Cabinet KNOB'], 10);
      expect(preview).toEqual({
        lots: 2,
        titles: 1,
        matches: [
          {
            title: '🔩 Satin Nickel Knob',
            lotId: 1,
            lots: 2,
            span: [2, 14],
            tags: ['cabinet knob'],
            adds: ['finish: Satin'],
          },
        ],
      });
      expect(() => store.previewTagRule('knob', ['$1'], 10)).toThrow('no groups');
      expect(() => store.previewTagRule('(bad', [], 10)).toThrow('invalid pattern');
    });
  });

  describe('rule groups', () => {
    let store: Store;
    const tags = (id: number) => store.lot(id)?.tags;
    beforeEach(() => {
      store = new Store(':memory:');
      store.replaceAll([
        knob(1, 'Satin Nickel Knob 3 in.'),
        knob(2, 'Matte Black Pull 5 in.'),
        knob(3, 'Knob'),
      ]);
    });

    test('tags fill in numbered and named groups, as written in the title', () => {
      store.addTagRule('(satin nickel|matte black) (?<Kind>knob|pull)', [
        'finish: $1',
        '${kind}',
        '$0',
      ]);
      expect(tags(1)).toEqual(['finish: Satin Nickel', 'Knob', 'Satin Nickel Knob']);
      expect(tags(2)).toEqual(['finish: Matte Black', 'Pull', 'Matte Black Pull']);
      expect(tags(3)).toBeUndefined();
    });

    test("rules saved with Python's named groups still work", () => {
      store.addTagRule('(?P<kind>knob|pull) (?P=kind)?', ['${kind}']);
      expect(tags(1)).toEqual(['Knob']);
    });

    test('groups that capture nothing drop their tag, and dollars can be escaped', () => {
      store.addTagRule('knob(?: (\\d+) in)?', ['size: $1 in', 'knob', '$$1 deal']);
      expect(tags(1)).toEqual(['size: 3 in', 'knob', '$1 deal']);
      expect(tags(3)).toEqual(['knob', '$1 deal']);
    });

    test('references to missing groups are refused', () => {
      expect(() => store.addTagRule('(knob)', ['$2'])).toThrow('only 1 group');
      expect(() => store.addTagRule('knob', ['$1'])).toThrow('no groups');
      expect(() => store.addTagRule('(?<y>knob)', ['${x}'])).toThrow("no group named 'x'");
      expect(store.tagRules()).toEqual([]);
    });
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

  test('catalog meta merges patches and survives odd saved values', () => {
    const store = new Store(':memory:');
    expect(store.meta()).toEqual({ fetchedAt: null, pullStartedAt: null, count: 0, authed: false });
    store.setMeta('catalog', { fetchedAt: 'x', count: 3.7, authed: 1 });
    expect(store.meta()).toEqual({ fetchedAt: null, pullStartedAt: null, count: 3, authed: false });
    expect(store.writeMeta({ pullStartedAt: 5 }).pullStartedAt).toBe(5);
  });
});
