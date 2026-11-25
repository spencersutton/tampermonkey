import { TRANSFER_FEE } from '../../shared/constants';
import { totalCost } from '../../shared/cost';
import { endsAtMs, type Lot } from '../../shared/lot';
import type { ClosedLot } from '../types';
import { makeRow, type Exclusions, type Row } from './view';
import '../../shared/arrayToSet';

export const closedLotKey = (c: ClosedLot) => `${c.auction_period}:${c.lot_id}`;

/** A lot not at the account's pickup location was transferred there for the fee. */
export const closedTransferFee = (c: ClosedLot, pickup: string) =>
  c.location_name === pickup ? 0 : TRANSFER_FEE;

/** A YYYY-MM-DD date as local midnight epoch ms. */
export const collectByDate = (date: string) => new Date(`${date}T00:00`).getTime();

/** Filter closed lots by space-separated search words across title, lot number and location. */
export function filterClosedLots(lots: ClosedLot[], filter: string): ClosedLot[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return lots;
  }
  return lots.filter(c => {
    const hay = `${c.title} ${c.lot_number} ${c.location_name}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

/** Open relisted catalog rows for each closed lot, sorted cheapest total first. */
export function relistedRowsFor(
  closedLots: ClosedLot[],
  catalogLots: ReadonlyMap<number, Lot>,
  now: number,
  pickup: string,
  exclusions: Exclusions,
): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const c of closedLots) {
    const rows = (c.relisted ?? [])
      .map(id => catalogLots.get(id))
      .filter((l): l is Lot => l !== undefined && endsAtMs(l) > now)
      .map(l => makeRow(l, pickup, exclusions))
      .sortBy(r => r.total);
    if (rows.length) {
      out.set(closedLotKey(c), rows);
    }
  }
  return out;
}

/** Sum of final bids and estimated total cost (with fees & tax) for a list of closed lots. */
export function closedTotals(lots: ClosedLot[], pickup: string): { bids: number; total: number } {
  return {
    bids: lots.sumBy(c => c.final_price),
    total: lots.sumBy(c => totalCost(c.final_price, closedTransferFee(c, pickup))),
  };
}
