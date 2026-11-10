// Thin client for the site's JSON API, proxied by the tlx server, which adds
// its login token (see auth.tsx), so lots include account fields like your
// standing and watchlist state.
import { authedFetch, isAuthenticated } from './auth';
import type { ClosedLot, Lot, LotDetail, LotMetadata, Standing } from './types';

/** Prefix for the site's API (proxied on the same origin by the tlx server). */
const BASE = '/backend';
/** Host serving lot images. */
export const CDN = 'https://cdn.triangleliquidators.com';

const LOGGED_OUT = 'You’re logged out. Log in, then try again.';

/** GET a JSON endpoint. */
async function get<T>(path: string, signal?: AbortSignal, prefix = BASE): Promise<T> {
  const res = await authedFetch(prefix + path, { headers: { Accept: 'application/json' }, ...(signal === undefined ? {} : { signal }) });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText || 'error'} for ${path}`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return res.json() as Promise<T>;
}

/** Send a state-changing request with the headers the site's own client uses. */
function send(path: string, method: 'POST' | 'DELETE', body?: unknown, headers: Record<string, string> = {}) {
  const json: Record<string, string> = body === undefined ? {} : { 'Content-Type': 'application/json' };
  return authedFetch(`${BASE}${path}`, {
    method,
    headers: { Accept: 'application/json', ...json, 'X-CSRF-Protection': '1', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export interface RawStanding {
  is_leading: boolean;
  your_max_bid: number | null;
}

/** 
 * @see Lot, which is the normalized version of this.
 */
interface RawLot {
  id: number;
  auction_period: string;
  title?: string | null;
  lot_number?: string | null;
  category: { value: string; label: string } | null;
  condition: { value: number; display_name: string } | null;
  location: { id: number; name: string } | null;
  is_transferable: boolean;
  transfer_fee?: number | null;
  current_price?: number | null;
  estimated_retail_price: number | null;
  ends_at: string;
  status: string;
  version?: number | null;
  bid_count?: number | null;
  next_min_increment?: number | null;
  your_standing: RawStanding | null;
  is_watchlisted: boolean;
  has_bid: boolean;
  images?: { position: number; image_thumb: string; image_card: string; image_large: string }[] | null;
}

/**
 * @see LotDetail, which is the normalized version of this.
 */
interface RawLotDetail extends RawLot {
  description?: string | null;
  brand: string | null;
  model: string | null;
  lot_fee: number | null;
  bid_history?: { bidder_label: string; amount: number; is_you: boolean }[] | null;
  similar?: RawLot[] | null;
}

/**
 * @see ClosedLot, which is the normalized version of this.
 */
interface RawClosedLot {
  lot_id: number;
  auction_period?: string | null;
  title?: string | null;
  lot_number?: string | null;
  location_name?: string | null;
  final_price?: number | null;
  hero_image: string | null;
  brand?: string | null;
  model?: string | null;
}

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

/** Convert the API's `your_standing` object (snake_case) into a Standing. */
export function normalizeStanding(s: RawStanding | null | undefined): Standing | null {
  return s ? { isLeading: s.is_leading, yourMaxBid: s.your_max_bid ?? null } : null;
}

/** Convert a raw API lot (snake_case) into a Lot. */
export function normalizeLot(r: RawLot): Lot {
  return {
    id: r.id,
    auctionPeriod: r.auction_period,
    title: r.title ?? '',
    lotNumber: r.lot_number ?? '',
    category: r.category ? { value: r.category.value, label: r.category.label } : null,
    condition: r.condition ? { value: r.condition.value, label: r.condition.display_name } : null,
    location: r.location ? { id: r.location.id, name: r.location.name } : null,
    isTransferable: r.is_transferable,
    transferFee: r.transfer_fee ?? 0,
    currentPrice: r.current_price ?? 0,
    estimatedRetailPrice: r.estimated_retail_price ?? null,
    endsAt: Temporal.Instant.from(r.ends_at),
    status: r.status,
    version: r.version ?? -1,
    bidCount: r.bid_count ?? 0,
    nextMinIncrement: r.next_min_increment ?? 0,
    yourStanding: normalizeStanding(r.your_standing),
    isWatchlisted: r.is_watchlisted,
    hasBid: r.has_bid,
    images: (r.images ?? [])
      .toSorted((a, b) => a.position - b.position)
      .map((i) => ({ thumb: i.image_thumb, card: i.image_card, large: i.image_large })),
  };
}

/** Fetch one lot's full detail: description, brand/model, bid history and the site's similar lots. */
export async function fetchLotDetail(auctionPeriod: string, id: number, signal?: AbortSignal): Promise<LotDetail> {
  const r = await get<RawLotDetail>(`/v1/auctions/lots/${auctionPeriod}/${id}/`, signal);
  return {
    ...normalizeLot(r),
    description: r.description ?? '',
    brand: r.brand || null,
    model: r.model || null,
    lotFee: r.lot_fee ?? null,
    bidHistory: (r.bid_history ?? []).map((b) => ({ bidderLabel: b.bidder_label, amount: b.amount, isYou: b.is_you })),
    similar: (r.similar ?? []).map(normalizeLot),
  };
}

/** Read persisted item metadata without asking the site or returning stale auction state. */
export async function fetchLotMetadata(auctionPeriod: string, id: number): Promise<LotMetadata | null> {
  const query = new URLSearchParams({ id: String(id), auctionPeriod });
  const reply = await get<{ metadata: LotMetadata | null }>(`/api/lot-metadata?${query}`, undefined, '');
  return reply.metadata;
}

/** Closed lots you won or lost, as the site's control panel lists them. */
export type ClosedSection = 'won' | 'lost';

/** Fetch every closed lot in a section, most recent first, calling `onPage` with the list so far as pages arrive. */
export async function fetchClosed(section: ClosedSection, onPage: (lots: ClosedLot[], count: number) => void, signal?: AbortSignal): Promise<ClosedLot[]> {
  const out: ClosedLot[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    const d = await get<{ count: number; results: RawClosedLot[] }>(`/v1/auctions/control-panel/closed/${section}/?page=${page}&per_page=100`, signal);
    for (const r of d.results) {
      const lot = normalizeClosed(r);
      // Pages can shift while we walk them; the site dedupes the same way.
      if (!seen.has(`${lot.auctionPeriod}:${lot.lotId}`)) {
        seen.add(`${lot.auctionPeriod}:${lot.lotId}`);
        out.push(lot);
      }
    }
    onPage([...out], d.count);
    if (!d.results.length || out.length >= d.count) {
      return out;
    }
  }
}

function normalizeClosed(r: RawClosedLot): ClosedLot {
  return {
    lotId: r.lot_id,
    auctionPeriod: r.auction_period ?? '',
    title: r.title ?? '',
    lotNumber: r.lot_number ?? '',
    locationName: r.location_name ?? null,
    finalPrice: r.final_price ?? 0,
    heroImage: r.hero_image ?? null,
    ...(r.brand !== undefined ? { brand: r.brand } : {}),
    ...(r.model !== undefined ? { model: r.model } : {}),
  };
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
  return (d.conditions ?? []).map((c) => ({ value: c.value, label: c.label, description: c.description }));
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
  const data: RawBidResponse = await res.json().catch(() => ({}));
  const message = data.code === 'lot_already_bid' && data.error ? data.error : 'Couldn’t update your watchlist. Please try again.';
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
  const data: RawBidResponse = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = data.details ?? {};
    const message = (Array.isArray(details.amount) && details.amount[0]) || data.error || bidFailure(res.status);
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
