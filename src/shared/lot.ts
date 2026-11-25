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

export interface RawLotDetail extends RawLot {
  description: string;
  brand: string | null;
  model: string | null;
  lot_fee: number;
  bid_history: { bidder_label: string; amount: number; is_you: boolean }[];
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

/** Strip a leading `Quantity: <n>,` from a lot description and return the parsed quantity. */
export function extractQuantity(description: string | null | undefined): {
  description: string | null;
  quantity: number | null;
} {
  if (description == null) {
    return { description: null, quantity: null };
  }
  const m = LEADING_QUANTITY.exec(description);
  if (!m) {
    return { description, quantity: null };
  }
  return {
    description: description.slice(m[0].length),
    quantity: Number.parseInt(m[1]!, 10),
  };
}

/** When a lot ends, as epoch ms (NaN if it has no valid time). */
export const endsAtMs = (lot: { ends_at?: Nullable<string> }): number =>
  lot.ends_at ? Date.parse(lot.ends_at) : Number.NaN;
