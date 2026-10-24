export interface LotImage {
  thumb: string;
  card: string;
  large: string;
}

export interface Standing {
  isLeading: boolean;
  yourMaxBid: number | null;
}

// Normalized (camelCase) lot from the list endpoint.
export interface Lot {
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
  endsAt: number; // epoch ms
  status: string;
  version: number;
  bidCount: number;
  nextMinIncrement: number;
  yourStanding: Standing | null;
  isWatchlisted: boolean;
  hasBid: boolean;
  images: LotImage[];
  firstSeenAt?: number; // when a full pull first saw this lot (0 = already there on the first pull)
  itemType?: string; // what the item is ("pressure washer"), named by the server's LLM; missing until it has been
  pastCloses?: { n: number; recent: PastClose[] }; // closed lots with the same or a similar name (most recent first); missing if none
}

/** An earlier lot that closed, as the server records them (server/tlx_server/history.py). */
export interface PastClose {
  price: number;
  endsAt: number;
  condition: string | null; // label, e.g. "Like New"
  sold: boolean; // had a winning bid
  final: boolean; // the site's final price; else the last price seen before it closed
}

/** A past close in full, as GET /api/history lists them. */
export interface PastCloseDetail extends PastClose {
  id: number;
  title: string;
  auctionPeriod: string;
  bidCount: number;
  location: string | null;
  category: string | null;
  retail: number | null;
}

export interface BidHistoryEntry {
  bidderLabel: string;
  amount: number;
  isYou: boolean;
}

export interface LotDetail extends Lot {
  description: string;
  brand: string | null;
  model: string | null;
  lotFee: number | null;
  bidHistory: BidHistoryEntry[];
}
