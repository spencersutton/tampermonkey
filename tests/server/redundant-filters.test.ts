import { describe, expect, test } from 'bun:test';

import {
  analyzeFilters,
  analyzeTypeFilters,
  formatReport,
  formatTypeReport,
  loadFromDb,
  loadTypesFromDb,
  pruneRedundantFilters,
  pruneRedundantTypeFilters,
  saveFilterTypesToDb,
  saveToDb,
} from '../../scripts/redundant-filters';
import { buildRegexes, filterMatches } from '../../src/shared/filters';
import { KEYS } from '../../src/shared/keys';
import { rawLot } from '../raw-lot.mjs';
import { testDb } from './pg';

const db = testDb();

describe('analyzeFilters', () => {
  test('detects single-filter subsumption and exact equivalence', () => {
    const titles = [
      'Anker USB-C Cable 6ft',
      'HDMI Cable 10ft',
      'Wireless Mouse',
      'USB-C Cable 3ft',
    ];
    const result = analyzeFilters(['cable', 'usb-c cable', 'usb-c', 'mouse'], titles);

    expect(result.totalLots).toBe(4);
    expect(result.totalFilters).toBe(4);
    expect(result.multiMatchedLots).toBe(2);

    // `usb-c` and `usb-c cable` match the exact same 2 lots and are both subsumed by `cable`.
    expect(result.redundant.map(r => r.pattern)).toEqual(['usb-c', 'usb-c cable']);
    const usbc = result.redundant[0]!;
    expect(usbc.total).toBe(2);
    expect(usbc.subsumedBy).toEqual([
      { pattern: 'cable', total: 3, equivalent: false },
      { pattern: 'usb-c cable', total: 2, equivalent: true },
    ]);

    // `cable` still has 1 unique match (HDMI Cable 10ft) and 2 shared matches.
    expect(result.overlapping).toEqual([
      {
        pattern: 'cable',
        total: 3,
        unique: 1,
        shared: 2,
        overlaps: [
          { other: 'usb-c', shared: 2, equivalent: false },
          { other: 'usb-c cable', shared: 2, equivalent: false },
        ],
      },
    ]);
  });

  test('detects filters covered only by a combination of other filters', () => {
    const titles = ['Red Phone Case', 'Blue Phone Charger', 'Red Mug', 'Blue Pen'];
    const result = analyzeFilters(['phone', 'red', 'blue'], titles);

    expect(result.redundant).toHaveLength(1);
    const phone = result.redundant[0]!;
    expect(phone.pattern).toBe('phone');
    expect(phone.total).toBe(2);
    expect(phone.subsumedBy).toEqual([]);
    expect(phone.overlaps).toEqual([
      { other: 'blue', shared: 1, equivalent: false },
      { other: 'red', shared: 1, equivalent: false },
    ]);

    const report = formatReport(result, 10);
    expect(report).toContain('phone (2 matches) — covered by combination of blue (1), red (1)');
  });

  test('groups identical multi-matched titles and reports invalid patterns', () => {
    const titles = ['Phone Case', 'Phone Case', 'Desk Lamp'];
    const result = analyzeFilters(['phone', 'case', '[invalid'], titles);

    expect(result.invalidFilters).toEqual(['[invalid']);
    expect(result.multiMatchedLots).toBe(2);
    expect(result.multiMatchedTitles).toEqual([
      { title: 'Phone Case', lots: 2, filters: ['case', 'phone'] },
    ]);
  });
});

describe('loadFromDb', () => {
  test('reads filterWords and open lot titles only', async () => {
    const schema = db.nextSchema();
    const store = await db.openStore(schema);
    await store.putSetting(KEYS.words, ['phone', 'case']);
    await store.replaceAll([
      rawLot({ id: 1, title: 'Phone Case' }),
      rawLot({ id: 2, title: 'Laptop Stand' }),
    ]);
    // Replace with only lot 2 so lot 1 moves into closed_lots.
    await store.replaceAll([rawLot({ id: 2, title: 'Laptop Stand' })]);

    const loaded = await loadFromDb(db.url, { schema });
    expect(loaded.patterns).toEqual(['phone', 'case']);
    expect(loaded.titles).toEqual(['Laptop Stand']);
  });

  test('saveToDb updates filterWords and bumps settings revision', async () => {
    const schema = db.nextSchema();
    const store = await db.openStore(schema);
    const rev1 = await store.putSetting(KEYS.words, ['cable', 'usb-c cable']);

    const rev2 = await saveToDb(db.url, ['cable'], { schema });
    expect(rev2).toBeGreaterThan(rev1);
    expect((await loadFromDb(db.url, { schema })).patterns).toEqual(['cable']);
  });
});

