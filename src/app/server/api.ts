// Thin HTTP client for both the tlx server's /api endpoints and the proxied
// site JSON API under /backend (which adds the server's login token).
import type { LotMetadata, RawLotDetail } from '../../shared/lot';
import type { ClosedSection } from '../logic/history';
import type { ClosedLot, LotDetail, PastCloseDetail } from '../types';
import { authedFetch, isAuthenticated, refreshSession } from './auth';

export type { ClosedSection };

/** Prefix for the site's API (proxied on the same origin by the tlx server). */
const BASE = '/backend';
const API_TIMEOUT = 30_000;

const LOGGED_OUT = 'You’re logged out. Log in, then try again.';

/** GET a JSON endpoint through authedFetch. */
async function get<T>(path: string, signal?: AbortSignal, prefix = BASE): Promise<T> {
  const res = await authedFetch(prefix + path, {
    headers: { Accept: 'application/json' },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText || 'error'} for ${path}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return res.json() as Promise<T>;
}

/** Send a state-changing request to the proxied site API with its CSRF header. */
function send(
  path: string,
  method: 'POST' | 'DELETE',
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const json: Record<string, string> =
    body === undefined ? {} : { 'Content-Type': 'application/json' };
  return authedFetch(`${BASE}${path}`, {
    method,
    headers: { Accept: 'application/json', ...json, 'X-CSRF-Protection': '1', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Call a tlx server /api endpoint with a timeout and parse its JSON reply. */
async function callServer<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT),
      headers: {
        Accept: 'application/json',
        'X-TLX-Client': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Can’t reach the tlx server. Check your connection.');
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401) {
    void refreshSession(); // the app got locked: the page shows the password prompt
  }
  if (!res.ok || !data) {
    throw new Error(data?.error || `tlx server replied ${res.status}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return data as T;
}

// ---------------------------------------------------------------------------
// tlx server endpoints (/api/*)
// ---------------------------------------------------------------------------

export interface PullStatus {
  now: number;
  meta: { fetchedAt: number | null };
  nextPullAt: number;
  progress: { done: number; total: number | null } | null;
  error: string | null;
}

export interface CatalogReply extends PullStatus {
  seq: number;
  full: boolean;
  ids: number[] | null; // every current lot id (delta replies only)
  lots: Lot[]; // lots changed since the requested sequence
}

export const fetchCatalog = (since: number) =>
  callServer<CatalogReply>('GET', `/api/catalog?since=${since}`);

export const requestPull = () => callServer<PullStatus>('POST', '/api/pull');

/** Every closed lot matching this item's identity or title fallback, most recent first. */
export const fetchPastCloses = (id: number) =>
  callServer<{ closes: PastCloseDetail[] }>('GET', `/api/history?id=${id}`).then(r => r.closes);

export const saveItemType = (lotId: number, itemType: string) =>
  callServer<{ lotIds: number[]; itemType: string; seq: number }>('PUT', '/api/item-type', {
    lotId,
    itemType,
  });

export const fetchServerSettings = () =>
  callServer<{ values: Record<string, unknown> }>('GET', '/api/settings');

export const saveServerSetting = (key: string, value: unknown) =>
  callServer('PUT', `/api/settings/${encodeURIComponent(key)}`, { value });

/** Read persisted item metadata without asking the site or returning stale auction state. */
export async function fetchLotMetadata(
  auctionPeriod: string,
  id: number,
): Promise<LotMetadata | null> {
  const query = new URLSearchParams({ id: String(id), auctionPeriod });
  const reply = await get<{ metadata: LotMetadata | null }>(
    `/api/lot-metadata?${query}`,
    undefined,
    '',
  );
  return reply.metadata;
}

// ---------------------------------------------------------------------------
// Proxied site endpoints (/backend/*)
// ---------------------------------------------------------------------------

interface RawBidResponse {
  code?: string | null;
  error?: string | null;
  details?: { amount?: string[]; min_next_bid?: number | null } | null;
  is_leading?: boolean | null;
  is_max_collision?: boolean | null;
  current_price?: number | null;
  min_next_bid?: number | null;
  version?: number | null;
}

/** Fetch one lot's full detail: description, brand/model, bid history and the site's similar lots. */
export async function fetchLotDetail(
  auctionPeriod: string,
  id: number,
  signal?: AbortSignal,
): Promise<LotDetail> {
  return await get<RawLotDetail>(`/v1/auctions/lots/${auctionPeriod}/${id}/`, signal);
}

/**
 * Fetch every closed lot in a section, most recent first, calling `onPage` with the list so far as
 * pages arrive.
 */
export async function fetchClosed(
  section: ClosedSection,
  onPage: (lots: ClosedLot[], count: number) => void,
  signal?: AbortSignal,
): Promise<ClosedLot[]> {
  const out: ClosedLot[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    const d = await get<{ count: number; results: ClosedLot[] }>(
      `/v1/auctions/control-panel/closed/${section}/?page=${page}&per_page=100`,
      signal,
    );
    for (const lot of d.results) {
      // Pages can shift while we walk them; the site dedupes the same way.
      const key = `${lot.auction_period}:${lot.lot_id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(lot);
      }
    }
    onPage([...out], d.count);
    if (!d.results.length || out.length >= d.count) {
      return out;
    }
  }
}

/** A condition as the site explains it ("Like New": "Appears open-box or lightly used; …"). */
export interface ConditionInfo {
  value: number;
  label: string;
  description: string;
}

/** The site's condition descriptions (public; the same for everyone). */
export async function fetchConditions(): Promise<ConditionInfo[]> {
  interface CriteriaDescriptor {
    conditions?: ConditionInfo[] | null;
  }

  const d = await get<CriteriaDescriptor>('/v1/auctions/filter-config/');
  return (d.conditions ?? []).map(c => ({
    value: c.value,
    label: c.label,
    description: c.description,
  }));
}

export interface PickupLocation {
  id: number | null;
  name: string | null;
}

/** The pickup location set on the logged-in account, or null if none. */
export async function fetchPickupLocation(): Promise<PickupLocation | null> {
  interface PickupLocationInfo {
    pickup_location: PickupLocation | null;
  }

  const p = (await get<PickupLocationInfo>('/v1/auth/me/')).pickup_location;
  return p ? { id: p.id ?? null, name: p.name || null } : null;
}

/** Token that authenticates the live-updates websocket as this account. */
export async function fetchWsToken(): Promise<string> {
  return (await get<{ token: string }>('/v1/auth/ws-token/')).token;
}

/** Add or remove a lot from your watchlist, like the site's star button. */
export async function setWatchlisted(
  auctionPeriod: string,
  lotId: number,
  on: boolean,
): Promise<void> {
  if (!isAuthenticated()) {
    throw new Error('Log in to use your watchlist.');
  }
  const res = await send(
    `/v1/auctions/control-panel/lots/${auctionPeriod}/${lotId}/watchlist/`,
    on ? 'POST' : 'DELETE',
    on ? {} : undefined,
  );
  if (res.ok) {
    return;
  }
  if (res.status === 401) {
    throw new Error(LOGGED_OUT);
  }
  const data: RawBidResponse = await res.json().catch(() => ({}));
  if (data.code === 'lot_already_bid' && data.error) {
    throw new Error(data.error);
  }
  throw new Error('Couldn’t update your watchlist. Please try again.');
}

// ---------------------------------------------------------------------------
// Bidding: the same request the site's own bid buttons send.
// ---------------------------------------------------------------------------
export type BidType = 'max_bid' | 'next_increment';

export interface BidResult {
  isLeading: boolean;
  isMaxCollision: boolean; // another bidder already had this exact max
  currentPrice: number | null;
  minNextBid: number | null;
  version: number | null;
}

/** A rejected or failed bid, with the details needed to update the lot and explain why. */
export class BidError extends Error {
  constructor(
    message: string,
    readonly status: number, // 0 = network error
    readonly code: string | null = null,
    readonly minNextBid: number | null = null,
  ) {
    super(message);
  }
}

/** Fallback message for a failed bid the API didn't explain. */
function bidFailure(status: number) {
  if (status === 401 || status === 403) {
    return LOGGED_OUT;
  }
  return status === 409 ? 'This lot has closed.' : `Bid failed (${status}).`;
}

/** Place a bid (a max bid or the next increment) and return the outcome. */
export async function placeBid(lotId: number, amount: number, type: BidType): Promise<BidResult> {
  if (!isAuthenticated()) {
    throw new BidError('Log in to bid.', 401);
  }
  let res: Response;
  try {
    res = await send(
      `/v1/auctions/lots/${lotId}/bids`,
      'POST',
      { amount },
      { 'X-Bid-Surface': 'other', 'X-Bid-Type': type },
    );
  } catch {
    throw new BidError(
      'Network error – the bid may not have been placed. Check the lot before trying again.',
      0,
    );
  }
  const data: RawBidResponse = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = data.details ?? {};
    const message =
      (Array.isArray(details.amount) && details.amount[0]) || data.error || bidFailure(res.status);
    throw new BidError(message, res.status, data.code ?? null, details.min_next_bid ?? null);
  }
  return {
    isLeading: Boolean(data.is_leading),
    isMaxCollision: Boolean(data.is_max_collision),
    currentPrice: data.current_price ?? null,
    minNextBid: data.min_next_bid ?? null,
    version: data.version ?? null,
  };
}
