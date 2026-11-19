import { memo } from 'preact/compat';
import { useCallback } from 'preact/hooks';

import { CDN } from '../shared/constants';
import { costBreakdown, dollars, money } from '../shared/cost';
import * as format from '../shared/format';
import { lotHref } from '../shared/keys';
import { endsAtMs } from '../shared/lot';
import { isAuthenticated, LoginLink } from './auth';
import { bidBlocker, hasBidOn, isLeading, quickBidAmount, bidPending } from './bid';
import { CardBrandModel } from './brands';
import { CardTags } from './CardTags';
import { siteConditions } from './conditions';
import { Highlight } from './Highlight';
import { Icon } from './icons';
import { ItemTypeActions } from './ItemType';
import { hideCategory, modalActions, openLot, setView, toggleHide } from './state';
import type { Lot, PastClose } from './types';
import { clock, openHandler, plural, timeLabel } from './util';
import type { Row } from './view';
import { observeLot } from './viewport';
import { canWatch, toggleWatch, watchPending } from './watch';
import '../shared/arrayToSet';

/** Live countdown to a lot closing, highlighted in the last hour. */
export function TimeLeft({ endsAt }: { endsAt: number }) {
  const now = clock(1000);
  const { text, soon } = timeLabel(endsAt, now);
  return (
    <span class={`time ${soon ? 'soon' : ''}`} title={format.dateTime(endsAt)}>
      {text}
    </span>
  );
}

/** Winning / Outbid pill for lots you have bid on. */
export function StandingBadge({ lot }: { lot: Lot }) {
  if (lot.your_standing?.is_leading) {
    return <span class="pill pill-good">Winning</span>;
  }
  return hasBidOn(lot) ? <span class="pill pill-bad">Outbid</span> : null;
}

/** Lot location, noting when it is pickup-only or needs a transfer. */
export function LocationText({ row }: { row: Row }) {
  const name = row.lot.location.name;
  if (row.pickupOnly) {
    return <span title="Not transferable – pick up at this location">{name} only</span>;
  }
  if (row.transferFee) {
    return (
      <span title={`Transfer to your pickup location for ${money(row.transferFee)}`}>
        {name} · transfer
      </span>
    );
  }
  return <span>{name}</span>;
}

