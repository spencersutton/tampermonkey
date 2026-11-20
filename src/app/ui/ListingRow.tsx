import { costBreakdown, dollars, money } from '../../shared/cost';
import { endsAtMs } from '../../shared/lot';
import { plural } from '../logic/util';
import type { Row } from '../logic/view';
import type { Lot } from '../types';
import { LocationText, TimeLeft } from './LotCard';

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
        <span class="price" title={costBreakdown(lot.current_price, row.transferFee)}>
          {dollars(lot.current_price)} <span class="muted small">≈ {money(row.total)}</span>
        </span>
        <span class="muted small">
          {lot.title !== currentTitle && <span class="dupe-title">{lot.title}</span>}
          {showCondition && <>{lot.condition.display_name} · </>}
          <LocationText row={row} /> · {plural(lot.bid_count, 'bid')}
        </span>
        <TimeLeft endsAt={endsAtMs(lot)} />
      </button>
    </li>
  );
}
