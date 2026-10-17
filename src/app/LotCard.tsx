import { memo } from 'preact/compat';
import { costBreakdown, dollars, money } from '../shared/cost';
import { lotHref } from '../shared/keys';
import { CDN } from './api';
import { useAuthed } from './auth';
import { canWatch, toggleWatch, useWatchPending } from './watch';
import { bidBlocker, isLeading, quickBidAmount, useBidPending, type BidRequest } from './bid';
import { Icon } from './icons';
import { fmtCount, timeLabel, useNow } from './util';
import type { Row } from './view';
import type { Lot } from './types';

export function TimeLeft({ endsAt }: { endsAt: number }) {
  const now = useNow(1000);
  const { text, soon } = timeLabel(endsAt, now);
  return (
    <span class={`time ${soon ? 'soon' : ''}`} title={new Date(endsAt).toLocaleString()}>
      {text}
    </span>
  );
}

export function StandingBadge({ lot }: { lot: Lot }) {
  if (lot.yourStanding?.isLeading) return <span class="pill pill-good">Winning</span>;
  if (lot.hasBid || lot.yourStanding) return <span class="pill pill-bad">Outbid</span>;
  return null;
}

export function LocationText({ row }: { row: Row }) {
  const name = row.lot.location?.name ?? 'Unknown';
  if (row.pickupOnly) return <span title="Not transferable – pick up at this location">{name} only</span>;
  if (row.transferFee) return <span title={`Transfer to your pickup location for ${money(row.transferFee)}`}>{name} · transfer</span>;
  return <span>{name}</span>;
}

