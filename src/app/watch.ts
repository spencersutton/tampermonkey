// Watchlist toggling, same request and rules as the site's star button.
import { setWatchlisted } from './api';
import { isAuthenticated } from './auth';
import { hasBidOn } from './bid';
import { getLot, updateLot } from './catalog';
import { toast } from './toast';
import type { Lot } from './types';
import { observableSet } from './util';

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
  const on = !lot.isWatchlisted;
  pending.add(lotId);
  // Optimistic, like the site; reverted if the request fails.
  updateLot(lotId, { isWatchlisted: on }, { force: true });
  try {
    await setWatchlisted(lot.auctionPeriod, lotId, on);
  } catch (e) {
    updateLot(lotId, { isWatchlisted: !on }, { force: true });
    toast('bad', (e as Error).message);
  } finally {
    pending.delete(lotId);
  }
}
