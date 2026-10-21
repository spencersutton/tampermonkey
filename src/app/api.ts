// Thin client for the site's JSON API. Requests carry the same bearer token
// the site's own client sends (see auth.ts), so lots include account fields
// like your standing and watchlist state.
import { authedFetch, isAuthenticated, LOGIN_PLACE } from '@auth';
import type { BidHistoryEntry, Lot, LotDetail, LotImage, Standing } from './types';

/** Prefix for the site's API (proxied on the same origin, by the site itself or by the tlx server). */
const BASE = '/backend';
/** Host serving lot images. */
export const CDN = 'https://cdn.triangleliquidators.com';
export const LIST_PAGE_SIZE = 100; // the API's maximum per_page

const LOGGED_OUT = `You’re logged out. Log in${LOGIN_PLACE}, then try again.`;

/** A failed API request, with its HTTP status. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export { authToken, isAuthenticated } from '@auth';

/** GET a JSON endpoint with query params, using the login token when there is one. */
async function get<T>(path: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  // If the session is gone, fall back to anonymous data rather than failing.
  const res = await authedFetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, { headers: { Accept: 'application/json' }, signal }, true);
  if (!res.ok) {
    throw new ApiError(`${res.status} ${res.statusText || 'error'} for ${path}`, res.status);
  }
  return res.json() as Promise<T>;
}

/** Send a state-changing request with the headers the site's own client uses. */
function send(path: string, method: 'POST' | 'DELETE', body?: unknown, headers: Record<string, string> = {}) {
  const json: Record<string, string> = body === undefined ? {} : { 'Content-Type': 'application/json' };
  return authedFetch(`${BASE}${path}`, {
    method,
    headers: { Accept: 'application/json', ...json, 'X-CSRF-Protection': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Raw = Record<string, any>;

/** The value if it is a finite number, else the fallback. */
const num = <D = number>(v: unknown, fallback: D = 0 as D): number | D => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Read a field the API may send in either snake_case or camelCase. */
const pick = (o: Raw, snake: string, camel: string) => o?.[snake] ?? o?.[camel];

/** Convert the API's `your_standing` object (snake_case) into a Standing. */
export function normalizeStanding(s: Raw | null | undefined): Standing | null {
  if (!s || typeof s !== 'object') {
    return null;
  }
  return { isLeading: !!s.is_leading, yourMaxBid: s.your_max_bid ?? null };
}

/** Image URLs in display order. */
function normalizeImages(images: Raw[] | null | undefined): LotImage[] {
  return (images ?? []).toSorted((a, b) => num(a.position) - num(b.position)).map((i) => ({ thumb: i.image_thumb, card: i.image_card, large: i.image_large }));
}

/** Convert a raw API lot (snake_case) into a Lot. */
export function normalizeLot(r: Raw): Lot {
  return {
    id: r.id,
    auctionPeriod: r.auction_period,
    title: String(r.title ?? ''),
    lotNumber: String(r.lot_number ?? ''),
    category: r.category ? { value: r.category.value, label: r.category.label } : null,
    condition: r.condition ? { value: r.condition.value, label: r.condition.display_name } : null,
    location: r.location ? { id: r.location.id, name: r.location.name } : null,
    isTransferable: !!r.is_transferable,
    transferFee: num(r.transfer_fee),
    currentPrice: num(r.current_price),
    estimatedRetailPrice: r.estimated_retail_price ?? null,
    endsAt: Date.parse(r.ends_at),
    status: r.status,
    version: num(r.version, -1),
    bidCount: num(r.bid_count),
    nextMinIncrement: num(r.next_min_increment),
    yourStanding: normalizeStanding(r.your_standing),
    isWatchlisted: !!r.is_watchlisted,
    hasBid: !!r.has_bid,
    images: normalizeImages(r.images),
  };
}

export interface LotPage {
  count: number;
  results: Lot[];
}

// `newly-listed` order keeps pages stable while we walk them: new lots only
// push items toward later pages (we dedupe), and lots that close are mostly
// the oldest listings at the end.
export async function fetchLotPage(page: number, signal?: AbortSignal): Promise<LotPage> {
  const d = await get<{ count: number; results: Raw[] }>('/v1/auctions/lots/', { page, per_page: LIST_PAGE_SIZE, order_by: 'newly-listed' }, signal);
  return { count: d.count, results: d.results.map(normalizeLot) };
}

/** Fetch one lot's full detail: description, brand/model and bid history. */
export async function fetchLotDetail(auctionPeriod: string, id: number, signal?: AbortSignal): Promise<LotDetail> {
  const r = await get<Raw>(`/v1/auctions/lots/${auctionPeriod}/${id}/`, {}, signal);
  return {
    ...normalizeLot(r),
    description: String(r.description ?? ''),
    brand: r.brand || null,
    model: r.model || null,
    lotFee: r.lot_fee ?? null,
    bidHistory: (r.bid_history ?? []).map((b: Raw): BidHistoryEntry => ({ bidderLabel: b.bidder_label, amount: num(b.amount), isYou: !!b.is_you })),
  };
}

export interface PickupLocation {
  id: number | null;
  name: string | null;
}

/** The pickup location set on the logged-in account, or null if none. */
export async function fetchPickupLocation(): Promise<PickupLocation | null> {
  const p = (await get<Raw>('/v1/auth/me/')).pickup_location;
  return p ? { id: num(p.id, null), name: p.name || p.label || null } : null;
}

/** Token that authenticates the live-updates websocket as this account. */
export async function fetchWsToken(): Promise<string> {
  return (await get<{ token: string }>('/v1/auth/ws-token/')).token;
}

/** Add or remove a lot from your watchlist, like the site's star button. */
export async function setWatchlisted(auctionPeriod: string, lotId: number, on: boolean): Promise<void> {
  if (!isAuthenticated()) {
    throw new ApiError(`Log in${LOGIN_PLACE} to use your watchlist.`, 401);
  }
  const res = await send(`/v1/auctions/control-panel/lots/${auctionPeriod}/${lotId}/watchlist/`, on ? 'POST' : 'DELETE', on ? {} : undefined);
  if (res.ok) {
    return;
  }
  if (res.status === 401) {
    throw new ApiError(LOGGED_OUT, 401);
  }
  const data: Raw = await res.json().catch(() => ({}));
  const message = data.code === 'lot_already_bid' && data.error ? String(data.error) : 'Couldn’t update your watchlist. Please try again.';
  throw new ApiError(message, res.status);
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
    throw new BidError(`Log in${LOGIN_PLACE} to bid.`, 401);
  }
  let res: Response;
  try {
    res = await send(`/v1/auctions/lots/${lotId}/bids`, 'POST', { amount }, { 'X-Bid-Surface': 'other', 'X-Bid-Type': type });
  } catch {
    throw new BidError('Network error – the bid may not have been placed. Check the lot before trying again.', 0);
  }
  const data: Raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details: Raw = data.details ?? {};
    const message = (Array.isArray(details.amount) && details.amount[0]) || data.error || bidFailure(res.status);
    throw new BidError(String(message), res.status, data.code ?? null, num(pick(details, 'min_next_bid', 'minNextBid'), null));
  }
  return {
    isLeading: !!pick(data, 'is_leading', 'isLeading'),
    isMaxCollision: !!pick(data, 'is_max_collision', 'isMaxCollision'),
    currentPrice: num(pick(data, 'current_price', 'currentPrice'), null),
    minNextBid: num(pick(data, 'min_next_bid', 'minNextBid'), null),
    version: num(data.version, null),
  };
}