describe('pruneRedundantFilters', () => {
  const matchedTitles = (patterns: string[], titles: string[]) => {
    const compiled = buildRegexes(patterns);
    return titles.filter(t => compiled.some(f => filterMatches(f, t)));
  };

  test('preserves exact coverage when two filters have identical matches and removes 0-match filters', () => {
    const titles = ['Phone Case', 'Desk Lamp'];
    const patterns = ['phone case', 'phone', 'unmatched', '[invalid'];
    const { kept, removed } = pruneRedundantFilters(patterns, titles);

    // `phone case` and `phone` match the exact same title; removes the longer one, keeps the other,
    // removes 0-match filters, and leaves invalid filters alone.
    expect(removed).toEqual(['phone case', 'unmatched']);
    expect(kept).toEqual(['phone', '[invalid']);
    expect(matchedTitles(kept, titles)).toEqual(matchedTitles(patterns, titles));
    expect(analyzeFilters(kept, titles).redundant).toEqual([]);
  });

  test('removes filters with 0 matches even when no filters overlap', () => {
    const titles = ['Desk Lamp'];
    const patterns = ['lamp', 'zebra', 'apple'];
    const { kept, removed } = pruneRedundantFilters(patterns, titles);

    expect(removed).toEqual(['apple', 'zebra']);
    expect(kept).toEqual(['lamp']);
  });

  test('removes strictly subsumed filters and leaves no remaining redundancy', () => {
    const titles = [
      'Anker USB-C Cable 6ft',
      'HDMI Cable 10ft',
      'Red Phone Case',
      'Blue Phone Charger',
      'Red Mug',
      'Blue Pen',
    ];
    const patterns = ['cable', 'usb-c cable', 'usb-c', 'phone', 'red', 'blue'];
    const { kept, removed } = pruneRedundantFilters(patterns, titles);

    expect(removed).toEqual(['usb-c cable', 'usb-c', 'phone']);
    expect(kept).toEqual(['cable', 'red', 'blue']);
    expect(matchedTitles(kept, titles)).toEqual(matchedTitles(patterns, titles));
    expect(analyzeFilters(kept, titles).redundant).toEqual([]);
  });
});

