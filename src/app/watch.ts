// Watchlist toggling, same request and rules as the site's star button.
import { useEffect, useState } from 'preact/hooks';
import { isAuthenticated, setWatchlisted } from './api';
import { getLot, updateLot } from './catalog';
import { toast } from './toast';
import type { Lot } from './types';

/** The site hides the watchlist button once you've bid on a lot. */
export const canWatch = (lot: Lot) => isAuthenticated() && !lot.hasBid && !lot.yourStanding;

const pending = new Set<number>();
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

export function useWatchPending(lotId: number): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => void subs.delete(f);
  }, []);
  return pending.has(lotId);
}

export async function toggleWatch(lotId: number) {
  const lot = getLot(lotId);
  if (!lot || pending.has(lotId)) return;
  const on = !lot.isWatchlisted;
  pending.add(lotId);
  // Optimistic, like the site; reverted if the request fails.
  updateLot(lotId, { isWatchlisted: on }, { force: true });
  changed();
  try {
    await setWatchlisted(lot.auctionPeriod, lotId, on);
  } catch (e) {
    updateLot(lotId, { isWatchlisted: !on }, { force: true });
    toast('bad', (e as Error).message);
  } finally {
    pending.delete(lotId);
    changed();
  }
}
