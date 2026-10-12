// Thin client for the site's JSON API. Requests carry the same bearer token
// the site's own client sends (from its readable `token` cookie), so lots
// include account fields like your standing and watchlist state.
import type { BidHistoryEntry, Lot, LotDetail, LotImage, Standing } from './types';

const BASE = '/backend';
export const CDN = 'https://cdn.triangleliquidators.com';
export const LIST_PAGE_SIZE = 100; // the API's maximum per_page

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function authToken(): string | null {
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === 'token') return decodeURIComponent(v.join('=')) || null;
  }
  return null;
}

// Set once a request with the token is rejected, so we stop sending it.
let tokenRejected = false;
export const isAuthenticated = () => !tokenRejected && authToken() !== null;

async function get<T>(path: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;
  const send = (withToken: boolean) => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = withToken ? authToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, { headers, signal, credentials: 'same-origin' });
  };
  let res = await send(isAuthenticated());
  if (res.status === 401 && isAuthenticated()) {
    // Expired session: fall back to anonymous data rather than failing.
    tokenRejected = true;
    res = await send(false);
  }
  if (!res.ok) throw new ApiError(`${res.status} ${res.statusText || 'error'} for ${path}`, res.status);
  return res.json() as Promise<T>;
}

type Raw = Record<string, any>;

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function normalizeStanding(s: Raw | null | undefined): Standing | null {
  if (!s || typeof s !== 'object') return null;
  return { isLeading: !!s.is_leading, yourMaxBid: s.your_max_bid ?? null };
}

function normalizeImages(images: Raw[] | undefined): LotImage[] {
  return [...(images || [])]
    .sort((a, b) => num(a.position) - num(b.position))
    .map((i) => ({ thumb: i.image_thumb, card: i.image_card, large: i.image_large }));
}

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
  const d = await get<{ count: number; results: Raw[] }>(
    '/v1/auctions/lots/',
    { page, per_page: LIST_PAGE_SIZE, order_by: 'newly-listed' },
    signal,
  );
  return { count: d.count, results: d.results.map(normalizeLot) };
}

export async function fetchLotDetail(auctionPeriod: string, id: number, signal?: AbortSignal): Promise<LotDetail> {
  const r = await get<Raw>(`/v1/auctions/lots/${auctionPeriod}/${id}/`, {}, signal);
  return {
    ...normalizeLot(r),
    description: String(r.description ?? ''),
    brand: r.brand || null,
    model: r.model || null,
    lotFee: r.lot_fee ?? null,
    bidHistory: (r.bid_history || []).map(
      (b: Raw): BidHistoryEntry => ({ bidderLabel: b.bidder_label, amount: num(b.amount), isYou: !!b.is_you }),
    ),
  };
}

export interface PickupLocation {
  id: number | null;
  name: string | null;
}

export async function fetchPickupLocation(): Promise<PickupLocation | null> {
  const me = await get<Raw>('/v1/auth/me/');
  const p = me.pickup_location;
  if (!p) return null;
  return { id: typeof p.id === 'number' ? p.id : null, name: p.name || p.label || null };
}

export async function fetchWsToken(): Promise<string> {
  const d = await get<{ token: string }>('/v1/auth/ws-token/');
  return d.token;
}
