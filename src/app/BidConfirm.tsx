// Confirmation step for every bid: amount, estimated total cost if won, and a
// warning when the lot isn't at your pickup location.
import { useRef, useState } from 'preact/hooks';
import { costBreakdown, dollars, money, totalCost } from '../shared/cost';
import { bidBlocker, minMaxBid, quickBidAmount, submitBid, useBidPending, type BidRequest } from './bid';
import { useAuthed } from './auth';
import { TimeLeft } from './LotCard';
import { plural, useDialog, useNow } from './util';
import type { Row } from './view';

interface Props {
  req: BidRequest;
  row: Row; // kept current by the caller, so live price changes show up here
  pickup: string;
  onClose: () => void;
}

/** Dialog that shows the bid amount and estimated total and sends the bid only on confirm. */
export function BidConfirm({ req, row, pickup, onClose }: Props) {
  const { lot } = row;
  const [amount, setAmount] = useState(req.amount);
  const pending = useBidPending(lot.id);
  useAuthed();
  const now = useNow(1000);
  const okBtn = useRef<HTMLButtonElement>(null);

  // Capture phase, so Escape closes only this dialog and not the lot popup beneath it.
  useDialog(
    okBtn,
    (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    },
    true,
  );

  const isMax = req.type === 'max_bid';
  const blocker = bidBlocker(row, now);
  // The price can move while this is open; never send an amount the site would now reject.
  const min = isMax ? minMaxBid(lot) : quickBidAmount(lot);
  const stale = amount < min;
  const disabled = pending || !!blocker || stale;
  // Only shown when the lot isn't at your pickup location.
  const elsewhere = lot.location?.name;

  const confirm = async () => {
    if (!disabled && (await submitBid({ ...req, amount }))) {
      onClose();
    }
  };

  return (
    <div class="backdrop backdrop-top" onMouseDown={(e) => e.target === e.currentTarget && !pending && onClose()}>
      <div class="confirm" role="alertdialog" aria-modal="true" aria-labelledby="bid-confirm-title" aria-describedby="bid-confirm-body">
        <h2 id="bid-confirm-title">{isMax ? 'Confirm max bid' : 'Confirm bid'}</h2>
        <div id="bid-confirm-body" class="confirm-body">
          <p class="confirm-lot">{lot.title}</p>
          <div class="confirm-amount">
            <span class="big">{dollars(amount)}</span>
            <span class="muted small">
              {isMax ? 'Max bid – the site bids for you, only as much as needed, up to this amount' : 'Bid at the next increment'}
            </span>
          </div>
          <dl class="confirm-facts">
            <dt>{isMax ? 'Total if you win at your max' : 'Total if you win at this bid'}</dt>
            <dd title={costBreakdown(amount, row.transferFee)}>≈ {money(totalCost(amount, row.transferFee))}</dd>
            <dt>Current bid</dt>
            <dd>
              {dollars(lot.currentPrice)} · {plural(lot.bidCount, 'bid')}
            </dd>
            <dt>Ends</dt>
            <dd>
              <TimeLeft endsAt={lot.endsAt} />
            </dd>
            {lot.yourStanding?.yourMaxBid != null && (
              <>
                <dt>Your current max</dt>
                <dd>{dollars(lot.yourStanding.yourMaxBid)}</dd>
              </>
            )}
          </dl>
          {row.pickupOnly && (
            <p class="confirm-warn">
              Pickup only at <b>{elsewhere}</b> – this lot can’t be transferred to {pickup}.
            </p>
          )}
          {!row.pickupOnly && row.transferFee > 0 && (
            <p class="confirm-warn">
              This lot is at <b>{elsewhere}</b>. It will be transferred to {pickup} for {money(row.transferFee)} (included in the total).
            </p>
          )}
          {blocker && <p class="error">{blocker}</p>}
          {!blocker && stale && (
            <p class="confirm-warn">
              The price moved: the {isMax ? 'smallest max bid' : 'next bid'} is now <b>{dollars(min)}</b>.{' '}
              <button type="button" class="btn-text" onClick={() => setAmount(min)}>
                Use {dollars(min)}
              </button>
            </p>
          )}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button type="button" class="btn" ref={okBtn} onClick={confirm} aria-disabled={disabled ? 'true' : undefined}>
            {pending ? 'Placing bid…' : `Place ${dollars(amount)} bid`}
          </button>
        </div>
      </div>
    </div>
  );
}
