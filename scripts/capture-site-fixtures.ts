// Captures real responses from triangleliquidators.com into tests/fixtures/site/,
// so tests run against what the site actually sends. Anonymous, public
// endpoints only: nothing from anyone's account ends up in the repo.
//
//   npm run capture-fixtures                     # HTTP samples, then 3 min of websocket frames
//   npm run capture-fixtures -- --no-ws          # skip the websocket
//   npm run capture-fixtures -- --ws-seconds=600 # listen longer (bids are busiest near closing)
//
// Requests go one at a time with a pause between, like the server's own pulls.
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

import { BunWebSocket } from '../src/server/site';
import type { RawLot, RawLotDetail } from '../src/shared/lot';

const SITE = 'https://triangleliquidators.com';
const WS_URL = 'wss://ws.triangleliquidators.com/connection/websocket';
const USER_AGENT = 'tlx-server/1.0 (+https://github.com/spencersutton/tampermonkey)';
const OUT = new URL('../tests/fixtures/site/', import.meta.url);
const PAUSE_MS = 500;
const arg = (name: string, fallback: number) =>
  Number(process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const WS_SECONDS = arg('ws-seconds', 180);
const WS_LOTS = 100; // the soonest-ending lots get the most bids

interface Fixture {
  request: { method: string; path: string };
  status: number;
  contentType: string | null;
  capturedAt: string;
  body: unknown;
}

function save(name: string, data: unknown) {
  writeFileSync(new URL(name, OUT), `${JSON.stringify(data, null, 2)}\n`);
  console.log(`  ${name}`);
}

async function capture(path: string, redact?: (body: unknown) => unknown): Promise<Fixture> {
  await sleep(PAUSE_MS);
  const res = await fetch(SITE + path, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    request: { method: 'GET', path },
    status: res.status,
    contentType: res.headers.get('Content-Type'),
    capturedAt: new Date().toISOString(),
    body: redact ? redact(body) : body,
  };
}

const lotsPath = (order: string) =>
  `/backend/v1/auctions/lots/?page=1&per_page=5&order_by=${order}`;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const results = (f: Fixture) => (f.body as { results: RawLot[] }).results;

async function captureHttp(): Promise<RawLot[]> {
  console.log('HTTP:');
  const newest = await capture(lotsPath('newly-listed'));
  save('lots-newly-listed.json', newest);
  const soonest = await capture(lotsPath('ending-soonest'));
  save('lots-ending-soonest.json', soonest);

  // Details, until there's one with a brand and model and one without (at most 6 tries).
  let withIdentity = false;
  let withoutIdentity = false;
  for (const lot of [...results(soonest), ...results(newest)].slice(0, 6)) {
    const detail = await capture(`/backend/v1/auctions/lots/${lot.auction_period}/${lot.id}/`);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const body = detail.body as RawLotDetail;
    const known = Boolean(body.brand && body.model);
    if (known ? !withIdentity : !withoutIdentity) {
      save(`lot-detail-${known ? 'with' : 'without'}-brand-model.json`, detail);
      withIdentity ||= known;
      withoutIdentity ||= !known;
    }
    if (withIdentity && withoutIdentity) {
      break;
    }
  }
  const period = results(newest)[0]?.auction_period ?? '';
  save('lot-detail-not-found.json', await capture(`/backend/v1/auctions/lots/${period}/1/`));
  save('filter-config.json', await capture('/backend/v1/auctions/filter-config/'));
  save('auth-me-anonymous.json', await capture('/backend/v1/auth/me/'));
  save('auth-session-logged-out.json', await capture('/api/auth/session'));
  save(
    'auth-csrf.json',
    await capture('/api/auth/csrf', body => ({
      ...(typeof body === 'object' ? body : {}),
      csrfToken: '<redacted>',
    })),
  );
  return results(
    await capture(lotsPath('ending-soonest').replace('per_page=5', `per_page=${WS_LOTS}`)),
  );
}

/**
 * Connect anonymously like the app's Centrifuge client, subscribe to the soonest-ending lots, and
 * record every frame.
 */
async function captureWs(lots: RawLot[]) {
  console.log(`Websocket (${lots.length} lots, ${WS_SECONDS}s):`);
  const frames: { at: number; dir: 'sent' | 'received'; data: unknown }[] = [];
  const start = Date.now();
  // Bun's WebSocket takes headers; the site only accepts its own Origin.
  const ws = new BunWebSocket(WS_URL, { headers: { Origin: SITE, 'User-Agent': USER_AGENT } });
  const send = (msg: object) => {
    frames.push({ at: Date.now() - start, dir: 'sent', data: msg });
    ws.send(JSON.stringify(msg));
  };
  let id = 0;
  let publications = 0;
  const done = new Promise<void>(resolve => {
    ws.addEventListener('open', () => {
      send({ id: ++id, connect: { name: 'js', version: '5.7.4' } });
      for (const lot of lots) {
        send({ id: ++id, subscribe: { channel: `lot:${lot.id}` } });
      }
    });
    ws.addEventListener('message', event => {
      // Centrifugo's JSON protocol may batch replies, one per line.
      for (const line of String(event.data).split('\n').filter(Boolean)) {
        const data: unknown = JSON.parse(line);
        frames.push({ at: Date.now() - start, dir: 'received', data });
        if (data && typeof data === 'object' && Object.keys(data).length === 0) {
          send({}); // ping → pong
        }
        if (data && typeof data === 'object' && 'push' in data) {
          publications++;
        }
      }
    });
    ws.addEventListener('close', () => resolve());
    setTimeout(() => ws.close(), WS_SECONDS * 1000);
  });
  await done;
  save('ws-anonymous-lot-channels.json', {
    url: WS_URL,
    capturedAt: new Date(start).toISOString(),
    seconds: WS_SECONDS,
    frames,
  });
  console.log(`  ${publications} publications`);
}

mkdirSync(OUT, { recursive: true });
const lots = await captureHttp();
if (!process.argv.includes('--no-ws')) {
  await captureWs(lots);
}
