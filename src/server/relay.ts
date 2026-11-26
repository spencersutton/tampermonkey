// Relays the site's live-updates websocket. The site only accepts its own
// Origin, so the server opens the upstream connection itself, presenting the
// site's Origin, and passes messages both ways unchanged. Centrifugo's close
// codes (3000–4999) carry its disconnect reasons, so they pass through too.
import type { ServerWebSocket, WebSocketHandler } from 'bun';

import { SITE } from '../shared/constants';
import { BunWebSocket, USER_AGENT } from './site';

export interface RelayData {
  kind: 'relay';
  upstream: WebSocket;
  client: ServerWebSocket<RelayData> | null; // set once the client socket opens
  early: (string | ArrayBuffer)[]; // upstream messages from before then
}

const CONNECT_TIMEOUT_MS = 15_000;

/** A close code the WebSocket client API accepts (1000 or 3000–4999). */
const clientCode = (code: number) => {
  if (code === 1000 || (code >= 3000 && code <= 4999)) {
    return code;
  }

  return 1000;
};
/** A close code a server may send: codes reserved for "no status"/"abnormal"/"TLS" become 1011. */
const serverCode = (code: number) => {
  if (code === 1005 || code === 1006 || code === 1015) {
    return 1011;
  }
  return code;
};

/** Open the upstream connection; resolves once it's open, rejects if it can't be. */
export function connectUpstream(url: string, protocols: string[]): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new BunWebSocket(url, {
      headers: { Origin: SITE, 'User-Agent': USER_AGENT },
      ...(protocols.length ? { protocols } : {}),
    });
    ws.binaryType = 'arraybuffer';
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timed out'));
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('connection failed'));
    });
  });
}

/** Wire an open upstream to the client socket that's about to open. */
export function relayData(upstream: WebSocket): RelayData {
  const data: RelayData = { kind: 'relay', upstream, client: null, early: [] };
  upstream.addEventListener('message', (event: MessageEvent<string | ArrayBuffer>) => {
    if (data.client) {
      data.client.send(event.data);
    } else {
      data.early.push(event.data);
    }
  });
  upstream.addEventListener('close', event =>
    data.client?.close(serverCode(event.code), event.reason),
  );
  return data;
}

export const relayHandler: WebSocketHandler<RelayData> = {
  open(ws) {
    ws.data.client = ws;
    for (const message of ws.data.early.splice(0)) {
      ws.send(message);
    }
    if (ws.data.upstream.readyState !== WebSocket.OPEN) {
      ws.close(1011, 'upstream closed');
    }
  },
  message(ws, message) {
    if (ws.data.upstream.readyState === WebSocket.OPEN) {
      ws.data.upstream.send(message);
    }
  },
  close(ws, code, reason) {
    ws.data.client = null;
    ws.data.upstream.close(clientCode(code), reason);
  },
};
