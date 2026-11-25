// Watchlist toggling, same request and rules as the site's star button.
import { hasBidOn } from '../logic/bid';
import { errorMessage } from '../logic/util';
import { setWatchlisted } from './api';
import { isAuthenticated } from './auth';
import { getLot, updateLot } from './catalog';
import { observableSet } from './reactive';
import { toast } from './toast';

/** The site hides the watchlist button once you've bid on a lot. */
export const canWatch = (lot: Lot) => isAuthenticated() && !hasBidOn(lot);

/** Lots with a watchlist request in flight. */
const pending = observableSet<number>();

/** Whether a watchlist toggle for this lot is in flight. */
export const watchPending = (lotId: number) => pending.has(lotId);

/** Add the lot to, or remove it from, the watchlist; shows a toast if it fails. */
export async function toggleWatch(lotId: number) {
  const lot = getLot(lotId);
  if (!lot || pending.has(lotId)) {
    return;
  }
  const on = !lot.is_watchlisted;
  pending.add(lotId);
  // Optimistic, like the site; reverted if the request fails.
  updateLot(lotId, { is_watchlisted: on }, { force: true });
  try {
    await setWatchlisted(lot.auction_period, lotId, on);
  } catch (e) {
    updateLot(lotId, { is_watchlisted: !on }, { force: true });
    toast('bad', errorMessage(e));
  } finally {
    pending.delete(lotId);
  }
}
