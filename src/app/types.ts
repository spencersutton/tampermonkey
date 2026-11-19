import type { RawLot, RawLotDetail } from '../shared/lot';

// A lot as the tlx server sends it: the site's fields (snake_case, see RawLot in
// shared/lot.ts) plus the server's own (camelCase).
export interface Lot extends RawLot {
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

export interface LotDetail extends RawLotDetail, Omit<Lot, keyof RawLotDetail> {
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
  user_id: number;
  fulfillment_status?: string; // won lots only; "Picked Up" in every capture
  collect_by_date?: string | null; // won lots only; YYYY-MM-DD
  // Added by the tlx server's proxy:
  brand?: string | null | undefined; // saved identity, when it has one
  model?: string | null | undefined;
  relisted?: number[] | undefined; // open lots of the same item
}
