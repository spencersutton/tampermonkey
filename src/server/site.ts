// The site this server stands in for.
export const SITE = 'https://triangleliquidators.com';
export const WS_URL = 'wss://ws.triangleliquidators.com/connection/websocket';
export const USER_AGENT = 'tlx-server/1.0 (+https://github.com/spencersutton/tampermonkey)';
export const VERSION = '1.0.0';

/**
 * Bun's WebSocket client takes headers (the site only accepts its own Origin); @types/node's
 * WebSocket type hides that.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
export const BunWebSocket = WebSocket as unknown as new (
  url: string,
  options: Bun.WebSocketOptions,
) => WebSocket;
