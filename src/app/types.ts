import type { LotImage, RawLotDetail, Standing } from '../shared/lot';

// A lot as the tlx server sends it: the site's fields (snake_case, see RawLot in
// shared/lot.ts) plus the server's own (camelCase).
export interface Lot {
  id: number;
  auction_period: string;
  title: string;
  lot_number: string;
  category: { value: string; label: string } | null;
  condition: { value: number; display_name: string } | null;
  location: { id: number; name: string } | null;
  is_transferable: boolean;
  transfer_fee: number;
  current_price: number;
  estimated_retail_price: number | null;
  ends_at: string; // ISO 8601
  status: string;
  version: number;
  bid_count: number;
  next_min_increment: number;
  your_standing: Standing | null;
  is_watchlisted: boolean;
  has_bid: boolean;
  images: LotImage[];
  brand?: string | null | undefined; // server-cached detail; absent until fetched, null when no brand is provided
  model?: string | null | undefined; // same cache semantics as brand
  firstSeenAt?: number | undefined; // epoch ms when a full pull first saw this lot (0 = already there on the first pull)
  tags?: string[] | undefined; // labels beyond the item type; "name: value" ones are attributes (see shared/tags.ts)
  itemType?: string | undefined; // what the item is ("pressure washer"), named by the LLM or corrected manually; missing until assigned
  pastCloses?: { n: number; recent: PastClose[] } | undefined; // closed lots with the same or a similar name (most recent first); missing if none
  groupId?: number | undefined; // set by the server on lots that list the same item as another open lot (any condition when brand and model match, else the same one): the smallest id among them
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

/** A past close in full, as GET /api/history lists them. */
export interface PastCloseDetail extends PastClose {
  title: string;
  auctionPeriod: string;
  bidCount: number;
  location: string | null;
  category: string | null;
  retail: number | null;
}

/** Reusable item metadata, kept separately from prices, bids and account state. */
export interface LotMetadata {
  description: string;
  brand: string | null;
  model: string | null;
  lot_fee: number | null;
  images?: LotImage[] | undefined; // older server cache entries may not have saved images
}

export interface LotDetail extends Lot {
  description: string;
  brand: string | null;
  model: string | null;
  lot_fee: number | null;
  bid_history: RawLotDetail['bid_history'];
  similar: Lot[]; // the site's "Similar Auctions" for this lot
}

/** A lot you won or lost, as the site's control panel (Closed Auctions) lists it. */
export interface ClosedLot {
  lot_id: number;
  auction_period: string;
  title: string;
  lot_number: string;
  location_name: string;
  final_price: number;
  hero_image: string | null; // path on the CDN
  // Added by the tlx server's proxy:
  brand?: string | null | undefined; // saved identity, when it has one
  model?: string | null | undefined;
  relisted?: number[] | undefined; // open lots of the same item
}