/** Watchlist toggle on the card image; hidden once you've bid, like the site. */
function WatchStar({ lot }: { lot: Lot }) {
  const pending = watchPending(lot.id);
  if (hasBidOn(lot)) {
    return null;
  }
  if (!canWatch(lot)) {
    return lot.is_watchlisted ? (
      <span class="pill pill-watch" title="On your watchlist">
        <Icon name="star" size={13} />
      </span>
    ) : null;
  }
  const label = lot.is_watchlisted ? 'Remove from watchlist' : 'Add to watchlist';
  return (
    <button
      type="button"
      class={`pill pill-watch watch-btn ${lot.is_watchlisted ? 'on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={lot.is_watchlisted}
      disabled={pending}
      onClick={() => void toggleWatch(lot.id)}
    >
      <Icon name={lot.is_watchlisted ? 'star' : 'starBorder'} size={13} />
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
    <button
      type="button"
      class="btn btn-text"
      aria-pressed={lot.is_watchlisted}
      disabled={pending}
      onClick={() => void toggleWatch(lot.id)}
    >
      <Icon name={lot.is_watchlisted ? 'star' : 'starBorder'} />{' '}
      {lot.is_watchlisted ? 'On watchlist' : 'Add to watchlist'}
    </button>
  );
}

interface Props {
  row: Row;
  isNew?: boolean;
}

/** One lot in the grid: image, title, price, total, time left and actions. */
export const LotCard = memo(function LotCard({ row, isNew }: Props) {
  const { lot, matched, hidden, category } = row;
  const href = lotHref(lot.auction_period, lot.id);
  const dim = Boolean(matched) || hidden;
  const img = lot.images[0];
  const open = openHandler(() => openLot(lot));
  const conditions = siteConditions();
  // Preact stores ref cleanup on the callback, so each card needs its own.
  const observe = useCallback((element: HTMLElement | null) => observeLot(element), []);
  return (
    <article class={`card ${dim ? 'dim' : ''}`} data-lot={lot.id} ref={observe}>
      <div class="card-media">
        <a href={href} onClick={open} tabIndex={-1} aria-hidden="true">
          {img ? (
            <img src={`${CDN}/${img.image_card}`} alt="" loading="lazy" decoding="async" />
          ) : (
            <span class="noimg">No image</span>
          )}
        </a>
        <button
          type="button"
          class="icon-btn hide-btn"
          title={hidden ? 'Unhide this lot' : 'Hide this lot'}
          aria-label={hidden ? 'Unhide this lot' : 'Hide this lot'}
          onClick={() => toggleHide(lot)}
        >
          <Icon name={hidden ? 'visibility' : 'visibilityOff'} />
        </button>
        <div class="media-tr">
          {isNew && <span class="pill pill-new">New</span>}
          {row.others.length > 0 && <DupeCount row={row} />}
          <WatchStar lot={lot} />
          <StandingBadge lot={lot} />
        </div>
        {(hidden || matched) && (
          <span class="media-badge" title={hidden ? 'Hidden' : `Filtered: ${matched}`}>
            {hidden ? 'Hidden' : `Filtered: ${matched}`}
          </span>
        )}
      </div>
      <div class="card-body">
        <div class="card-kicker">
          <span class="card-condition" title={conditions.get(lot.condition.value)?.description}>
            {lot.condition.display_name}
          </span>
          <span class="card-location">
            <LocationText row={row} />
          </span>
        </div>
        <a class="card-title" href={href} title={lot.title} onClick={open}>
          <Highlight text={lot.title} />
        </a>
        <CardBrandModel id={lot.id} />
        <div class="card-chips">
          <span class="card-category">
            <button
              type="button"
              class="btn-text category-only"
              title={`Show only ${category.label}`}
              aria-label={`Show only ${category.label}`}
              onClick={() => setView({ categories: [category.value], noCategories: false })}
            >
              {category.label}
            </button>
            <button
              type="button"
              class="icon-btn category-hide"
              title={`Hide category: ${category.label}`}
              aria-label={`Hide category: ${category.label}`}
              onClick={(e?: MouseEvent) => hideCategory(category.value, e?.currentTarget)}
            >
              <Icon name="visibilityOff" size={14} />
            </button>
          </span>
          <ItemTypeActions lot={lot} />
          <CardTags lot={lot} />
        </div>
        <div class="card-summary">
          <div class="card-price">
            <span class="price" title="Current bid">
              {dollars(lot.current_price)}
            </span>
            <span class="card-total" title={costBreakdown(lot.current_price, row.transferFee)}>
              ≈ {money(row.total)} total
            </span>
            <CardBidButton row={row} />
          </div>
          <div class="card-sub">
            <TimeLeft endsAt={endsAtMs(lot)} />
            <span>{plural(lot.bid_count, 'bid')}</span>
            {lot.estimated_retail_price ? (
              <span>
                Retail {dollars(lot.estimated_retail_price)}
                {row.retailPct != null && (
                  <span class="card-retail-pct" title="Current bid as a share of retail">
                    {' '}
                    ({Math.round(row.retailPct * 100)}%)
                  </span>
                )}
              </span>
            ) : (
              <span class="muted">No retail estimate</span>
            )}
          </div>
          {lot.pastCloses && <PastCloses lot={lot} onOpen={open} />}
          {row.cheaper && <CheaperNote lead={row} cheaper={row.cheaper} />}
        </div>
      </div>
    </article>
  );
});

/**
 * "+N" badge for listings of the same item folded into this card; opens the cheapest's popup, which
 * lists them all.
 */
function DupeCount({ row }: { row: Row }) {
  const list = row.others
    .map(
      r =>
        `${money(r.total)} total · ${r.lot.location.name} · ends ${format.shortTime(endsAtMs(r.lot))}`,
    )
    .join('\n');
  return (
    <button
      type="button"
      class="pill pill-dupes"
      title={`${plural(row.others.length, 'more listing')} of this item:\n${list}`}
      onClick={() => openLot(row.lot)}
    >
      +{row.others.length} more
    </button>
  );
}

/**
 * "Used for ≈ $9 total (save $4)": the same item listed cheaper in a worse condition; opens that
 * lot.
 */
function CheaperNote({ lead, cheaper }: { lead: Row; cheaper: Row }) {
  const condition = cheaper.lot.condition.display_name;
  const where = cheaper.lot.location.name;
  return (
    <button
      type="button"
      class="card-cheaper"
      title={`Same item, ${condition.toLowerCase()}: ${dollars(cheaper.lot.current_price)} bid at ${where}, ends ${format.shortTime(endsAtMs(cheaper.lot))}`}
      onClick={() => openLot(cheaper.lot)}
    >
      {condition} for <b>≈ {money(cheaper.total)}</b> total (save{' '}
      {money(lead.total - cheaper.total)})
    </button>
  );
}

/** Median of a list of prices. */
const median = (xs: number[]) => {
  const s = xs.toNumericSorted();
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * What a lot's past closes say it usually goes for: the median of the recent ones that sold,
 * counting only those in the same condition when there are any.
 */
export function pastPrice(
  lot: Lot,
): { median: number; count: number; sameCondition: boolean } | null {
  const sold = lot.pastCloses?.recent.filter(c => c.sold) ?? [];
  const same = sold.filter(c => c.condition === lot.condition.display_name);
  const use = same.length ? same : sold;
  return use.length
    ? { median: median(use.map(c => c.price)), count: use.length, sameCondition: same.length > 0 }
    : null;
}

/** One past close as a line of text. */
const pastCloseText = (c: PastClose) =>
  `${c.sold ? dollars(c.price) : 'no sale'}${c.final ? '' : ' (last seen)'} · ${c.condition ?? 'Unknown'} · ${format.shortDate(c.endsAt)}`;

/**
 * "Sold before for $12 (median of 4)", with the recent closes on hover; opens the popup, which
 * lists them all.
 */
function PastCloses({ lot, onOpen }: { lot: Lot; onOpen: (e: MouseEvent) => void }) {
  const { n, recent } = lot.pastCloses!;
  const p = pastPrice(lot);
  const more = n > recent.length ? `\n…and ${n - recent.length} more` : '';
  const title = `${plural(n, 'earlier matching lot')} closed:\n${recent.map(pastCloseText).join('\n')}${more}`;
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
function CardBidButton({ row }: { row: Row }) {
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
      <button
        type="button"
        class="btn btn-small btn-outline"
        onClick={() => openLot(lot)}
        title="Raise your max bid"
      >
        Raise max
      </button>
    );
  }
  const amount = quickBidAmount(lot);
  return (
    <button
      type="button"
      class="btn btn-small"
      onClick={() => modalActions.startBid({ lotId: lot.id, amount, type: 'next_increment' })}
      title="Bid the next increment (asks to confirm)"
    >
      Bid {dollars(amount)}
    </button>
  );
}
