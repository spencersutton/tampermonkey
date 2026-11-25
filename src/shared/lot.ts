// Lots as the site's API sends them (snake_case). The tlx server stores and
// passes them on in this shape, and the app works with it directly.
//
// The types declare what the captured responses in tests/fixtures/site show:
// every field present, and null only where a capture had one.

export interface LotImage {
  position: number;
  image_thumb: string;
  image_card: string;
  image_large: string;
}

export interface Standing {
  is_leading: boolean;
  your_max_bid: number | null;
}

export interface RawLot {
  id: number;
  auction_period: string;
  title: string;
  lot_number: string;
  category: { value: string; label: string };
  condition: { value: number; display_name: string };
  location: { id: number; name: string };
  is_transferable: boolean;
  transfer_fee: number;
  current_price: number;
  estimated_retail_price: number;
  ends_at: string; // ISO 8601
  status: string;
  version: number;
  bid_count: number;
  next_min_increment: number;
  your_standing: Standing | null; // null when logged out
  is_watchlisted: boolean;
  has_bid: boolean;
  images: LotImage[];
}

/** An earlier lot that closed, as the server records them (src/server/history.ts). */
export interface PastClose {
  id: number;
  price: number;
  endsAt: number; // epoch ms
  condition: string | null; // label, e.g. "Like New"
  sold: boolean; // had a winning bid
  final: boolean; // the site's final price; else the last price seen before it closed
}

/**
 * A lot as the tlx server stores it and sends it to the app: the site's fields (snake_case, see
 * RawLot) plus the server's own (camelCase).
 */
export interface Lot extends RawLot {
  brand?: Nullable<string>; // server-cached detail; absent until fetched, null when no brand is provided
  model?: Nullable<string>; // same cache semantics as brand
  firstSeenAt?: number | undefined; // epoch ms when a full pull first saw this lot (0 = already there on the first pull)
  itemType?: string | undefined; // what the item is ("pressure washer"), named by the LLM or corrected manually; missing until assigned
  pastCloses?: { n: number; recent: PastClose[] } | undefined; // closed lots with the same or a similar name (most recent first); missing if none
  groupId?: number | undefined; // set by the server on lots that list the same item as another open lot (any condition when brand and model match, else the same one): the smallest id among them
}

export interface RawLotDetail extends RawLot {
  description: string;
  brand: string | null;
  model: string | null;
  lot_fee: number;
  bid_history: { bidder_label: string; amount: number; is_you: boolean }[];
  similar: RawLot[]; // the site's "Similar Auctions"
}

/** Reusable item metadata, kept separately from prices, bids and account state. */
export interface LotMetadata {
  description: string;
  quantity?: number | null | undefined;
  brand: string | null;
  model: string | null;
  lot_fee: number | null;
  images?: LotImage[] | undefined; // older server cache entries may not have saved images
}

const LEADING_QUANTITY = /^\s*Quantity:\s*(\d+),?\s*/i;
const TRAILING_LOT_META = /(?:^|\s+)Lot Number:[^\r\n]*(?:\r?\nBrand:[^\r\n]*)?\s*$/i;
const TRAILING_BRAND = /(?:^|\s+)Brand:[^\r\n]*\s*$/i;

/**
 * Strip the site's boilerplate `Quantity: <n>,` prefix and trailing `Lot Number:` / `Brand:` lines
 * from a lot description, returning the cleaned description and parsed quantity.
 */
export function parseLotDescription(description: string | null | undefined): {
  description: string | null;
  quantity: number | null;
} {
  if (description == null) {
    return { description: null, quantity: null };
  }
  let text = description;
  let quantity: number | null = null;
  const m = LEADING_QUANTITY.exec(text);
  if (m) {
    quantity = Number.parseInt(m[1]!, 10);
    text = text.slice(m[0].length);
  }
  text = text.replace(TRAILING_LOT_META, '').replace(TRAILING_BRAND, '');
  return { description: text, quantity };
}

/** When a lot ends, as epoch ms (NaN if it has no valid time). */
export const endsAtMs = (lot: { ends_at?: Nullable<string> }): number =>
  lot.ends_at ? Date.parse(lot.ends_at) : Number.NaN;
