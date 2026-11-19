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
  brand: string;
  model: string | null;
  lot_fee: number;
  bid_history: { bidder_label: string; amount: number; is_you: boolean }[];
}

/** When a lot ends, as epoch ms (NaN if it has no valid time). */
export const endsAtMs = (lot: { ends_at?: string | null | undefined }): number =>
  lot.ends_at ? Date.parse(lot.ends_at) : Number.NaN;
