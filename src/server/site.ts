import { SITE } from '../shared/constants';
// The site this server stands in for, and a client for its JSON API.
import type { RawLot } from '../shared/lot';
import { isRecord, prop } from './json';

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

export const BASE = `${SITE}/backend`;
export const LIST_PAGE_SIZE = 100; // the API's maximum per_page
const TIMEOUT_MS = 30_000;

/** A failed API request, with its HTTP status (0 = network error). */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export interface LotPage {
  count: number;
  results: RawLot[];
}

/** Client for the site's JSON API (the same endpoints the app uses through /backend). */
export class SiteApi {
  private readonly fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetch = fetchImpl;
  }

  /** GET a JSON object endpoint, with the bearer token when there is one. */
  async get(
    path: string,
    params: Record<string, string | number> = {},
    token: string | null = null,
  ): Promise<Record<string, unknown>> {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const url = `${BASE}${path}${query.size ? `?${query}` : ''}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await this.fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new ApiError(`Network error for ${path}: ${String(e)}`, 0);
    }
    if (!res.ok) {
      throw new ApiError(`${res.status} ${res.statusText || 'error'} for ${path}`, res.status);
    }
    let d: unknown;
    try {
      d = await res.json();
    } catch {
      throw new ApiError(`Invalid JSON for ${path}`, 502);
    }
    if (!isRecord(d)) {
      throw new ApiError(`Expected a JSON object for ${path}`, 502);
    }
    return d;
  }

  /**
   * One page of the catalog, newest first. `newly-listed` order keeps pages stable while we walk
   * them: new lots only push items toward later pages (we dedupe), and lots that close are mostly
   * the oldest listings at the end.
   */
  async fetchLotPage(page: number, token: string | null): Promise<LotPage> {
    const d = await this.get(
      '/v1/auctions/lots/',
      { page, per_page: LIST_PAGE_SIZE, order_by: 'newly-listed' },
      token,
    );
    const results = prop(d, 'results');
    return {
      count: Math.trunc(Number(prop(d, 'count')) || 0),
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the site's lots (see tests/fixtures/site)
      results: Array.isArray(results) ? (results as RawLot[]) : [],
    };
  }
}
