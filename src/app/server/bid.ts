// Placing bids from /tlx. Every bid goes through BidConfirm first; this
// module sends it and folds the result back into the catalog, the same way
// the site's own bid buttons update their state.
import { bidOutcomeMessage, bidOutcomePatch, isLeading } from '../logic/bid';
import { errorMessage } from '../logic/util';
import { BidError, placeBid, type BidType } from './api';
import { getLot, invalidateDetail, updateLot } from './catalog';
import { observableSet } from './reactive';
import { toast } from './toast';

export interface BidRequest {
  lotId: number;
  amount: number;
  type: BidType;
}

// Lots with a bid in flight (one at a time per lot, across all bid buttons).
const pending = observableSet<number>();

/** Whether a bid on this lot is in flight. */
export const bidPending = (lotId: number) => pending.has(lotId);

/** Send a confirmed bid. Resolves true if the site accepted it (winning or not). */
export async function submitBid({ lotId, amount, type }: BidRequest): Promise<boolean> {
  const lot = getLot(lotId);
  if (!lot || pending.has(lotId)) {
    return false;
  }
  if (isLeading(lot) && amount === lot.your_standing?.your_max_bid) {
    toast('info', 'Your max bid is already set to this amount.');
    return false;
  }
  pending.add(lotId);
  try {
    const r = await placeBid(lotId, amount, type);
    const cur = getLot(lotId) ?? lot;
    updateLot(lotId, bidOutcomePatch(cur, amount, r), { force: true });
    invalidateDetail(lotId);
    const msg = bidOutcomeMessage(lot.title, r);
    toast(msg.kind, msg.text);
    return true;
  } catch (e) {
    const err = e instanceof BidError ? e : new BidError(errorMessage(e) || String(e), 0);
    if (err.status === 409) {
      updateLot(lotId, { status: 'closed' }, { force: true });
    }
    if (err.status === 422 && err.code === 'bid_too_low' && err.minNextBid != null) {
      updateLot(lotId, { next_min_increment: err.minNextBid }, { force: true });
    }
    invalidateDetail(lotId);
    toast('bad', err.message);
    return false;
  } finally {
    pending.delete(lotId);
  }
}
