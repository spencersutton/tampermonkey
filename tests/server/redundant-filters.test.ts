import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyzeFilters, formatReport, loadFromDb } from '../../scripts/redundant-filters';
import { Store } from '../../src/server/store';
import { KEYS } from '../../src/shared/keys';
import { rawLot } from '../raw-lot.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tlx-redundant-filters-'));
afterAll(() => rmSync(dir, { recursive: true }));

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
  test('reads filterWords and open lot titles only', () => {
    const dbPath = join(dir, 'test.db');
    const store = new Store(dbPath);
    store.putSetting(KEYS.words, ['phone', 'case']);
    store.replaceAll([
      rawLot({ id: 1, title: 'Phone Case' }),
      rawLot({ id: 2, title: 'Laptop Stand' }),
    ]);
    // Replace with only lot 2 so lot 1 moves into closed_lots.
    store.replaceAll([rawLot({ id: 2, title: 'Laptop Stand' })]);
    store.close();

    const loaded = loadFromDb(dbPath);
    expect(loaded.patterns).toEqual(['phone', 'case']);
    expect(loaded.titles).toEqual(['Laptop Stand']);
  });
});
