// Placing bids from /tlx. Every bid goes through BidConfirm first; this
// module sends it and folds the result back into the catalog, the same way
// the site's own bid buttons update their state.
import { useEffect, useState } from 'preact/hooks';
import { BidError, isAuthenticated, placeBid, type BidType } from './api';
import { getLot, invalidateDetail, updateLot } from './catalog';
import { toast } from './toast';
import type { Lot } from './types';
import type { Row } from './view';

export type { BidType };

export interface BidRequest {
  lotId: number;
  amount: number;
  type: BidType;
}

export const isClosed = (lot: Lot, now = Date.now()) => lot.status !== 'live' || lot.endsAt <= now;
export const isLeading = (lot: Lot) => !!lot.yourStanding?.isLeading && lot.currentPrice <= (lot.yourStanding.yourMaxBid ?? Infinity);

/** Amount of a straight bid at the next increment (the API's next minimum bid). */
export const quickBidAmount = (lot: Lot) => Math.max(lot.nextMinIncrement, lot.currentPrice);

/** Smallest max bid the site accepts: above your current max when you're winning. */
export function minMaxBid(lot: Lot): number {
  const min = quickBidAmount(lot);
  const mine = lot.yourStanding?.yourMaxBid;
  return isLeading(lot) && mine != null ? Math.max(mine + 1, min) : min;
}

/** Why bidding is unavailable for this row, or null if it's allowed. */
export function bidBlocker(row: Row, now = Date.now()): string | null {
  if (row.hidden) return 'Bidding is disabled for hidden lots';
  if (row.matched) return `Bidding is disabled for filtered lots (${row.matched})`;
  if (isClosed(row.lot, now)) return 'This lot has closed';
  if (!isAuthenticated()) return 'Log in on the site to bid';
  return null;
}

// Lots with a bid in flight (one at a time per lot, across all bid buttons).
const pending = new Set<number>();
const pendingSubs = new Set<() => void>();
const pendingChanged = () => pendingSubs.forEach((f) => f());

export function useBidPending(lotId: number): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    pendingSubs.add(f);
    return () => void pendingSubs.delete(f);
  }, []);
  return pending.has(lotId);
}

/** Send a confirmed bid. Resolves true if the site accepted it (winning or not). */
export async function submitBid({ lotId, amount, type }: BidRequest): Promise<boolean> {
  const lot = getLot(lotId);
  if (!lot || pending.has(lotId)) return false;
  if (isLeading(lot) && amount === lot.yourStanding?.yourMaxBid) {
    toast('info', 'Your max bid is already set to this amount.');
    return false;
  }
  pending.add(lotId);
  pendingChanged();
  try {
    const r = await placeBid(lotId, amount, type);
    const cur = getLot(lotId) ?? lot;
    const patch: Partial<Lot> = { hasBid: true, yourStanding: { isLeading: r.isLeading, yourMaxBid: amount } };
    if (r.version != null && r.version > cur.version) {
      patch.version = r.version;
      if (r.currentPrice != null) patch.currentPrice = r.currentPrice;
      if (r.minNextBid != null) patch.nextMinIncrement = r.minNextBid;
    }
    updateLot(lotId, patch, { force: true });
    invalidateDetail(lotId);
    if (r.isLeading) toast('good', `Bid placed – you’re winning “${short(lot.title)}”.`);
    else if (r.isMaxCollision) toast('bad', `Another bidder set this max bid first – you’re outbid on “${short(lot.title)}”.`);
    else toast('bad', `Bid placed, but you’re outbid on “${short(lot.title)}” – another bidder’s max is higher.`);
    return true;
  } catch (e) {
    const err = e instanceof BidError ? e : new BidError((e as Error).message || String(e), 0);
    if (err.status === 409) updateLot(lotId, { status: 'closed' }, { force: true });
    if (err.status === 422 && err.code === 'bid_too_low' && err.minNextBid != null)
      updateLot(lotId, { nextMinIncrement: err.minNextBid }, { force: true });
    invalidateDetail(lotId);
    toast('bad', err.message);
    return false;
  } finally {
    pending.delete(lotId);
    pendingChanged();
  }
}

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
