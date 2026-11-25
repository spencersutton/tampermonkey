import { describe, expect, test } from 'bun:test';

import { Catalog, type CatalogStore } from '../../src/server/catalog';
import { History } from '../../src/server/history';
import { Labeller, parseReply } from '../../src/server/itemtypes';
import { ApiError, type LotPage, SiteApi } from '../../src/server/site';
import { cleanType } from '../../src/shared/itemtype';
// Catalog pulls and their load rules (src/server/catalog.ts), with the
// first-seen tests from the Python server's test_catalog.py, and the item type
// labeller's parsing and requests (src/server/itemtypes.ts).
import { rawLot } from '../raw-lot.mjs';
import { fixture } from './harness';
import { testDb } from './pg';

const db = testDb();
const NOW = 1_800_000_000_000;
const session = (token: string | null = null) => ({
  token: () => Promise.resolve(token),
  rejected: () => Promise.resolve(null),
});
const noHistory = { annotate: () => Promise.resolve(), wake: () => {} };

describe('first seen', () => {
  async function pull(previous: Map<number, Lot>, lots: Lot[]) {
    let stored: Lot[] = [];
    const store = {
      meta: () =>
        Promise.resolve({ fetchedAt: null, pullStartedAt: null, count: 0, authed: false }),
      writeMeta: () =>
        Promise.resolve({ fetchedAt: null, pullStartedAt: null, count: 0, authed: false }),
      setting: () => Promise.resolve(undefined),
      allLots: () => Promise.resolve(previous),
      annotateItems: () => Promise.resolve(),
      replaceAll: (pulled: Iterable<Lot>) => {
        stored = [...pulled];
        return Promise.resolve(1);
      },
    } satisfies CatalogStore;
    const site = {
      fetchLotPage: () => Promise.resolve({ count: lots.length, results: lots } as LotPage),
    };
    await new Catalog(store, session(), noHistory, site, () => 12345).pull();
    return new Map(stored.map(lot => [lot.id, lot]));
  }

  test('the first pull marks no lot as new', async () => {
    const pulled = await pull(new Map(), [rawLot({ id: 1, title: 'Drill' })]);
    expect(pulled.get(1)?.firstSeenAt).toBe(0);
  });

  test('later pulls keep existing times, mark new lots, and keep account fields when logged out', async () => {
    const previous = new Map<number, Lot>([
      [1, { ...rawLot({ id: 1, has_bid: true }), firstSeenAt: 99 }],
      [2, rawLot({ id: 2 })],
      [3, { ...rawLot({ id: 3 }), firstSeenAt: 0 }],
    ]);
    const pulled = await pull(
      previous,
      [1, 2, 3, 4, 5].map(id => rawLot({ id, title: `Lot ${id}`, has_bid: false })),
    );
    expect([1, 2, 3, 4, 5].map(id => pulled.get(id)?.firstSeenAt)).toEqual([
      99, 0, 0, 12345, 12345,
    ]);
    expect(pulled.get(1)?.has_bid).toBe(true);
  });
});

