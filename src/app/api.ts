// Thin client for the site's JSON API, proxied by the tlx server, which adds
// its login token (see auth.tsx), so lots include account fields like your
// standing and watchlist state.
import { authedFetch, isAuthenticated, refreshSession } from './auth';
import { readClosedStream, type ClosedCounts } from './closedStream';
import type { ClosedLot, Lot, LotDetail, Standing } from './types';

/** Prefix for the site's API (proxied on the same origin by the tlx server). */
const BASE = '/backend';
/** Host serving lot images. */
export const CDN = 'https://cdn.triangleliquidators.com';

const LOGGED_OUT = 'You’re logged out. Log in, then try again.';

/** GET a JSON endpoint. */
async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await authedFetch(BASE + path, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText || 'error'} for ${path}`);
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

/** Convert the API's `your_standing` object (snake_case) into a Standing. */
export function normalizeStanding(s: Raw | null | undefined): Standing | null {
  return s ? { isLeading: !!s.is_leading, yourMaxBid: s.your_max_bid ?? null } : null;
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
    transferFee: r.transfer_fee ?? 0,
    currentPrice: r.current_price ?? 0,
    estimatedRetailPrice: r.estimated_retail_price ?? null,
    endsAt: Date.parse(r.ends_at),
    status: r.status,
    version: r.version ?? -1,
    bidCount: r.bid_count ?? 0,
    nextMinIncrement: r.next_min_increment ?? 0,
    yourStanding: normalizeStanding(r.your_standing),
    isWatchlisted: !!r.is_watchlisted,
    hasBid: !!r.has_bid,
    images: (r.images ?? [])
      .toSorted((a: Raw, b: Raw) => a.position - b.position)
      .map((i: Raw) => ({ thumb: i.image_thumb, card: i.image_card, large: i.image_large })),
  };
}

/** Fetch one lot's full detail: description, brand/model, bid history and the site's similar lots. */
export async function fetchLotDetail(auctionPeriod: string, id: number, signal?: AbortSignal): Promise<LotDetail> {
  const r = await get<Raw>(`/v1/auctions/lots/${auctionPeriod}/${id}/`, signal);
  return {
    ...normalizeLot(r),
    description: String(r.description ?? ''),
    brand: r.brand || null,
    model: r.model || null,
    lotFee: r.lot_fee ?? null,
    bidHistory: (r.bid_history ?? []).map((b: Raw) => ({ bidderLabel: b.bidder_label, amount: b.amount, isYou: !!b.is_you })),
    similar: (r.similar ?? []).map(normalizeLot),
  };
}

  /** Fetch the server's normalized closed lots as its upstream pages arrive. */
export async function fetchClosed(section: 'won' | 'lost', onPage: (lots: ClosedLot[], count: number, counts: ClosedCounts) => void, signal?: AbortSignal): Promise<ClosedLot[]> {
  const res = await authedFetch(`/api/closed?section=${section}`, { headers: { Accept: 'application/x-ndjson' }, signal });
  if (!res.ok) {
    const data: { error?: string } = await res.json();
    throw new Error(data.error || `Server replied ${res.status}`);
  }
  return readClosedStream(res, onPage, () => void refreshSession());
}

/** A condition as the site explains it ("Like New": "Appears open-box or lightly used; …"). */
export interface ConditionInfo {
  value: number;
  label: string;
  description: string;
}

/** The site's condition descriptions (public; the same for everyone). */
export async function fetchConditions(): Promise<ConditionInfo[]> {
  const d = await get<Raw>('/v1/auctions/filter-config/');
  return (d.conditions ?? []).map((c: Raw) => ({ value: c.value, label: String(c.label ?? ''), description: String(c.description ?? '') }));
}

export interface PickupLocation {
  id: number | null;
  name: string | null;
}

/** The pickup location set on the logged-in account, or null if none. */
export async function fetchPickupLocation(): Promise<PickupLocation | null> {
  const p = (await get<Raw>('/v1/auth/me/')).pickup_location;
  return p ? { id: p.id ?? null, name: p.name || p.label || null } : null;
}

/** Token that authenticates the live-updates websocket as this account. */
export async function fetchWsToken(): Promise<string> {
  return (await get<{ token: string }>('/v1/auth/ws-token/')).token;
}

/** Add or remove a lot from your watchlist, like the site's star button. */
export async function setWatchlisted(auctionPeriod: string, lotId: number, on: boolean): Promise<void> {
  if (!isAuthenticated()) {
    throw new Error('Log in to use your watchlist.');
  }
  const res = await send(`/v1/auctions/control-panel/lots/${auctionPeriod}/${lotId}/watchlist/`, on ? 'POST' : 'DELETE', on ? {} : undefined);
  if (res.ok) {
    return;
  }
  if (res.status === 401) {
    throw new Error(LOGGED_OUT);
  }
  const data: Raw = await res.json().catch(() => ({}));
  const message = data.code === 'lot_already_bid' && data.error ? String(data.error) : 'Couldn’t update your watchlist. Please try again.';
  throw new Error(message);
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
    res = await send(`/v1/auctions/lots/${lotId}/bids`, 'POST', { amount }, { 'X-Bid-Surface': 'other', 'X-Bid-Type': type });
  } catch {
    throw new BidError('Network error – the bid may not have been placed. Check the lot before trying again.', 0);
  }
  const data: Raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details: Raw = data.details ?? {};
    const message = (Array.isArray(details.amount) && details.amount[0]) || data.error || bidFailure(res.status);
    throw new BidError(String(message), res.status, data.code ?? null, details.min_next_bid ?? null);
  }
  return {
    isLeading: !!data.is_leading,
    isMaxCollision: !!data.is_max_collision,
    currentPrice: data.current_price ?? null,
    minNextBid: data.min_next_bid ?? null,
    version: data.version ?? null,
  };
}
