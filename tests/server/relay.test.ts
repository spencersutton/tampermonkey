// The /ws relay (src/server/relay.ts), end to end through Bun.serve: a fake
// upstream answers with the Centrifugo frames captured from the site.
import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { createApp } from '../../src/server/app';
import { Catalog } from '../../src/server/catalog';
import { History } from '../../src/server/history';
import { relayHandler, type RelayData } from '../../src/server/relay';
import { SiteSession } from '../../src/server/session';
import { BunWebSocket, SITE, SiteApi } from '../../src/server/site';
import { Store } from '../../src/server/store';

interface Frame {
  dir: 'sent' | 'received';
  data: Record<string, unknown>;
}
const { frames } = JSON.parse(
  readFileSync(new URL('../fixtures/site/ws-anonymous-lot-channels.json', import.meta.url), 'utf8'),
) as { frames: Frame[] };
const replies = new Map(
  frames.filter(f => f.dir === 'received' && 'id' in f.data).map(f => [f.data['id'], f.data]),
);
const push = frames.find(f => 'push' in f.data)!.data;

const upstreamSeen: { origin: string | null; messages: string[]; closed: number[] } = {
  origin: null,
  messages: [],
  closed: [],
};
const upstream = Bun.serve({
  port: 0,
  fetch(req, server) {
    upstreamSeen.origin = req.headers.get('Origin');
    return server.upgrade(req) ? undefined : new Response('no', { status: 400 });
  },
  websocket: {
    message(ws, message) {
      const text = String(message);
      upstreamSeen.messages.push(text);
      if (text === 'close-me') {
        ws.close(3501, 'bad request');
        return;
      }
      const reply = replies.get((JSON.parse(text) as { id?: number }).id);
      ws.send(JSON.stringify(reply));
      if (text.includes('"subscribe"')) {
        ws.send(JSON.stringify(push));
      }
    },
    close(_ws, code) {
      upstreamSeen.closed.push(code);
    },
  },
});

const app = createApp(deps(`ws://127.0.0.1:${upstream.port}`));
const front = Bun.serve<RelayData>({
  port: 0,
  fetch: (req, srv) => app.fetch(req, srv),
  websocket: relayHandler,
});
afterAll(() => {
  void front.stop(true);
  void upstream.stop(true);
});

function deps(wsUrl: string) {
  const store = new Store(':memory:');
  const site = new SiteApi();
  const session = new SiteSession(store);
  const history = new History(store, site);
  return {
    store,
    session,
    history,
    catalog: new Catalog(store, session, history, site),
    password: null,
    staticDir: '/nonexistent',
    wsUrl,
  };
}

function open(headers: Record<string, string> = {}) {
  const ws = new BunWebSocket(`ws://127.0.0.1:${front.port}/ws`, { headers });
  const received: unknown[] = [];
  const closed = new Promise<{ code: number; reason: string }>(resolve =>
    ws.addEventListener('close', e => resolve({ code: e.code, reason: e.reason })),
  );
  const message = () =>
    new Promise<unknown>(resolve =>
      ws.addEventListener('message', e => resolve(JSON.parse(String(e.data))), { once: true }),
    );
  ws.addEventListener('message', e => received.push(JSON.parse(String(e.data))));
  const opened = new Promise<boolean>(resolve => {
    ws.addEventListener('open', () => resolve(true));
    ws.addEventListener('error', () => resolve(false));
  });
  return { ws, received, closed, message, opened };
}

test("messages pass both ways unchanged, upstream sees the site's Origin", async () => {
  const client = open({ Origin: `http://127.0.0.1:${front.port}` });
  expect(await client.opened).toBe(true);
  const sent = frames.filter(f => f.dir === 'sent' && 'id' in f.data).slice(0, 2);
  for (const frame of sent) {
    const next = client.message();
    client.ws.send(JSON.stringify(frame.data));
    expect(await next).toEqual(replies.get(frame.data['id']));
  }
  await Bun.sleep(50);
  expect(client.received.at(-1)).toEqual(push);
  expect(upstreamSeen.origin).toBe(SITE);
  expect(upstreamSeen.messages).toEqual(sent.map(f => JSON.stringify(f.data)));

  client.ws.close(3000, 'bye');
  await client.closed;
  await Bun.sleep(50);
  expect(upstreamSeen.closed.at(-1)).toBe(3000);
});

test("upstream's Centrifugo close codes reach the client", async () => {
  const client = open();
  expect(await client.opened).toBe(true);
  client.ws.send('close-me');
  expect(await client.closed).toEqual({ code: 3501, reason: 'bad request' });
});

test('cross-origin upgrades are refused before connecting upstream', async () => {
  const res = await fetch(`http://127.0.0.1:${front.port}/ws`, {
    headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: 'https://evil.example' },
  });
  expect(res.status).toBe(403);
});

test('an unreachable upstream is a 502', async () => {
  const dead = createApp(deps('ws://127.0.0.1:1'));
  const server = Bun.serve<RelayData>({
    port: 0,
    fetch: (req, srv) => dead.fetch(req, srv),
    websocket: relayHandler,
  });
  const res = await fetch(`http://127.0.0.1:${server.port}/ws`, {
    headers: {
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    },
  });
  expect(res.status).toBe(502);
  void server.stop(true);
});
