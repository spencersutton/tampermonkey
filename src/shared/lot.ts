// The site's raw API lots (snake_case) as the camelCase shape the app and the
// tlx server work with. Times are epoch milliseconds, as the server sends them;
// the app turns them into Temporal.Instants (see app/api.ts).
//
// The server's copy is normalize_lot in server/tlx_server/site.py until the
// TypeScript server replaces it; keep them in step. The API isn't ours, so
// every field is treated as possibly missing or malformed.

export interface LotImage {
  thumb: string;
  card: string;
  large: string;
}

export interface Standing {
  isLeading: boolean;
  yourMaxBid: number | null;
}

export interface RawStanding {
  is_leading?: boolean | null;
  your_max_bid?: number | null;
}

/** @see WireLot, which is the normalized version of this. */
export interface RawLot {
  id: number;
  auction_period?: string | null;
  title?: string | null;
  lot_number?: string | null;
  category?: { value: string; label: string } | null;
  condition?: { value: number; display_name: string } | null;
  location?: { id: number; name: string } | null;
  is_transferable?: boolean | null;
  transfer_fee?: number | null;
  current_price?: number | null;
  estimated_retail_price?: number | null;
  ends_at?: string | null;
  status?: string | null;
  version?: number | null;
  bid_count?: number | null;
  next_min_increment?: number | null;
  your_standing?: RawStanding | null;
  is_watchlisted?: boolean | null;
  has_bid?: boolean | null;
  images?:
    | { position?: number | null; image_thumb: string; image_card: string; image_large: string }[]
    | null;
}

/** @see WireLotDetail, which is the normalized version of this. */
export interface RawLotDetail extends RawLot {
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  lot_fee?: number | null;
  bid_history?: { bidder_label: string; amount: number; is_you?: boolean | null }[] | null;
}

/** A lot as the tlx server sends it. */
export interface WireLot {
  id: number;
  auctionPeriod: string;
  title: string;
  lotNumber: string;
  category: { value: string; label: string } | null;
  condition: { value: number; label: string } | null;
  location: { id: number; name: string } | null;
  isTransferable: boolean;
  transferFee: number;
  currentPrice: number;
  estimatedRetailPrice: number | null;
  endsAt: number | null; // epoch ms; null if the API sent no valid time
  status: string;
  version: number;
  bidCount: number;
  nextMinIncrement: number;
  yourStanding: Standing | null;
  isWatchlisted: boolean;
  hasBid: boolean;
  images: LotImage[];
}

export interface WireLotDetail extends WireLot {
  description: string;
  brand: string | null;
  model: string | null;
  lotFee: number | null;
  bidHistory: { bidderLabel: string; amount: number; isYou: boolean }[];
}

/** The value if it is a finite number, else the fallback. */
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** An ISO 8601 timestamp as epoch ms, or null. */
function epochMs(iso: string | null | undefined): number | null {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
}

/** The API's `your_standing` object as a Standing. */
export function normalizeStanding(s: RawStanding | null | undefined): Standing | null {
  return s ? { isLeading: Boolean(s.is_leading), yourMaxBid: s.your_max_bid ?? null } : null;
}

/** A raw API lot as a WireLot. */
export function normalizeLot(r: RawLot): WireLot {
  const { category: cat, condition: cond, location: loc } = r;
  return {
    id: r.id,
    auctionPeriod: r.auction_period ?? '',
    title: r.title ?? '',
    lotNumber: r.lot_number ?? '',
    category: cat ? { value: cat.value, label: cat.label } : null,
    condition: cond ? { value: cond.value, label: cond.display_name } : null,
    location: loc ? { id: loc.id, name: loc.name } : null,
    isTransferable: Boolean(r.is_transferable),
    transferFee: num(r.transfer_fee),
    currentPrice: num(r.current_price),
    estimatedRetailPrice: r.estimated_retail_price ?? null,
    endsAt: epochMs(r.ends_at),
    status: r.status ?? '',
    version: num(r.version, -1),
    bidCount: num(r.bid_count),
    nextMinIncrement: num(r.next_min_increment),
    yourStanding: normalizeStanding(r.your_standing),
    isWatchlisted: Boolean(r.is_watchlisted),
    hasBid: Boolean(r.has_bid),
    images: (r.images ?? [])
      .toSorted((a, b) => num(a.position) - num(b.position))
      .map((i) => ({ thumb: i.image_thumb, card: i.image_card, large: i.image_large })),
  };
}

/** A raw API lot detail as a WireLotDetail (without the site's `similar` lots). */
export function normalizeDetail(r: RawLotDetail): WireLotDetail {
  return {
    ...normalizeLot(r),
    description: r.description ?? '',
    brand: r.brand || null,
    model: r.model || null,
    lotFee: r.lot_fee ?? null,
    bidHistory: (r.bid_history ?? []).map((b) => ({
      bidderLabel: b.bidder_label,
      amount: b.amount,
      isYou: Boolean(b.is_you),
    })),
  };
}
