// Catalog pulls and their load rules (src/server/catalog.ts), with the
// first-seen tests from the Python server's test_catalog.py, and the item type
// labeller's parsing and requests (src/server/itemtypes.ts).
import { describe, expect, test } from 'bun:test';

import { Catalog, type CatalogStore } from '../../src/server/catalog';
import { History } from '../../src/server/history';
import { cleanType, Labeller, parseReply } from '../../src/server/itemtypes';
import { ApiError, type LotPage, SiteApi } from '../../src/server/site';
import { type Lot, Store } from '../../src/server/store';
import { fixture } from './harness';

const NOW = 1_800_000_000_000;
const session = (token: string | null = null) => ({
  token: () => Promise.resolve(token),
  rejected: () => Promise.resolve(null),
});
const noHistory = { annotate: () => {}, wake: () => {} };

describe('first seen', () => {
  async function pull(previous: Map<number, Partial<Lot> & { id: number }>, lots: Lot[]) {
    let stored: Lot[] = [];
    const store = {
      meta: () => ({ fetchedAt: null, pullStartedAt: null, count: 0, authed: false }),
      writeMeta: () => ({ fetchedAt: null, pullStartedAt: null, count: 0, authed: false }),
      setting: () => undefined,
      allLots: () => previous as Map<number, Lot>,
      annotateItems: () => {},
      replaceAll: (pulled: Iterable<Lot>) => {
        stored = [...pulled];
        return 1;
      },
    } satisfies CatalogStore;
    const site = {
      fetchLotPage: () => Promise.resolve({ count: lots.length, results: lots } as LotPage),
    };
    await new Catalog(store, session(), noHistory, site, 0, () => 12345).pull();
    return new Map(stored.map(lot => [lot.id, lot]));
  }

  test('the first pull marks no lot as new', async () => {
    const pulled = await pull(new Map(), [{ id: 1, title: 'Drill' }]);
    expect(pulled.get(1)?.firstSeenAt).toBe(0);
  });

  test('later pulls keep existing times, mark new lots, and keep account fields when logged out', async () => {
    const previous = new Map<number, Partial<Lot> & { id: number }>([
      [1, { id: 1, firstSeenAt: 99, has_bid: true }],
      [2, { id: 2 }],
      [3, { id: 3, firstSeenAt: 0 }],
    ]);
    const pulled = await pull(
      previous,
      [1, 2, 3, 4, 5].map(id => ({ id, title: `Lot ${id}`, has_bid: false })),
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
    const store = new Store(':memory:');
    const lots = Array.from({ length: 150 }, (_, i) => ({ ...raw[i % raw.length], id: 1000 + i }));
    const { site, requests } = siteServing({ 1: lots.slice(0, 100), 2: lots.slice(100) }, 150);
    let woken = 0;
    const history = new History(store, site, () => Promise.resolve());
    history.wake = () => void woken++;
    const catalog = new Catalog(store, session(), history, site, 0, () => NOW);
    let after = 0;
    catalog.afterPull = () => void after++;
    await catalog.pull();
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
    expect(store.allLots().size).toBe(150);
    expect(store.meta()).toEqual({ fetchedAt: NOW, pullStartedAt: NOW, count: 150, authed: false });
    expect([woken, after, catalog.progress, catalog.error]).toEqual([1, 1, null, null]);
    const lot = store.lot(1000)!;
    expect(lot.title).toBe(raw[0]!['title'] as string);
    expect(lot.ends_at).toBe(raw[0]!['ends_at'] as string);
  });

  test('a rejected token is refreshed and the pull starts over; a failure is reported, not thrown', async () => {
    const store = new Store(':memory:');
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
      0,
      () => NOW,
    );
    await catalog.pull();
    expect(rejected).toEqual(['old']);
    expect(requests.length).toBe(2);
    expect(store.meta().authed).toBe(true);

    const failing = new Catalog(
      store,
      session(),
      noHistory,
      siteServing({}, 0, () => Response.json({}, { status: 503 })).site,
      0,
      () => NOW,
    );
    await failing.pull();
    expect(failing.error).toStartWith('Catalog refresh failed: 503');
    expect(store.allLots().size).toBe(raw.length); // the last good pull stays
  });

  test('lots skipped by pages shifting mid-pull are kept while still open', async () => {
    const store = new Store(':memory:');
    store.replaceAll([
      { id: 1, title: 'Open', ends_at: new Date(NOW + 60_000).toISOString() },
      { id: 2, title: 'Ended', ends_at: new Date(NOW - 1).toISOString() },
    ]);
    const { site } = siteServing({ 1: [{ ...raw[0], id: 3 }] }, 3);
    await new Catalog(store, session(), noHistory, site, 0, () => NOW).pull();
    expect([...store.allLots().keys()].toSorted()).toEqual([1, 3]);
  });

  test('ApiError is what the site client throws for HTTP failures', async () => {
    const site = new SiteApi((() =>
      Promise.resolve(new Response('no', { status: 502 }))) as unknown as typeof fetch);
    expect(site.fetchLotPage(1, null)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('load rules', () => {
  function catalogAt(now: { t: number }, background = 0) {
    const store = new Store(':memory:');
    const catalog = new Catalog(
      store,
      session(),
      noHistory,
      new SiteApi(),
      background,
      () => now.t,
    );
    return { store, catalog };
  }

  test('pulls are at most once per interval from the last start, never under a minute', () => {
    const now = { t: NOW };
    const { store, catalog } = catalogAt(now);
    expect(catalog.due()).toBe(true);
    store.writeMeta({ pullStartedAt: NOW });
    expect(catalog.nextPullAt()).toBe(NOW + 5 * 60_000);
    store.putSetting('tlxSyncMinutes', 2);
    expect(catalog.nextPullAt()).toBe(NOW + 2 * 60_000);
    store.putSetting('tlxSyncMinutes', 0);
    expect(catalog.nextPullAt()).toBe(NOW + 60_000);
    store.putSetting('tlxSyncMinutes', 'x');
    expect(catalog.nextPullAt()).toBe(NOW + 5 * 60_000);
    expect(catalog.requestPull()).toBe('not-due');
    now.t += 5 * 60_000;
    expect(catalog.requestPull()).toBe('started');
    catalog.progress = { done: 1, total: 2 };
    expect(catalog.requestPull()).toBe('busy');
  });

  test('pulls happen only while a tab is in use, unless background pulls are on', async () => {
    const now = { t: NOW };
    for (const [background, active, expected] of [
      [0, false, 0],
      [0, true, 1],
      [10, false, 1],
    ] as const) {
      const { catalog } = catalogAt(now, background);
      let pulls = 0;
      catalog.pull = () => (pulls++, Promise.resolve());
      void catalog.runForever();
      catalog.heartbeat(active);
      catalog.requestPull = catalog.requestPull.bind(catalog);
      // Run the loop's first check without waiting 15 seconds.
      (catalog as unknown as { waker: { wake(): void } }).waker.wake();
      await Bun.sleep(5);
      expect([background, active, pulls]).toEqual([background, active, expected]);
    }
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
    const store = new Store(':memory:');
    store.replaceAll([
      { id: 1, title: 'Zeta Saw', category: { value: 'tools', label: 'Tools' } },
      { id: 2, title: 'alpha drill', category: { value: 'tools', label: 'Tools' } },
      { id: 3, title: 'Rug', category: null },
    ]);
    store.saveItemTypes({ Old: ['saw', 'tools'] });
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
    expect([1, 2, 3].map(id => store.lot(id)?.itemType)).toEqual([
      'saw',
      'drill driver',
      'area rug',
    ]);
  });

  test('a failed request stops the run and leaves the rest untyped', async () => {
    const store = new Store(':memory:');
    store.replaceAll([{ id: 1, title: 'Saw' }]);
    const llm = (() =>
      Promise.resolve(new Response('busy', { status: 429 }))) as unknown as typeof fetch;
    await new Labeller(store, 'key', undefined, undefined, llm).labelAll();
    expect(store.untypedItems().length).toBe(1);
  });
});
