import { memo } from 'preact/compat';
import { costBreakdown, dollars, money } from '../shared/cost';
import { lotHref } from '../shared/keys';
import { CDN } from './api';
import { isAuthenticated, LoginLink } from './auth';
import { canWatch, toggleWatch, watchPending } from './watch';
import { bidBlocker, hasBidOn, isLeading, quickBidAmount, bidPending, type BidRequest } from './bid';
import { siteConditions } from './conditions';
import { Icon } from './icons';
import { clock, openHandler, plural, shortDate, shortTime, timeLabel } from './util';
import type { Row } from './view';
import type { Lot, PastClose } from './types';

/** Live countdown to a lot closing, highlighted in the last hour. */
export function TimeLeft({ endsAt }: { endsAt: number }) {
  const now = clock(1000);
  const { text, soon } = timeLabel(endsAt, now);
  return (
    <span class={`time ${soon ? 'soon' : ''}`} title={new Date(endsAt).toLocaleString()}>
      {text}
    </span>
  );
}

/** Winning / Outbid pill for lots you have bid on. */
export function StandingBadge({ lot }: { lot: Lot }) {
  if (lot.yourStanding?.isLeading) {
    return <span class="pill pill-good">Winning</span>;
  }
  return hasBidOn(lot) ? <span class="pill pill-bad">Outbid</span> : null;
}

/** Lot location, noting when it is pickup-only or needs a transfer. */
export function LocationText({ row }: { row: Row }) {
  const name = row.lot.location?.name ?? 'Unknown';
  if (row.pickupOnly) {
    return <span title="Not transferable – pick up at this location">{name} only</span>;
  }
  if (row.transferFee) {
    return <span title={`Transfer to your pickup location for ${money(row.transferFee)}`}>{name} · transfer</span>;
  }
  return <span>{name}</span>;
}

/** Watchlist toggle on the card image; a plain marker once you've bid (the site doesn't allow toggling then). */
function WatchStar({ lot }: { lot: Lot }) {
  const pending = watchPending(lot.id);
  if (!canWatch(lot)) {
    return lot.isWatchlisted ? (
      <span class="pill pill-watch" title="On your watchlist">
        <Icon name="star" size={13} />
      </span>
    ) : null;
  }
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

/** Watchlist toggle for the lot popup; hidden when the lot can't be watched. */
export function WatchButton({ lot }: { lot: Lot }) {
  const pending = watchPending(lot.id);
  if (!canWatch(lot)) {
    return null;
  }
  return (
    <button type="button" class="btn btn-text" aria-pressed={lot.isWatchlisted} disabled={pending} onClick={() => void toggleWatch(lot.id)}>
      <Icon name={lot.isWatchlisted ? 'star' : 'starBorder'} /> {lot.isWatchlisted ? 'On watchlist' : 'Add to watchlist'}
    </button>
  );
}

interface Props {
  row: Row;
  isNew?: boolean;
  onOpen: (lot: Lot) => void;
  onToggleHide: (lot: Lot) => void;
  onBid: (req: BidRequest) => void;
  onAddType: (lot: Lot) => void;
}

/** One lot in the grid: image, title, price, total, time left and actions. */
export const LotCard = memo(function LotCard({ row, isNew, onOpen, onToggleHide, onBid, onAddType }: Props) {
  const { lot, matched, hidden } = row;
  const href = lotHref(lot.auctionPeriod, lot.id);
  const dim = !!matched || hidden;
  const img = lot.images[0];
  const open = openHandler(() => onOpen(lot));
  const conditions = siteConditions();
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
        {(hidden || matched) && <span class="media-badge" title={hidden ? 'Hidden' : `Filtered: ${matched}`}>
          {hidden ? 'Hidden' : `Filtered: ${matched}`}
        </span>}
      </div>
      <div class="card-body">
        <a class="card-title" href={href} title={lot.title} onClick={open}>
          {lot.title}
        </a>
        <div class="card-meta">
          <LocationText row={row} />
          {lot.condition && <span title={conditions.get(lot.condition.value)?.description}>{lot.condition.label}</span>}
        </div>
        {lot.itemType && (
          <button type="button" class="item-type" title="Make a category of this item type" onClick={() => onAddType(lot)}>
            <span>{lot.itemType}</span>
            <Icon name="add" size={14} />
          </button>
        )}
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
          <span>{plural(lot.bidCount, 'bid')}</span>
        </div>
        {lot.pastCloses && <PastCloses lot={lot} onOpen={open} />}
        <div class="card-foot">
          <TimeLeft endsAt={lot.endsAt} />
          <CardBidButton row={row} onOpen={() => onOpen(lot)} onBid={onBid} />
        </div>
      </div>
    </article>
  );
});

