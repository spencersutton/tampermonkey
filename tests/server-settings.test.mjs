import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { Component, h, options } from 'preact';
import { createServer } from 'vite';

const servers = [];
after(() => Promise.all(servers.map((server) => server.close())));
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
};

function nodes(node) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}

function renderComponent(type, props = {}) {
  const vnode = h(type, props);
  vnode.__c = new Component(vnode.props);
  vnode.__c.__h = [];
  options.__r(vnode);
  const tree = vnode.type(vnode.props);
  options.diffed(vnode);
  options.unmount?.(vnode);
  return tree;
}

async function savedSearchControls(vite) {
  const { App } = await vite.ssrLoadModule('/src/app/App.tsx');
  const { Sidebar } = await vite.ssrLoadModule('/src/app/Sidebar/index.tsx');
  return () => {
    const appSidebar = nodes(renderComponent(App)).find((node) => node.type?.name === 'AppSidebar');
    const sidebar = nodes(renderComponent(appSidebar.type, appSidebar.props)).find(
      (node) => node.type === Sidebar,
    );
    const section = Sidebar(sidebar.props).props.children[0];
    const buttons = nodes(renderComponent(section.type, section.props)).filter(
      (node) =>
        node.type === 'button' && node.props['aria-label']?.startsWith('Update saved search '),
    );
    return { saved: sidebar.props.saved, buttons };
  };
}