/** Watchlist toggle on the card image; a plain marker once you've bid (the site doesn't allow toggling then). */
function WatchStar({ lot }: { lot: Lot }) {
  useAuthed();
  const pending = useWatchPending(lot.id);
  if (!canWatch(lot))
    return lot.isWatchlisted ? (
      <span class="pill pill-watch" title="On your watchlist">
        <Icon name="star" size={13} />
      </span>
    ) : null;
  const label = lot.isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist';
  return (
    <button
      type="button"
      class={`pill pill-watch watch-btn ${lot.isWatchlisted ? 'on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={lot.isWatchlisted}
      disabled={pending}
      onClick={() => void toggleWatch(lot.id)}
    >
      <Icon name={lot.isWatchlisted ? 'star' : 'starBorder'} size={13} />
    </button>
  );
}

export function WatchButton({ lot }: { lot: Lot }) {
  useAuthed();
  const pending = useWatchPending(lot.id);
  if (!canWatch(lot)) return null;
  return (
    <button type="button" class="btn btn-text" aria-pressed={lot.isWatchlisted} disabled={pending} onClick={() => void toggleWatch(lot.id)}>
      <Icon name={lot.isWatchlisted ? 'star' : 'starBorder'} /> {lot.isWatchlisted ? 'On watchlist' : 'Add to watchlist'}
    </button>
  );
}

/** Plain click opens in-app; modified/middle clicks follow the real link. */
export function openHandler(open: () => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    open();
  };
}

interface Props {
  row: Row;
  isNew?: boolean;
  onOpen: (lot: Lot) => void;
  onToggleHide: (lot: Lot) => void;
  onBid: (req: BidRequest) => void;
}

export const LotCard = memo(function LotCard({ row, isNew, onOpen, onToggleHide, onBid }: Props) {
  const { lot, matched, hidden } = row;
  const href = lotHref(lot.auctionPeriod, lot.id);
  const dim = !!matched || hidden;
  const img = lot.images[0];
  const open = openHandler(() => onOpen(lot));
  return (
    <article class={`card ${dim ? 'dim' : ''}`} data-lot={lot.id}>
      <div class="card-media">
        <a href={href} onClick={open} tabIndex={-1} aria-hidden="true">
          {img ? <img src={`${CDN}/${img.card}`} alt="" loading="lazy" decoding="async" /> : <span class="noimg">No image</span>}
        </a>
        <button
          type="button"
          class="icon-btn hide-btn"
          title={hidden ? 'Unhide this lot' : 'Hide this lot'}
          aria-label={hidden ? 'Unhide this lot' : 'Hide this lot'}
          onClick={() => onToggleHide(lot)}
        >
          <Icon name={hidden ? 'visibility' : 'visibilityOff'} />
        </button>
        <div class="media-tr">
          {isNew && <span class="pill pill-new">New</span>}
          {row.others.length > 0 && <DupeCount row={row} onOpen={onOpen} />}
          <WatchStar lot={lot} />
          <StandingBadge lot={lot} />
        </div>
        {(hidden || matched) && <span class="media-badge">{hidden ? 'Hidden' : `Filtered: ${matched}`}</span>}
      </div>
      <div class="card-body">
        <a class="card-title" href={href} title={lot.title} onClick={open}>
          {lot.title}
        </a>
        <div class="card-meta">
          <LocationText row={row} />
          {lot.condition && <span>{lot.condition.label}</span>}
        </div>
        <div class="card-price">
          <span class="price">{dollars(lot.currentPrice)}</span>
          <span class="total" title={costBreakdown(lot.currentPrice, row.transferFee)}>
            ≈ <b>{money(row.total)}</b> total
          </span>
        </div>
        <div class="card-sub">
          {lot.estimatedRetailPrice ? (
            <span>
              Retail {dollars(lot.estimatedRetailPrice)}
              {row.retailPct != null && <span class="muted"> ({Math.round(row.retailPct * 100)}%)</span>}
            </span>
          ) : (
            <span class="muted">No retail estimate</span>
          )}
          <span>
            {fmtCount(lot.bidCount)} bid{lot.bidCount === 1 ? '' : 's'}
          </span>
        </div>
        <div class="card-foot">
          <TimeLeft endsAt={lot.endsAt} />
          <CardBidButton row={row} href={href} onOpen={() => onOpen(lot)} onBid={onBid} />
        </div>
      </div>
    </article>
  );
});

/** "+N" badge for identical listings folded into this card; opens the cheapest's popup, which lists them all. */
function DupeCount({ row, onOpen }: { row: Row; onOpen: (lot: Lot) => void }) {
  const n = row.others.length;
  const list = row.others.map((l) => `${dollars(l.currentPrice)} · ends ${new Date(l.endsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`).join('\n');
  return (
    <button type="button" class="pill pill-dupes" title={`${n} more identical listing${n === 1 ? '' : 's'}:\n${list}`} onClick={() => onOpen(row.lot)}>
      +{n} more
    </button>
  );
}

function CardBidButton({ row, href, onOpen, onBid }: { row: Row; href: string; onOpen: () => void; onBid: (req: BidRequest) => void }) {
  const { lot } = row;
  const pending = useBidPending(lot.id);
  const authed = useAuthed();
  const blocker = bidBlocker(row);
  if (blocker && !authed && !row.hidden && !row.matched)
    return (
      <a class="btn btn-small" href={href} target="_blank" rel="noopener" title="Log in on Triangle Liquidators to bid here">
        Bid <Icon name="open" size={14} />
      </a>
    );
  if (blocker)
    return (
      <span class="btn btn-small" aria-disabled="true" title={blocker}>
        Bid
      </span>
    );
  if (pending)
    return (
      <span class="btn btn-small" aria-disabled="true">
        Bidding…
      </span>
    );
  // While winning, a quick bid would only raise your own price; raising the max happens in the popup.
  if (isLeading(lot))
    return (
      <button type="button" class="btn btn-small btn-outline" onClick={onOpen} title="Raise your max bid">
        Raise max
      </button>
    );
  const amount = quickBidAmount(lot);
  return (
    <button type="button" class="btn btn-small" onClick={() => onBid({ lotId: lot.id, amount, type: 'next_increment' })} title="Bid the next increment (asks to confirm)">
      Bid {dollars(amount)}
    </button>
  );
}