describe('a pull', () => {
  const page = fixture('lots-newly-listed.json');
  const raw = (page.body as { results: Record<string, unknown>[] }).results;

  function siteServing(
    pages: Record<number, unknown[]>,
    count: number,
    onRequest?: (url: URL, init?: RequestInit) => Response | null,
  ) {
    const requests: URL[] = [];
    const site = new SiteApi((async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      const custom = onRequest?.(url, init);
      if (custom) {
        return custom;
      }
      return Response.json({ count, results: pages[Number(url.searchParams.get('page'))] ?? [] });
    }) as typeof fetch);
    return { site, requests };
  }

  test('walks every page one at a time, stores the lots and the pull, and wakes the history', async () => {
    const store = await db.openStore();
    const lots = Array.from({ length: 150 }, (_, i) => ({ ...raw[i % raw.length], id: 1000 + i }));
    const { site, requests } = siteServing({ 1: lots.slice(0, 100), 2: lots.slice(100) }, 150);
    let woken = 0;
    const history = new History(store, site, () => Promise.resolve());
    history.wake = () => void woken++;
    const catalog = new Catalog(store, session(), history, site, () => NOW);
    const seenPages: number[][] = [];
    let after = 0;
    let storedBeforeReplace = 0;
    catalog.onLotsSeen = pageLots => {
      // Fired as each page arrives, before replaceAll() stores the pull.
      seenPages.push(pageLots.map(l => l.id));
    };
    catalog.afterPull = () => void after++;
    storedBeforeReplace = (await store.allLots()).size;
    await catalog.pull();
    expect(storedBeforeReplace).toBe(0);
    expect(seenPages.map(p => p.length)).toEqual([100, 50]);
    expect(
      requests.map(u => [
        u.searchParams.get('page'),
        u.searchParams.get('per_page'),
        u.searchParams.get('order_by'),
      ]),
    ).toEqual([
      ['1', '100', 'newly-listed'],
      ['2', '100', 'newly-listed'],
    ]);
    expect((await store.allLots()).size).toBe(150);
    expect(await store.meta()).toEqual({
      fetchedAt: NOW,
      pullStartedAt: NOW,
      count: 150,
      authed: false,
    });
    expect([woken, after, catalog.progress, catalog.error]).toEqual([1, 1, null, null]);
    const lot = (await store.lot(1000))!;
    expect(lot.title).toBe(raw[0]!['title'] as string);
    expect(lot.ends_at).toBe(raw[0]!['ends_at'] as string);
  });

  test('a rejected token is refreshed and the pull starts over; a failure is reported, not thrown', async () => {
    const store = await db.openStore();
    let first = true;
    const { site, requests } = siteServing({ 1: raw }, raw.length, (_url, init) => {
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth === 'Bearer old' && first) {
        first = false;
        return Response.json({}, { status: 401 });
      }
      return null;
    });
    const rejected: string[] = [];
    const catalog = new Catalog(
      store,
      {
        token: () => Promise.resolve('old'),
        rejected: t => (rejected.push(t), Promise.resolve('new')),
      },
      noHistory,
      site,
      () => NOW,
    );
    await catalog.pull();
    expect(rejected).toEqual(['old']);
    expect(requests.length).toBe(2);
    expect((await store.meta()).authed).toBe(true);

    const failing = new Catalog(
      store,
      session(),
      noHistory,
      siteServing({}, 0, () => Response.json({}, { status: 503 })).site,
      () => NOW,
    );
    await failing.pull();
    expect(failing.error).toStartWith('Catalog refresh failed: 503');
    expect((await store.allLots()).size).toBe(raw.length); // the last good pull stays
  });

  test('lots skipped by pages shifting mid-pull are kept while still open', async () => {
    const store = await db.openStore();
    await store.replaceAll([
      rawLot({ id: 1, title: 'Open', ends_at: new Date(NOW + 60_000).toISOString() }),
      rawLot({ id: 2, title: 'Ended', ends_at: new Date(NOW - 1).toISOString() }),
    ]);
    const { site } = siteServing({ 1: [{ ...raw[0], id: 3 }] }, 3);
    await new Catalog(store, session(), noHistory, site, () => NOW).pull();
    expect([...(await store.allLots()).keys()].toSorted()).toEqual([1, 3]);
  });

  test('ApiError is what the site client throws for HTTP failures', async () => {
    const site = new SiteApi((() =>
      Promise.resolve(new Response('no', { status: 502 }))) as unknown as typeof fetch);
    expect(site.fetchLotPage(1, null)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('load rules', () => {
  async function catalogAt(now: { t: number }) {
    const store = await db.openStore();
    const catalog = new Catalog(store, session(), noHistory, new SiteApi(), () => now.t);
    return { store, catalog };
  }

  test('pulls are at most once per interval from the last start, never under a minute', async () => {
    const now = { t: NOW };
    const { store, catalog } = await catalogAt(now);
    expect(await catalog.due()).toBe(true);
    await store.writeMeta({ pullStartedAt: NOW });
    expect(await catalog.nextPullAt()).toBe(NOW + 5 * 60_000);
    await store.putSetting('tlxSyncMinutes', 2);
    expect(await catalog.nextPullAt()).toBe(NOW + 2 * 60_000);
    await store.putSetting('tlxSyncMinutes', 0);
    expect(await catalog.nextPullAt()).toBe(NOW + 60_000);
    await store.putSetting('tlxSyncMinutes', 'x');
    expect(await catalog.nextPullAt()).toBe(NOW + 5 * 60_000);
    expect(await catalog.requestPull()).toBe('not-due');
    now.t += 5 * 60_000;
    expect(await catalog.requestPull()).toBe('started');
    catalog.progress = { done: 1, total: 2 };
    expect(await catalog.requestPull()).toBe('busy');
  });

  test('pulls happen on their own once due', async () => {
    const now = { t: NOW };
    const { catalog } = await catalogAt(now);
    let pulls = 0;
    catalog.pull = () => (pulls++, Promise.resolve());
    void catalog.runForever();
    // Run the loop's first check without waiting 15 seconds.
    (catalog as unknown as { waker: { wake(): void } }).waker.wake();
    await Bun.sleep(20);
    expect(pulls).toBe(1);
  });
});

describe('item type labeller', () => {
  test('replies are parsed into tidy types, ignoring other lines and numbers out of range', () => {
    expect(
      parseReply(
        '1: Area Rug\n2. "Drill Driver."\n3) mini   fridge\nnote: none\n9: extra\n4 - ',
        4,
      ),
    ).toEqual(
      new Map([
        [1, 'area rug'],
        [2, 'drill driver'],
        [3, 'mini fridge'],
      ]),
    );
    expect(cleanType(' `*Ceiling  Fan*`  ')).toBe('ceiling fan');
    expect(cleanType('Ceiling Fan.;')).toBe('ceiling fan');
    expect(cleanType('x'.repeat(80)).length).toBe(60);
  });

  test('labels batch titles by category with the types already in use, and save them', async () => {
    const store = await db.openStore();
    await store.replaceAll([
      rawLot({ id: 1, title: 'Zeta Saw' }),
      rawLot({ id: 2, title: 'alpha drill' }),
      rawLot({ id: 3, title: 'Rug', category: { value: 'misc', label: '' } }),
    ]);
    await store.saveLotTypes([[{ title: 'Old', category: { value: 'tools' } }, 'saw']]);
    const bodies: { messages: { content: string }[]; model: string }[] = [];
    const llm = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      const reply = body.messages[1].content.includes('Rug')
        ? '1: area rug'
        : '1: drill driver\n2: saw';
      return Response.json({ choices: [{ message: { content: reply } }] });
    }) as typeof fetch;
    await new Labeller(store, 'key', 'https://llm.example/v1/', 'm', llm).labelAll();
    expect(bodies.map(b => b.messages[1]!.content)).toEqual([
      'Site category: Tools\nTypes already in use: saw\n\nTitles:\n1: alpha drill\n2: Zeta Saw',
      'Site category: Other\nTypes already in use: (none yet)\n\nTitles:\n1: Rug',
    ]);
    expect(bodies[0]?.model).toBe('m');
    expect(await Promise.all([1, 2, 3].map(async id => (await store.lot(id))?.itemType))).toEqual([
      'saw',
      'drill driver',
      'area rug',
    ]);
  });

  test('a failed request stops the run and leaves the rest untyped', async () => {
    const store = await db.openStore();
    await store.replaceAll([rawLot({ id: 1, title: 'Saw' })]);
    const llm = (() =>
      Promise.resolve(new Response('busy', { status: 429 }))) as unknown as typeof fetch;
    await new Labeller(store, 'key', undefined, undefined, llm).labelAll();
    expect((await store.untypedItems()).length).toBe(1);
  });
});