describe('analyzeTypeFilters', () => {
  test('detects single-regex subsumption, combination coverage, and partial overlap', () => {
    const lots = [
      { title: 'Anker USB-C Cable 6ft', itemType: 'usb cable' },
      { title: 'HDMI Cable 10ft', itemType: 'hdmi cable' },
      { title: 'Red Phone Case', itemType: 'phone accessory' },
      { title: 'Blue Phone Charger', itemType: 'phone accessory' },
      { title: 'DeWalt Cordless Drill', itemType: 'drill' },
      { title: 'Makita Hammer Driver', itemType: 'drill' },
      { title: 'Ceramic Coffee Mug', itemType: 'mug' },
      { title: 'Untyped Mystery Box' },
    ];
    const filterTypes = ['USB Cable', 'phone accessory', 'drill', 'mug', 'zero match'];
    const patterns = ['cable', 'red', 'blue', 'drill', '[invalid'];

    const result = analyzeTypeFilters(filterTypes, patterns, lots);

    expect(result.totalLots).toBe(8);
    expect(result.typedLots).toBe(7);
    expect(result.totalTypeFilters).toBe(5);
    expect(result.totalRegexFilters).toBe(4);
    expect(result.invalidFilters).toEqual(['[invalid']);
    expect(result.coveredLots).toBe(4);

    // `phone accessory` (2) is covered by combination of `red` + `blue`; `USB Cable` (1) is
    // subsumed by `cable` (which matches 2 open lots total). `zero match` and `mug` are omitted.
    expect(result.redundant).toEqual([
      {
        type: 'phone accessory',
        total: 2,
        subsumedBy: [],
        overlaps: [
          { pattern: 'blue', shared: 1 },
          { pattern: 'red', shared: 1 },
        ],
      },
      {
        type: 'USB Cable',
        total: 1,
        subsumedBy: [{ pattern: 'cable', total: 2 }],
        overlaps: [{ pattern: 'cable', shared: 1 }],
      },
    ]);

    // `drill` has 1 covered lot and 1 unique lot ("Makita Hammer Driver").
    expect(result.overlapping).toEqual([
      {
        type: 'drill',
        total: 2,
        unique: 1,
        covered: 1,
        overlaps: [{ pattern: 'drill', shared: 1 }],
      },
    ]);

    const report = formatTypeReport(result, 10);
    expect(report).toContain(
      'phone accessory (2 matches) — covered by combination of blue (1), red (1)',
    );
    expect(report).toContain('USB Cable (1 match) — covered by cable (2)');
    expect(report).toContain('drill (2 total, 1 unique, 1 covered by regex) — drill (1)');
    expect(report).toContain('[USB Cable] "Anker USB-C Cable 6ft"');
  });

  test('groups identical covered titles within the same item type', () => {
    const lots = [
      { title: 'USB Cable', itemType: 'usb cable' },
      { title: 'USB Cable', itemType: 'usb cable' },
    ];
    const result = analyzeTypeFilters(['usb cable'], ['usb', 'cable'], lots);

    expect(result.coveredTitles).toEqual([
      { title: 'USB Cable', itemType: 'usb cable', lots: 2, filters: ['cable', 'usb'] },
    ]);
  });
});

describe('pruneRedundantTypeFilters', () => {
  test('removes only item type filters fully covered by regex filters and keeps 0-match types', () => {
    const lots = [
      { title: 'Anker USB-C Cable', itemType: 'usb cable' },
      { title: 'DeWalt Cordless Drill', itemType: 'drill' },
      { title: 'Makita Hammer Driver', itemType: 'drill' },
      { title: 'Ceramic Mug', itemType: 'mug' },
    ];
    const filterTypes = ['usb cable', 'drill', 'mug', 'pressure washer'];
    const patterns = ['cable', 'drill'];

    const { kept, removed } = pruneRedundantTypeFilters(filterTypes, patterns, lots);
    expect(removed).toEqual(['usb cable']);
    expect(kept).toEqual(['drill', 'mug', 'pressure washer']);
  });
});

describe('loadTypesFromDb and saveFilterTypesToDb', () => {
  test('loads filterWords, filterTypes, and open lots with resolved item types', async () => {
    const schema = db.nextSchema();
    const store = await db.openStore(schema);
    await store.putSetting(KEYS.words, ['cable']);
    await store.putSetting(KEYS.filterTypes, ['usb cable', 'drill']);
    const lot1 = rawLot({ id: 1, title: 'Anker USB-C Cable' });
    const lot2 = rawLot({ id: 2, title: 'DeWalt Tool Kit' });
    await store.replaceAll([lot1, lot2]);
    await store.saveLotDetail({ id: 2, brand: 'DeWalt', model: 'DCD771' });
    await store.saveLotTypes([
      [lot1, 'usb cable'],
      [{ ...lot2, brand: 'DeWalt', model: 'DCD771' }, 'drill'],
    ]);

    const loaded = await loadTypesFromDb(db.url, { schema });
    expect(loaded.patterns).toEqual(['cable']);
    expect(loaded.filterTypes).toEqual(['drill', 'usb cable']);
    expect(loaded.lots.toSorted((a, b) => a.title.localeCompare(b.title))).toEqual([
      { title: 'Anker USB-C Cable', itemType: 'usb cable' },
      { title: 'DeWalt Tool Kit', itemType: 'drill' },
    ]);

    const revBefore = await store.putSetting(KEYS.filterTypes, ['drill', 'usb cable']);
    const revAfter = await saveFilterTypesToDb(db.url, ['drill'], { schema });
    expect(revAfter).toBeGreaterThan(revBefore);
    expect((await loadTypesFromDb(db.url, { schema })).filterTypes).toEqual(['drill']);
  });
});