/** "+N" badge for listings of the same item folded into this card; opens the cheapest's popup, which lists them all. */
function DupeCount({ row, onOpen }: { row: Row; onOpen: (lot: Lot) => void }) {
  const list = row.others.map((r) => `${money(r.total)} total · ${r.lot.location?.name ?? 'Unknown'} · ends ${shortTime(r.lot.endsAt)}`).join('\n');
  return (
    <button type="button" class="pill pill-dupes" title={`${plural(row.others.length, 'more listing')} of this item:\n${list}`} onClick={() => onOpen(row.lot)}>
      +{row.others.length} more
    </button>
  );
}

/** Median of a list of prices. */
const median = (xs: number[]) => {
  const s = xs.toSorted((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * What a lot's past closes say it usually goes for: the median of the recent
 * ones that sold, counting only those in the same condition when there are any.
 */
export function pastPrice(lot: Lot): { median: number; count: number; sameCondition: boolean } | null {
  const sold = lot.pastCloses?.recent.filter((c) => c.sold) ?? [];
  const same = sold.filter((c) => c.condition === (lot.condition?.label ?? null));
  const use = same.length ? same : sold;
  return use.length ? { median: median(use.map((c) => c.price)), count: use.length, sameCondition: same.length > 0 } : null;
}

/** One past close as a line of text. */
export const pastCloseText = (c: PastClose) =>
  `${c.sold ? dollars(c.price) : 'no sale'}${c.final ? '' : ' (last seen)'} · ${c.condition ?? 'Unknown'} · ${shortDate(c.endsAt)}`;

/** "Sold before for $12 (median of 4)", with the recent closes on hover; opens the popup, which lists them all. */
function PastCloses({ lot, onOpen }: { lot: Lot; onOpen: (e: MouseEvent) => void }) {
  const { n, recent } = lot.pastCloses!;
  const p = pastPrice(lot);
  const more = n > recent.length ? `\n…and ${n - recent.length} more` : '';
  const title = `${plural(n, 'earlier lot')} with this name closed:\n${recent.map(pastCloseText).join('\n')}${more}`;
  return (
    <button type="button" class="card-past" title={title} onClick={onOpen}>
      {p ? (
        <>
          Sold before for <b>{dollars(p.median)}</b>
          {p.count > 1 && ` (median of ${p.count})`}
          {!p.sameCondition && ' in another condition'}
        </>
      ) : (
        `No sale the last ${recent.length === 1 ? 'time' : `${recent.length} times`}`
      )}
    </button>
  );
}

/** The card's bid button: next-increment bid, raise max, or a disabled/login state. */
function CardBidButton({ row, onOpen, onBid }: { row: Row; onOpen: () => void; onBid: (req: BidRequest) => void }) {
  const { lot } = row;
  const pending = bidPending(lot.id);
  const authed = isAuthenticated();
  const blocker = bidBlocker(row);
  if (blocker && !authed && !row.hidden && !row.matched) {
    return (
      <LoginLink class="btn btn-small" title="Log in to Triangle Liquidators to bid here">
        Bid
      </LoginLink>
    );
  }
  if (blocker || pending) {
    return (
      <span class="btn btn-small" aria-disabled="true" title={blocker ?? undefined}>
        {blocker ? 'Bid' : 'Bidding…'}
      </span>
    );
  }
  // While winning, a quick bid would only raise your own price; raising the max happens in the popup.
  if (isLeading(lot)) {
    return (
      <button type="button" class="btn btn-small btn-outline" onClick={onOpen} title="Raise your max bid">
        Raise max
      </button>
    );
  }
  const amount = quickBidAmount(lot);
  return (
    <button type="button" class="btn btn-small" onClick={() => onBid({ lotId: lot.id, amount, type: 'next_increment' })} title="Bid the next increment (asks to confirm)">
      Bid {dollars(amount)}
    </button>
  );
}
