// fetchLotDetail in src/app/api.ts: the site's lot detail, kept in its own shape.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import 'temporal-polyfill/global';
import { createServer } from 'vite';

import { rawDetail, rawLot } from './raw-lot.mjs';

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const vite = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
});
after(() => vite.close());
const api = await vite.ssrLoadModule('/src/app/api.ts');

const replyWith = (t, body) => t.mock.method(globalThis, 'fetch', async () => Response.json(body));

test('details keep the site fields, with an empty brand or model as unknown', async t => {
  const raw = rawDetail({ id: 9, brand: '', model: 'D-100', similar: [rawLot({ id: 10 })] });
  replyWith(t, raw);
  const detail = await api.fetchLotDetail('test', 9);
  assert.deepEqual(detail, { ...raw, brand: null });
  replyWith(t, { ...raw, brand: 'Acme', model: '' });
  assert.deepEqual(await api.fetchLotDetail('test', 9), { ...raw, brand: 'Acme', model: null });
});

test('details and their similar lots need a valid end time', async t => {
  replyWith(t, rawDetail({ ends_at: 'not a time' }));
  await assert.rejects(api.fetchLotDetail('test', 1), TypeError);
  replyWith(t, rawDetail({ similar: [rawLot({ ends_at: '' })] }));
  await assert.rejects(api.fetchLotDetail('test', 1), TypeError);
});
