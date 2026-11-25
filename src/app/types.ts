import type { PastClose, RawLotDetail } from '../shared/lot';

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
  brand?: Nullable<string>; // saved identity, when it has one
  model?: Nullable<string>;
  relisted?: number[] | undefined; // open lots of the same item
}
