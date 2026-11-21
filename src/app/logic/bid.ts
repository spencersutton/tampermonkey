import { dollars } from '../../shared/cost';
import { endsAtMs } from '../../shared/lot';
import type { Lot } from '../types';

export interface BidOutcome {
  isLeading: boolean;
  isMaxCollision: boolean;
  currentPrice: number | null;
  minNextBid: number | null;
  version: number | null;
}

/** Whether the lot can no longer be bid on. */
export const isClosed = (lot: Lot, now = Date.now()) =>
  lot.status !== 'live' || endsAtMs(lot) <= now;

/** Whether you have bid on the lot (winning or not). */
export const hasBidOn = (lot: Lot) => lot.has_bid || lot.your_standing != null;

/** Whether you are currently the high bidder (and the price is still within your max). */
export const isLeading = (lot: Lot) =>
  lot.your_standing?.is_leading &&
  lot.current_price <= (lot.your_standing.your_max_bid ?? Infinity);

/** Amount of a straight bid at the next increment (the API's next minimum bid). */
export const quickBidAmount = (lot: Lot) => Math.max(lot.next_min_increment, lot.current_price);

/** Smallest max bid the site accepts: above your current max when you're winning. */
export function minMaxBid(lot: Lot): number {
  const min = quickBidAmount(lot);
  const mine = lot.your_standing?.your_max_bid;
  return isLeading(lot) && mine != null ? Math.max(mine + 1, min) : min;
}

/** Why bidding is unavailable for this row, or null if it's allowed. */
export function bidBlocker(
  row: { lot: Lot; hidden: boolean; matched: string | null },
  authenticated: boolean,
  now = Date.now(),
): string | null {
  if (row.hidden) {
    return 'Bidding is disabled for hidden lots';
  }
  if (row.matched) {
    return `Bidding is disabled for filtered lots (${row.matched})`;
  }
  if (isClosed(row.lot, now)) {
    return 'This lot has closed';
  }
  if (!authenticated) {
    return 'Log in to bid';
  }
  return null;
}

/** Why the typed max bid can't be used, or null if it's fine (or empty). */
export function maxBidError(text: string, n: number | null, min: number): string | null {
  if (!text.trim()) {
    return null;
  }
  if (n == null) {
    return 'Enter a dollar amount';
  }
  if (!Number.isInteger(n)) {
    return 'Whole dollars only';
  }
  return n < min ? `Must be at least ${dollars(min)}` : null;
}

/** Shorten a title for toast messages. */
export const shortTitle = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

/** Compute the catalog patch to apply after an accepted bid response. */
export function bidOutcomePatch(cur: Lot, amount: number, result: BidOutcome): Partial<Lot> {
  const patch: Partial<Lot> = {
    has_bid: true,
    your_standing: { is_leading: result.isLeading, your_max_bid: amount },
  };
  // Take the new price only if the response is newer than what we have.
  if (result.version != null && result.version > cur.version) {
    patch.version = result.version;
    patch.current_price = result.currentPrice ?? cur.current_price;
    patch.next_min_increment = result.minNextBid ?? cur.next_min_increment;
  }
  return patch;
}

/** Toast kind and text describing an accepted bid outcome. */
export function bidOutcomeMessage(
  lotTitle: string,
  result: Pick<BidOutcome, 'isLeading' | 'isMaxCollision'>,
): { kind: 'good' | 'bad'; text: string } {
  const title = shortTitle(lotTitle);
  if (result.isLeading) {
    return { kind: 'good', text: `Bid placed – you’re winning “${title}”.` };
  }
  if (result.isMaxCollision) {
    return {
      kind: 'bad',
      text: `Another bidder set this max bid first – you’re outbid on “${title}”.`,
    };
  }
  return {
    kind: 'bad',
    text: `Bid placed, but you’re outbid on “${title}” – another bidder’s max is higher.`,
  };
}
