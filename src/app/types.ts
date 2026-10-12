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
