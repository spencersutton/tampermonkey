import assert from 'node:assert/strict';
import test from 'node:test';
import { readClosedStream } from '../src/app/closedStream.ts';

const encode = new TextEncoder();

test('displays pages as chunks arrive, including split UTF-8 characters', async () => {
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const pages = [];
  const result = readClosedStream(new Response(stream), (lots, count, counts) => pages.push({ lots, count, counts }), () => assert.fail('unexpected 401'));
  const first = encode.encode('{"lots":[{"title":"café"}],"count":2,"done":false,"counts":{"lost":3}}\n');
  const accent = first.indexOf(0xc3);
  controller.enqueue(first.slice(0, accent + 1));
  controller.enqueue(first.slice(accent + 1));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pages, [{ lots: [{ title: 'café' }], count: 2, counts: { lost: 3 } }]);
  controller.enqueue(encode.encode('{"lots":[{"title":"second"}],"count":2,"done":true,"counts":{"won":2,"lost":3}}\n'));
  controller.close();
  assert.deepEqual(await result, [{ title: 'café' }, { title: 'second' }]);
  assert.equal(pages.length, 2);
});

test('reports an upstream error after a partial page and refreshes on 401', async () => {
  const stream = new Response('{"lots":[1],"count":2,"done":false}\n{"error":"Login expired","status":401}\n');
  const pages = [];
  let refreshed = false;
  await assert.rejects(readClosedStream(stream, (lots) => pages.push(lots), () => { refreshed = true; }), /Login expired/);
  assert.deepEqual(pages, [[1]]);
  assert.equal(refreshed, true);
});

test('rejects a truncated response instead of reporting success', async () => {
  const stream = new Response('{"lots":[1],"count":2,"done":false}\n');
  await assert.rejects(readClosedStream(stream, () => {}, () => {}), /ended unexpectedly/);
});

test('surfaces interrupted streams', async () => {
  const stream = new ReadableStream({ start(c) { c.error(new Error('interrupted')); } });
  await assert.rejects(readClosedStream(new Response(stream), () => {}, () => {}), /interrupted/);
});

test('cancels the response when a streamed error is received', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) { c.enqueue(encode.encode('{"error":"failed","status":503}\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readClosedStream(new Response(stream), () => {}, () => {}), /failed/);
  assert.equal(cancelled, true);
});
