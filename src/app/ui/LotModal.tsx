import { useEffect, useState } from 'preact/hooks';

import { CDN } from '../../shared/constants';
import { costBreakdown, dollars, money } from '../../shared/cost';
import * as format from '../../shared/format';
import { lotHref } from '../../shared/keys';
import { endsAtMs, type LotMetadata } from '../../shared/lot';
import { bidBlocker, isLeading, maxBidError, minMaxBid, quickBidAmount } from '../logic/bid';
import { cleanDescription, openSimilarLots, pastPrice } from '../logic/catalog';
import { errorMessage, parseNum, plural } from '../logic/util';
import type { Row } from '../logic/view';
import { isAuthenticated } from '../server/auth';
import { bidPending } from '../server/bid';
import { cachedDetail, cachedMetadata, getLot, loadDetail, loadMetadata } from '../server/catalog';
import { siteConditions } from '../server/conditions';
import { clock } from '../server/reactive';
import { fetchPastCloses } from '../server/source';
import type { Lot, LotDetail, PastCloseDetail } from '../types';
import { LoginLink } from './Auth';
import { BrandModel } from './Brands';
import { Dialog } from './Dialog';
import { openHandler } from './dom';
import { Icon } from './icons';
import { ItemTypeActions } from './ItemType';
import { ListingRow } from './ListingRow';
import { LocationText, LotAttrs, StandingBadge, TimeLeft, WatchButton } from './LotCard';
import { modalActions, openLot, setView, storedView, toggleHide } from './state';
import '../../shared/arrayToSet';

export { LotAttrs };

interface Props {
  row: Row;
  onClose: () => void;
  group?: Row[] | undefined; // listings of the same item, best condition then cheapest total first
  onOpenLot?: (lot: Lot) => void; // a lot in the catalog
}

const focusContent = (element: HTMLDivElement | null) => element?.focus();

/** Popup with full lot details, images, bid history and bidding. */
export function LotModal(props: Props) {
  return (
    <Dialog onClose={props.onClose} aria-labelledby="lot-title">
      <LotContent key={props.row.lot.id} {...props} />
    </Dialog>
  );
}

