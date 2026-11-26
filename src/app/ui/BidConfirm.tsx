// Confirmation step for every bid: amount, estimated total cost if won, and a
// warning when the lot isn't at your pickup location.
import { useState } from 'preact/hooks';

import { costBreakdown, totalCost } from '../../shared/cost';
import * as format from '../../shared/format';
import { endsAtMs } from '../../shared/lot';
import { bidBlocker, minMaxBid, quickBidAmount } from '../logic/bid';
import type { Row } from '../logic/view';
import { isAuthenticated } from '../server/auth';
import { bidPending, submitBid, type BidRequest } from '../server/bid';
import { clock } from '../server/reactive';
import { Dialog } from './Dialog';
import { TimeLeft } from './LotCard';

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
  const pending = bidPending(lot.id);
  const now = clock();

  const isMax = req.type === 'max_bid';
  const blocker = bidBlocker(row, isAuthenticated(), now);
  // The price can move while this is open; never send an amount the site would now reject.
  const min = isMax ? minMaxBid(lot) : quickBidAmount(lot);
  const stale = amount < min;
  const disabled = pending || blocker != null || stale;
  // Only shown when the lot isn't at your pickup location.
  const elsewhere = lot.location.name;

  const confirm = async () => {
    if (!disabled && (await submitBid({ ...req, amount }))) {
      onClose();
    }
  };

  let bidHint = 'Bid at the next increment';
  if (isMax) {
    bidHint = 'Max bid – the site bids for you, only as much as needed, up to this amount';
  }
  return (
    <Dialog
      onClose={() => !pending && onClose()}
      role="alertdialog"
      aria-labelledby="bid-confirm-title"
      aria-describedby="bid-confirm-body"
    >
      <div class="confirm">
        <h2 id="bid-confirm-title">{isMax ? 'Confirm max bid' : 'Confirm bid'}</h2>
        <div id="bid-confirm-body" class="confirm-body">
          <p class="confirm-lot">{lot.title}</p>
          <div class="confirm-amount">
            <span class="big">{format.dollars(amount)}</span>
            <span class="muted small">{bidHint}</span>
          </div>
          <dl class="confirm-facts">
            <dt>{isMax ? 'Total if you win at your max' : 'Total if you win at this bid'}</dt>
            <dd title={costBreakdown(amount, row.transferFee)}>
              ≈ {format.money(totalCost(amount, row.transferFee))}
            </dd>
            <dt>Current bid</dt>
            <dd>
              {format.dollars(lot.current_price)} · {format.plural(lot.bid_count, 'bid')}
            </dd>
            <dt>Ends</dt>
            <dd>
              <TimeLeft endsAt={endsAtMs(lot)} />
            </dd>
            {lot.your_standing?.your_max_bid != null && (
              <>
                <dt>Your current max</dt>
                <dd>{format.dollars(lot.your_standing.your_max_bid)}</dd>
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
              This lot is at <b>{elsewhere}</b>. It will be transferred to {pickup} for{' '}
              {format.money(row.transferFee)} (included in the total).
            </p>
          )}
          {blocker && <p class="error">{blocker}</p>}
          {!blocker && stale && (
            <p class="confirm-warn">
              The price moved: the {isMax ? 'smallest max bid' : 'next bid'} is now{' '}
              <b>{format.dollars(min)}</b>.{' '}
              <button type="button" class="btn-text" onClick={() => setAmount(min)}>
                Use {format.dollars(min)}
              </button>
            </p>
          )}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button
            type="button"
            class="btn"
            autofocus
            onClick={confirm}
            aria-disabled={disabled ? 'true' : undefined}
          >
            {pending ? 'Placing bid…' : `Place ${format.dollars(amount)} bid`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