async function setup(t, values = {}) {
  const storage = new Map([
    ['tlx:filterWords', JSON.stringify(['stale-local'])],
    [
      'tlx:tlxSavedSearches',
      JSON.stringify([{ id: 'old', lastViewedAt: '1970-01-01T00:00:00.123Z' }]),
    ],
    ['tlx:tlxCustomCategories', JSON.stringify([{ name: 'Stale', types: ['drill'] }])],
    ['tlx:tlxView', JSON.stringify({ search: 'local view' })],
  ]);
  const reads = [],
    writes = [],
    requests = [],
    callbacks = [];
  globalThis.localStorage = {
    getItem(key) {
      reads.push(key);
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push(key);
      storage.set(key, value);
    },
  };
  globalThis.window = {
    addEventListener() {},
    setInterval: () => 0,
    setTimeout(fn) {
      callbacks.push(fn);
      return 1;
    },
  };
  globalThis.document = { visibilityState: 'visible', addEventListener() {} };
  globalThis.location = { protocol: 'http:', host: 'localhost' };
  const status = {
    now: Date.now(),
    nextPullAt: Date.now(),
    meta: { fetchedAt: 0 },
    progress: null,
    error: null,
  };
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    requests.push({ path, method: init.method, body: init.body && JSON.parse(init.body) });
    if (path.startsWith('/api/catalog?'))
      return Response.json({ ...status, seq: 1, full: true, ids: null, lots: [] });
    if (path === '/api/settings') return Response.json({ values });
    if (path.startsWith('/api/settings/')) {
      values[decodeURIComponent(path.slice('/api/settings/'.length))] = JSON.parse(init.body).value;
      return Response.json({ rev: 1 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const vite = await createServer({
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  servers.push(vite);
  const settings = await vite.ssrLoadModule('/src/app/settings.ts');
  const keys = await vite.ssrLoadModule('/src/shared/keys.ts');
  const source = await vite.ssrLoadModule('/src/app/source.ts');
  return { vite, settings, ...keys, source, storage, reads, writes, requests, callbacks };
}

test('shared settings never read or write localStorage, while browser-only UI state still does', async (t) => {
  const { settings, SERVER_KEYS, KEYS, DEFAULTS, reads, writes, storage } = await setup(t);
  for (const key of SERVER_KEYS) {
    assert.deepEqual(settings.getSetting(key), DEFAULTS[key]);
    settings.applySetting(key, DEFAULTS[key]);
  }
  assert.deepEqual(reads, []);
  assert.deepEqual(writes, []);
  assert.deepEqual(settings.getSetting(KEYS.view), { search: 'local view' });
  settings.setSetting(KEYS.view, { search: 'new local view' });
  assert.deepEqual(JSON.parse(storage.get(`tlx:${KEYS.view}`)), { search: 'new local view' });
});

test('startup uses server values and defaults without uploading stale browser settings', async (t) => {
  const { settings, source, KEYS, reads, writes, requests } = await setup(t, {
    filterWords: [],
    tlxLastVisit: 123,
    tlxSavedSearches: [{ id: 'server', name: 'Server', lastViewedAt: 456 }],
    tlxView: { search: 'must stay browser-local' },
  });
  source.startCatalog();
  await source.settingsReady;
  assert.equal(source.settingsLoaded.value, true);
  assert.deepEqual(settings.getSetting(KEYS.words), []);
  assert.deepEqual(settings.getSetting(KEYS.customCategories), []);
  assert.equal(settings.getSetting(KEYS.lastVisit).epochMilliseconds, 123);
  assert.equal(settings.getSetting(KEYS.savedSearches)[0].lastViewedAt.epochMilliseconds, 456);
  assert.deepEqual(settings.getSetting(KEYS.view), { search: 'local view' });
  assert.deepEqual(reads, [`tlx:${KEYS.view}`]);
  assert.deepEqual(writes, []);
  assert.deepEqual(
    requests.map(({ method, path }) => [method, path]),
    [
      ['GET', '/api/catalog?since=0'],
      ['GET', '/api/settings'],
    ],
  );
});

test('edits save directly to the server with timestamps encoded and no local copy', async (t) => {
  const values = { filterWords: [] };
  const { settings, source, KEYS, writes, requests } = await setup(t, values);
  source.startCatalog();
  await source.settingsReady;
  settings.setSetting(KEYS.words, ['drill']);
  settings.setSetting(KEYS.lastVisit, Temporal.Instant.fromEpochMilliseconds(123));
  settings.setSetting(KEYS.savedSearches, [
    { id: 'new', name: 'New', view: {}, lastViewedAt: Temporal.Instant.fromEpochMilliseconds(456) },
  ]);
  await settle();
  assert.deepEqual(values.filterWords, ['drill']);
  assert.equal(values.tlxLastVisit, 123);
  assert.equal(values.tlxSavedSearches[0].lastViewedAt, 456);
  assert.equal(requests.filter(({ method }) => method === 'PUT').length, 3);
  assert.deepEqual(writes, []);
});

test('Update replaces only the chosen saved search and persists the latest draft and filters', async (t) => {
  const values = {
    tlxSavedSearches: [
      { id: 'drills', name: 'Drills', view: { search: 'drill' }, lastViewedAt: 123 },
      { id: 'saws', name: 'Saws', view: { search: 'saw' }, lastViewedAt: 456 },
    ],
  };
  const { source, settings, KEYS, vite, requests } = await setup(t, values);
  source.startCatalog();
  await source.settingsReady;
  const controls = await savedSearchControls(vite);
  const { setView, setSearchDraft, storedView } = await vite.ssrLoadModule('/src/app/state.ts');
  controls().saved.onOpen(settings.getSetting(KEYS.savedSearches)[0], false);
  await settle();
  const before = settings.getSetting(KEYS.savedSearches);
  setView({
    categories: ['tools'],
    priceMax: 50,
    sort: 'total-asc',
    newSince: Temporal.Instant.fromEpochMilliseconds(100),
  });
  setSearchDraft('brand:dewalt drill');
  assert.equal(storedView.value.search, 'drill', 'the typed search is still debounced');
  const update = controls().buttons.find(
    (node) => node.props['aria-label'] === 'Update saved search Drills',
  );
  assert.equal(update.props.disabled, false);
  update.props.onClick();
  await settle();

  const saved = settings.getSetting(KEYS.savedSearches);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].id, before[0].id);
  assert.equal(saved[0].name, before[0].name);
  assert.equal(saved[0].lastViewedAt, before[0].lastViewedAt);
  assert.equal(saved[1], before[1]);
  const { newSince: _newSince, ...expected } = storedView.value;
  assert.deepEqual(saved[0].view, expected);
  assert.equal(saved[0].view.search, 'brand:dewalt drill');
  assert.equal(controls().buttons[0].props.disabled, true);
  const request = requests.findLast(({ path }) => path === '/api/settings/tlxSavedSearches');
  assert.deepEqual(request.body.value[0].view, expected);
  assert.equal(request.body.value[0].lastViewedAt, before[0].lastViewedAt.epochMilliseconds);
  assert.deepEqual(values.tlxSavedSearches, request.body.value);
});

test('Update detects sort-only and draft changes but ignores new-only and unavailable catalog modes', async (t) => {
  const { source, settings, KEYS, vite } = await setup(t, {
    tlxSavedSearches: [
      { id: 'drills', name: 'Drills', view: { search: 'drill' }, lastViewedAt: 123 },
    ],
  });
  source.startCatalog();
  await source.settingsReady;
  const controls = await savedSearchControls(vite);
  const { setView, setSearchDraft, resetSearch, storedView, closed, filteredOnly } =
    await vite.ssrLoadModule('/src/app/state.ts');
  controls().saved.onOpen(settings.getSetting(KEYS.savedSearches)[0], false);
  assert.equal(controls().buttons[0].props.disabled, true);
  const sort = storedView.value.sort;
  setView({ sort: 'total-asc' });
  assert.equal(controls().buttons[0].props.disabled, false);
  setView({ sort, newSince: Temporal.Instant.fromEpochMilliseconds(100) });
  assert.equal(controls().buttons[0].props.disabled, true);
  setSearchDraft('drill kit');
  assert.equal(controls().buttons[0].props.disabled, false);
  resetSearch('drill');
  setView({ priceMax: 25 });
  filteredOnly.value = true;
  assert.equal(controls().buttons[0].props.disabled, true);
  filteredOnly.value = false;
  closed.value = 'won';
  assert.equal(controls().buttons[0].props.disabled, true);
  closed.value = null;
  assert.equal(controls().buttons[0].props.disabled, false);
});

test('failed saves show an explicit error and are not silently queued or persisted locally', async (t) => {
  const { settings, source, KEYS, writes, callbacks, vite } = await setup(t, { filterWords: [] });
  source.startCatalog();
  await source.settingsReady;
  await settle();
  let saves = 0;
  t.mock.method(globalThis, 'fetch', async (path) => {
    if (path === '/api/settings/filterWords') {
      saves++;
      return Response.json({ error: 'Database unavailable' }, { status: 500 });
    }
    if (path.startsWith('/api/catalog?')) {
      return Response.json({
        now: Date.now(),
        nextPullAt: Date.now(),
        meta: { fetchedAt: 0 },
        progress: null,
        error: null,
        seq: 1,
        full: true,
        lots: [],
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  t.mock.method(globalThis, 'setTimeout', () => 1);
  settings.setSetting(KEYS.words, ['drill']);
  await settle();
  const { Toasts } = await vite.ssrLoadModule('/src/app/toast.tsx');
  const vnode = h(Toasts, {});
  vnode.__c = new Component(vnode.props);
  vnode.__c.__h = [];
  options.__r(vnode);
  const tree = vnode.type(vnode.props);
  assert.match(
    tree.props.children[0].props.children,
    /Couldn’t save filterWords: Database unavailable.*not been saved/,
  );
  callbacks.shift()();
  await settle();
  assert.equal(saves, 1);
  assert.deepEqual(writes, []);
});

test('failed startup leaves settings unready and retries the server instead of using browser copies', async (t) => {
  const { source, settings, KEYS, callbacks, vite } = await setup(t);
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (path) => {
    if (path.startsWith('/api/catalog?')) {
      return Response.json({
        now: Date.now(),
        nextPullAt: Date.now(),
        meta: { fetchedAt: 0 },
        progress: null,
        error: null,
        seq: 1,
        full: true,
        lots: [],
      });
    }
    if (path === '/api/settings') {
      attempts++;
      return attempts === 1
        ? Response.json({ error: 'Settings unavailable' }, { status: 503 })
        : Response.json({ values: { filterWords: [] } });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  source.startCatalog();
  await settle();
  const { error } = await vite.ssrLoadModule('/src/app/catalog.ts');
  assert.equal(source.settingsLoaded.value, false);
  assert.equal(error.value, 'Settings unavailable');
  assert.deepEqual(settings.getSetting(KEYS.words), []);
  callbacks.shift()();
  await source.settingsReady;
  assert.equal(source.settingsLoaded.value, true);
  assert.equal(attempts, 2);
});