function LotContent({ row, onClose, group, onOpenLot = openLot }: Props) {
  const { lot } = row;
  const [detail, setDetail] = useState<LotDetail | null>(() => cachedDetail(lot.id) ?? null);
  const [metadata, setMetadata] = useState<LotMetadata | null>(
    () => cachedMetadata(lot.id) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [imgIdx, setImgIdx] = useState(0);
  const conditions = siteConditions();
  const authed = isAuthenticated();

  useEffect(() => {
    let active = true;
    let refreshed = false;
    setError(null);
    setMetadataError(null);
    setRefreshing(true);
    setDetail(cachedDetail(lot.id) ?? null);
    loadMetadata(lot).then(
      saved => {
        if (active && !refreshed && saved) {
          setMetadata(saved);
        }
      },
      e => {
        if (active && !refreshed) {
          setMetadataError(errorMessage(e));
        }
      },
    );
    // The cache shares this request with other callers; only detach this reader.
    loadDetail(lot).then(
      data => {
        if (!active) {
          return;
        }
        refreshed = true;
        setDetail(data);
        setMetadata(cachedMetadata(lot.id) ?? null);
        setMetadataError(null);
        setRefreshing(false);
      },
      e => {
        if (!active) {
          return;
        }
        setError(errorMessage(e));
        setRefreshing(false);
      },
    );
    return () => {
      active = false;
    };
  }, [lot.id, lot.version, lot.your_standing?.your_max_bid, lot.your_standing?.is_leading, authed]);

  const images = metadata?.images ?? lot.images;
  const description = metadata?.description ? cleanDescription(metadata.description) : '';
  const auction = detail && detail.version >= lot.version ? detail : null;
  const img = images[Math.min(imgIdx, images.length - 1)];
  /** Move through the images by `delta`, wrapping around. */
  const step = (delta: number) =>
    setImgIdx(i => (i + delta + images.length) % Math.max(images.length, 1));

  const onKeyDown = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!typing && e.key === 'ArrowLeft') {
      step(-1);
    } else if (!typing && e.key === 'ArrowRight') {
      step(1);
    }
  };
  let mainImage = <span class="noimg">No image</span>;
  if (img) {
    mainImage = <img src={`${CDN}/${img.image_large}`} alt="" />;
  }
  return (
    <div class="modal" tabIndex={-1} ref={focusContent} onKeyDown={onKeyDown}>
      <button type="button" class="icon-btn modal-close" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={22} />
      </button>
      <div class="modal-grid">
        <div class="gallery">
          <div class="gallery-main">
            {mainImage}
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  class="icon-btn gal-prev"
                  aria-label="Previous image"
                  onClick={() => step(-1)}
                >
                  <Icon name="chevronLeft" size={24} />
                </button>
                <button
                  type="button"
                  class="icon-btn gal-next"
                  aria-label="Next image"
                  onClick={() => step(1)}
                >
                  <Icon name="chevronRight" size={24} />
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div class="thumbs">
              {images.map((im, i) => (
                <button
                  type="button"
                  class={i === imgIdx ? 'on' : ''}
                  aria-label={`Image ${i + 1}`}
                  onClick={() => setImgIdx(i)}
                >
                  <img src={`${CDN}/${im.image_thumb}`} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div class="modal-info">
          <h2 id="lot-title">{lot.title}</h2>
          {metadata && <BrandModel brand={metadata.brand} model={metadata.model} />}
          <div class="card-meta">
            <LocationText row={row} />
            <span title={conditions.get(lot.condition.value)?.description}>
              {lot.condition.display_name}
            </span>
            <span>{row.category.label}</span>
            <span>Lot #{lot.lot_number}</span>
          </div>
          {getLot(lot.id) && <ItemTypeActions lot={lot} />}
          <LotAttrs
            title={lot.title}
            onSelect={key => {
              const cur = storedView.value.attrs;
              setView({ attrs: cur.includes(key) ? cur : [...cur, key] });
              onClose();
            }}
          />
          <div class="modal-price">
            <div>
              <div class="price big">{dollars(lot.current_price)}</div>
              <div class="muted small">Current bid · {plural(lot.bid_count, 'bid')}</div>
            </div>
            <div>
              <div class="total big" title={costBreakdown(lot.current_price, row.transferFee)}>
                ≈ {money(row.total)}
              </div>
              <div class="muted small">Estimated total</div>
            </div>
            <div>
              <div class="big">
                <TimeLeft endsAt={endsAtMs(lot)} />
              </div>
              <div class="muted small">{format.shortTime(endsAtMs(lot))}</div>
            </div>
          </div>
          <div class="row-gap">
            <StandingBadge lot={lot} />
            {lot.your_standing?.your_max_bid != null && (
              <span class="muted small">
                Your max bid {dollars(lot.your_standing.your_max_bid)}
              </span>
            )}
            <span class="muted small">
              Retail {dollars(lot.estimated_retail_price)}
              {row.retailPct != null && ` (${Math.round(row.retailPct * 100)}%)`}
            </span>
            <span class="muted small">Next min bid {dollars(lot.next_min_increment)}</span>
          </div>
          <BidPanel key={`${lot.id}:${lot.your_standing?.your_max_bid}`} row={row} />
          <div class="row-gap">
            <a
              class="btn btn-text"
              href={lotHref(lot.auction_period, lot.id)}
              target="_blank"
              rel="noopener"
            >
              Open on Triangle Liquidators <Icon name="open" size={16} />
            </a>
            <WatchButton lot={lot} />
            <button type="button" class="btn btn-text" onClick={() => toggleHide(lot)}>
              <Icon name={row.hidden ? 'visibility' : 'visibilityOff'} />{' '}
              {row.hidden ? 'Unhide' : 'Hide'}
            </button>
          </div>

          {group && group.length > 1 && (
            <SameListings group={group} current={lot} onOpen={onOpenLot} />
          )}

          {metadataError && <p class="error">Couldn’t load saved item details: {metadataError}</p>}
          {error && <p class="error">Couldn’t refresh auction data: {error}</p>}
          {!metadata && !error && !metadataError && <p class="muted">Loading details…</p>}
          {refreshing && metadata && <p class="muted">Refreshing auction data…</p>}
          {description && <div class="description">{description}</div>}
          {lot.pastCloses && <PastCloses lot={lot} />}
          {auction && (
            <>
              {auction.bid_history.length > 0 && (
                <div>
                  <h3>Bid history</h3>
                  <ol class="bids">
                    {auction.bid_history.map(b => (
                      <li class={b.is_you ? 'you' : ''}>
                        <span>{b.is_you ? 'You' : b.bidder_label}</span>
                        <span>{dollars(b.amount)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {auction.similar.length > 0 && (
                <Similar lots={auction.similar} current={lot} onOpen={onOpenLot} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * List of the listings in this lot's group (titles shown where they differ); click one to switch to
 * it.
 */
function SameListings({
  group,
  current,
  onOpen,
}: {
  group: Row[];
  current: Lot;
  onOpen: (lot: Lot) => void;
}) {
  const mixed = group.map(r => r.lot.condition.display_name).toSet().size > 1;
  return (
    <div>
      <h3>{format.num(group.length)} listings of this item</h3>
      <ol class="dupes">
        {group.map(r => (
          <ListingRow
            key={r.lot.id}
            row={r}
            currentTitle={current.title}
            selected={r.lot.id === current.id}
            showCondition={mixed}
            onOpen={onOpen}
          />
        ))}
      </ol>
    </div>
  );
}

/**
 * The site's "Similar Auctions" for this lot that are still open, with the catalog's copy where it
 * has one (fresher price). A lot in the catalog opens here; any other opens on the site.
 */
function Similar({
  lots,
  current,
  onOpen,
}: {
  lots: Lot[];
  current: Lot;
  onOpen: (lot: Lot) => void;
}) {
  const now = clock(30_000);
  const open = openSimilarLots(lots, current.id, getLot, now);
  if (!open.length) {
    return null;
  }
  return (
    <div>
      <h3>Similar auctions</h3>
      <ol class="similar">
        {open.map(l => {
          const img = l.images[0];
          const inCatalog = getLot(l.id) != null;
          let thumb = <span class="noimg" />;
          if (img) {
            thumb = <img src={`${CDN}/${img.image_thumb}`} alt="" loading="lazy" />;
          }
          return (
            <li>
              <a
                href={lotHref(l.auction_period, l.id)}
                target="_blank"
                rel="noopener"
                title={l.title}
                onClick={inCatalog ? openHandler(() => onOpen(getLot(l.id)!)) : undefined}
              >
                <span class="similar-img">{thumb}</span>
                <span class="similar-title">{l.title}</span>
                <span class="similar-meta">
                  <span class="price">{dollars(l.current_price)}</span>
                  <TimeLeft endsAt={endsAtMs(l)} />
                </span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What earlier matching items closed at, refreshed when the matched listings change. */
function PastCloses({ lot }: { lot: Lot }) {
  const [open, setOpen] = useState(false);
  const [closes, setCloses] = useState<PastCloseDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchedIds = lot.pastCloses?.recent.map(close => close.id).join(',');
  useEffect(() => {
    setCloses(null);
    setError(null);
  }, [lot.id, lot.pastCloses?.n, matchedIds]);
  useEffect(() => {
    if (!open || closes || error) {
      return;
    }
    let live = true;
    fetchPastCloses(lot.id).then(
      c => live && setCloses(c),
      e => live && setError(errorMessage(e)),
    );
    return () => void (live = false);
  }, [open, closes, error, lot.id, lot.pastCloses?.n, matchedIds]);
  const p = pastPrice(lot);
  return (
    <div>
      <h3>
        <button
          type="button"
          class="collapse-head"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span>
            Closed before ({format.num(lot.pastCloses!.n)})
            {p && (
              <span class="muted small">
                {' '}
                · usually {dollars(p.median)}
                {p.sameCondition ? ` (${lot.condition.display_name})` : ''}
              </span>
            )}
          </span>
          <Icon name="expandMore" size={18} />
        </button>
      </h3>
      {open && (
        <>
          {error && <p class="error">Couldn’t load past closes: {error}</p>}
          {!closes && !error && <p class="muted small">Loading…</p>}
          {closes && (
            <ol class="past">
              {closes.map(c => {
                let priceTitle: string | undefined;
                if (!c.final) {
                  priceTitle =
                    'The last price seen before it closed; the site no longer has the lot';
                }
                return (
                  <li>
                    <span class="price" title={priceTitle}>
                      {c.sold ? dollars(c.price) : 'No sale'}
                      {!c.final && '*'}
                    </span>
                    <span class="past-what muted small">
                      {c.title !== lot.title && (
                        <a
                          class="dupe-title"
                          href={lotHref(c.auctionPeriod, c.id)}
                          target="_blank"
                          rel="noopener"
                        >
                          {c.title}
                        </a>
                      )}
                      {c.condition ?? 'Unknown'} · {c.location ?? 'Unknown'} ·{' '}
                      {plural(c.bidCount, 'bid')}
                    </span>
                    <a
                      class="muted small"
                      href={lotHref(c.auctionPeriod, c.id)}
                      target="_blank"
                      rel="noopener"
                      title="Open on Triangle Liquidators"
                    >
                      {format.shortDate(c.endsAt)}
                    </a>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/** Bid controls in the popup: next-increment bid and a custom max bid. */
function BidPanel({ row }: { row: Row }) {
  const { lot } = row;
  const now = clock(1000);
  const pending = bidPending(lot.id);
  const authed = isAuthenticated();
  const [value, setValue] = useState('');

  const blocker = bidBlocker(row, authed, now);
  if (blocker) {
    if (!authed) {
      return (
        <div class="bid-panel">
          <span class="muted">
            <LoginLink>Log in</LoginLink> to bid here.
          </span>
        </div>
      );
    }
    return (
      <div class="bid-panel">
        <span class="btn" aria-disabled="true">
          {blocker}
        </span>
      </div>
    );
  }

  const leading = isLeading(lot);
  const min = minMaxBid(lot);
  const quick = quickBidAmount(lot);
  const n = parseNum(value);
  const error = maxBidError(value, n, min);

  let hint = 'A max bid bids for you automatically, only as much as needed to keep you winning.';
  if (pending) {
    hint = 'Placing bid…';
  } else if (error) {
    hint = error;
  } else if (leading) {
    hint = `You’re winning. Raise your max to ${dollars(min)} or more.`;
  }

  const submit = (e: Event) => {
    e.preventDefault();
    if (n != null && !error && !pending) {
      modalActions.startBid({ lotId: lot.id, amount: n, type: 'max_bid' });
    }
  };

  return (
    <form class="bid-panel" onSubmit={submit} noValidate>
      <div class="bid-row">
        <label class={`bid-input ${error ? 'has-error' : ''}`}>
          <span aria-hidden="true">$</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Max bid amount"
            placeholder={`${min} or more`}
            value={value}
            onInput={e => setValue(e.currentTarget.value)}
          />
        </label>
        <button
          type="submit"
          class="btn"
          aria-disabled={n == null || error || pending ? 'true' : undefined}
        >
          {leading ? 'Raise max bid' : 'Set max bid'}
        </button>
        {!leading && (
          <button
            type="button"
            class="btn btn-outline"
            disabled={pending}
            onClick={() =>
              modalActions.startBid({ lotId: lot.id, amount: quick, type: 'next_increment' })
            }
            title="Bid the next increment now"
          >
            Bid {dollars(quick)}
          </button>
        )}
      </div>
      <div class={`small ${error ? 'error' : 'muted'}`}>{hint}</div>
    </form>
  );
}
