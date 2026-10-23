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
