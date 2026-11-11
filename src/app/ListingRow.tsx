import { costBreakdown, dollars, money } from '../shared/cost';
import { LocationText, TimeLeft } from './LotCard';
import type { Lot } from './types';
import { plural } from './util';
import type { Row } from './view';

interface Props {
  row: Row;
  currentTitle: string;
  selected?: boolean;
  showCondition?: boolean;
  onOpen: (lot: Lot) => void;
}

/** A matching listing in a lot's group or a closed lot's relisted items. */
export function ListingRow({ row, currentTitle, selected, showCondition = false, onOpen }: Props) {
  const { lot } = row;
  const selectedClass = selected ? 'on' : '';
  return (
    <li>
      <button
        type="button"
        class={selected == null ? undefined : selectedClass}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(lot)}
      >
        <span class="price" title={costBreakdown(lot.currentPrice, row.transferFee)}>
          {dollars(lot.currentPrice)} <span class="muted small">≈ {money(row.total)}</span>
        </span>
        <span class="muted small">
          {lot.title !== currentTitle && <span class="dupe-title">{lot.title}</span>}
          {showCondition && <>{lot.condition?.label ?? 'Unknown'} · </>}
          <LocationText row={row} /> · {plural(lot.bidCount, 'bid')}
        </span>
        <TimeLeft endsAt={lot.endsAt} />
      </button>
    </li>
  );
}
