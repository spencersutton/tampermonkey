import { useEffect, useState } from 'preact/hooks';
import { costBreakdown, dollars, money } from '../shared/cost';
import { lotHref } from '../shared/keys';
import { CDN } from './api';
import { isAuthenticated, LoginLink } from './auth';
import { bidBlocker, isLeading, minMaxBid, quickBidAmount, bidPending } from './bid';
import { cachedDetail, cachedMetadata, getLot, loadDetail, loadMetadata } from './catalog';
import { Dialog } from './Dialog';
import { siteConditions } from './conditions';
import { Icon } from './icons';
import { ItemTypeActions } from './ItemType';
import { BrandModel } from './brands';
import { LocationText, pastPrice, StandingBadge, TimeLeft, WatchButton } from './LotCard';
import { fetchPastCloses } from './source';
import { modalActions, openLot, toggleHide } from './state';
import { clock, fmtCount, openHandler, parseNum, plural, shortDate, shortTime } from './util';
import type { Lot, LotDetail, LotMetadata, PastCloseDetail } from './types';
import type { Row } from './view';

interface Props {
  row: Row;
  onClose: () => void;
  group?: Row[] | undefined; // listings of the same item, cheapest total first
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
  const [metadata, setMetadata] = useState<LotMetadata | null>(() => cachedMetadata(lot.id) ?? null);
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
      (saved) => { if (active && !refreshed && saved) setMetadata(saved); },
      (e) => { if (active && !refreshed) setMetadataError(e instanceof Error ? e.message : String(e)); },
    );
    // The cache shares this request with other callers; only detach this reader.
    loadDetail(lot).then(
      (data) => {
        if (!active) return;
        refreshed = true;
        setDetail(data);
        setMetadata(cachedMetadata(lot.id) ?? null);
        setMetadataError(null);
        setRefreshing(false);
      },
      (e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : String(e));
        setRefreshing(false);
      },
    );
    return () => { active = false; };
  }, [lot.id, lot.version, lot.yourStanding?.yourMaxBid, lot.yourStanding?.isLeading, authed]);

  const images = metadata?.images ?? lot.images;
  const auction = detail && detail.version >= lot.version ? detail : null;
  const img = images[Math.min(imgIdx, images.length - 1)];
  /** Move through the images by `delta`, wrapping around. */
  const step = (delta: number) => setImgIdx((i) => (i + delta + images.length) % Math.max(images.length, 1));

  const onKeyDown = (e: KeyboardEvent) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (!typing && e.key === 'ArrowLeft') {
      step(-1);
    } else if (!typing && e.key === 'ArrowRight') {
      step(1);
    }
  };
  return (
    <div class="modal" tabIndex={-1} ref={focusContent} onKeyDown={onKeyDown}>
      <button type="button" class="icon-btn modal-close" aria-label="Close" onClick={onClose}>
        <Icon name="close" size={22} />
      </button>
      <div class="modal-grid">
        <div class="gallery">
          <div class="gallery-main">
            {img ? <img src={`${CDN}/${img.large}`} alt="" /> : <span class="noimg">No image</span>}
            {images.length > 1 && (
              <>
                <button type="button" class="icon-btn gal-prev" aria-label="Previous image" onClick={() => step(-1)}>
                  <Icon name="chevronLeft" size={24} />
                </button>
                <button type="button" class="icon-btn gal-next" aria-label="Next image" onClick={() => step(1)}>
                  <Icon name="chevronRight" size={24} />
                </button>
              </>
            )}
          </div>
          {images.length > 1 && (
            <div class="thumbs">
              {images.map((im, i) => (
                <button type="button" class={i === imgIdx ? 'on' : ''} aria-label={`Image ${i + 1}`} onClick={() => setImgIdx(i)}>
                  <img src={`${CDN}/${im.thumb}`} alt="" loading="lazy" />
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
            {lot.condition && <span title={conditions.get(lot.condition.value)?.description}>{lot.condition.label}</span>}
            {row.category && <span>{row.category.label}</span>}
            <span>Lot #{lot.lotNumber}</span>
          </div>
          {getLot(lot.id) && <ItemTypeActions lot={lot} />}
          <div class="modal-price">
            <div>
              <div class="price big">{dollars(lot.currentPrice)}</div>
              <div class="muted small">Current bid · {plural(lot.bidCount, 'bid')}</div>
            </div>
            <div>
              <div class="total big" title={costBreakdown(lot.currentPrice, row.transferFee)}>
                ≈ {money(row.total)}
              </div>
              <div class="muted small">Estimated total</div>
            </div>
            <div>
              <div class="big">
                <TimeLeft endsAt={lot.endsAt} />
              </div>
              <div class="muted small">{shortTime(lot.endsAt)}</div>
            </div>
          </div>
          <div class="row-gap">
            <StandingBadge lot={lot} />
            {lot.yourStanding?.yourMaxBid != null && <span class="muted small">Your max bid {dollars(lot.yourStanding.yourMaxBid)}</span>}
            {lot.estimatedRetailPrice != null && (
              <span class="muted small">
                Retail {dollars(lot.estimatedRetailPrice)}
                {row.retailPct != null && ` (${Math.round(row.retailPct * 100)}%)`}
              </span>
            )}
            <span class="muted small">Next min bid {dollars(lot.nextMinIncrement)}</span>
          </div>
          <BidPanel key={`${lot.id}:${lot.yourStanding?.yourMaxBid}`} row={row} />
          <div class="row-gap">
            <a class="btn btn-text" href={lotHref(lot.auctionPeriod, lot.id)} target="_blank" rel="noopener">
              Open on Triangle Liquidators <Icon name="open" size={16} />
            </a>
            <WatchButton lot={lot} />
            <button type="button" class="btn btn-text" onClick={() => toggleHide(lot)}>
              <Icon name={row.hidden ? 'visibility' : 'visibilityOff'} /> {row.hidden ? 'Unhide' : 'Hide'}
            </button>
          </div>

          {group && group.length > 1 && <SameListings group={group} current={lot} onOpen={onOpenLot} />}
          {lot.pastCloses && <PastCloses lot={lot} />}

          {metadataError && <p class="error">Couldn’t load saved item details: {metadataError}</p>}
          {error && <p class="error">Couldn’t refresh auction data: {error}</p>}
          {!metadata && !error && !metadataError && <p class="muted">Loading details…</p>}
          {refreshing && metadata && <p class="muted">Refreshing auction data…</p>}
          {metadata?.description && <div class="description">{metadata.description}</div>}
          {auction && (
            <>
              {auction.bidHistory.length > 0 && (
                <div>
                  <h3>Bid history</h3>
                  <ol class="bids">
                    {auction.bidHistory.map((b) => (
                      <li class={b.isYou ? 'you' : ''}>
                        <span>{b.isYou ? 'You' : b.bidderLabel}</span>
                        <span>{dollars(b.amount)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {auction.similar.length > 0 && <Similar lots={auction.similar} current={lot} onOpen={onOpenLot} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** List of the listings in this lot's group (titles shown where they differ); click one to switch to it. */
function SameListings({ group, current, onOpen }: { group: Row[]; current: Lot; onOpen: (lot: Lot) => void }) {
  return (
    <div>
      <h3>{fmtCount(group.length)} listings of this item</h3>
      <ol class="dupes">
        {group.map((r) => (
          <li>
            <button type="button" class={r.lot.id === current.id ? 'on' : ''} aria-current={r.lot.id === current.id ? 'true' : undefined} onClick={() => onOpen(r.lot)}>
              <span class="price" title={costBreakdown(r.lot.currentPrice, r.transferFee)}>
                {dollars(r.lot.currentPrice)} <span class="muted small">≈ {money(r.total)}</span>
              </span>
              <span class="muted small">
                {r.lot.title !== current.title && <span class="dupe-title">{r.lot.title}</span>}
                <LocationText row={r} /> · {plural(r.lot.bidCount, 'bid')}
              </span>
              <TimeLeft endsAt={r.lot.endsAt} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The site's "Similar Auctions" for this lot that are still open, with the
 * catalog's copy where it has one (fresher price). A lot in the catalog opens
 * here; any other opens on the site.
 */
function Similar({ lots, current, onOpen }: { lots: Lot[]; current: Lot; onOpen: (lot: Lot) => void }) {
  const now = clock(30_000);
  const open = lots.map((l) => getLot(l.id) ?? l).filter((l) => l.id !== current.id && Temporal.Instant.compare(l.endsAt, now) > 0);
  if (!open.length) {
    return null;
  }
  return (
    <div>
      <h3>Similar auctions</h3>
      <ol class="similar">
        {open.map((l) => {
          const img = l.images[0];
          const inCatalog = getLot(l.id) != null;
          return (
            <li>
              <a
                href={lotHref(l.auctionPeriod, l.id)}
                target="_blank"
                rel="noopener"
                title={l.title}
                onClick={inCatalog ? openHandler(() => onOpen(getLot(l.id)!)) : undefined}
              >
                <span class="similar-img">{img ? <img src={`${CDN}/${img.thumb}`} alt="" loading="lazy" /> : <span class="noimg" />}</span>
                <span class="similar-title">{l.title}</span>
                <span class="similar-meta">
                  <span class="price">{dollars(l.currentPrice)}</span>
                  <TimeLeft endsAt={l.endsAt} />
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
  const [closes, setCloses] = useState<PastCloseDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matchedIds = lot.pastCloses?.recent.map((close) => close.id).join(',');
  useEffect(() => {
    let live = true;
    setCloses(null);
    setError(null);
    fetchPastCloses(lot.id).then(
      (c) => live && setCloses(c),
      (e) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => void (live = false);
  }, [lot.id, lot.pastCloses?.n, matchedIds]);
  const p = pastPrice(lot);
  return (
    <div>
      <h3>
        Closed before ({fmtCount(lot.pastCloses!.n)})
        {p && (
          <span class="muted small">
            {' '}
            · usually {dollars(p.median)}
            {p.sameCondition && lot.condition ? ` (${lot.condition.label})` : ''}
          </span>
        )}
      </h3>
      {error && <p class="error">Couldn’t load past closes: {error}</p>}
      {!closes && !error && <p class="muted small">Loading…</p>}
      {closes && (
        <ol class="past">
          {closes.map((c) => (
            <li>
              <span class="price" title={c.final ? undefined : 'The last price seen before it closed; the site no longer has the lot'}>
                {c.sold ? dollars(c.price) : 'No sale'}
                {!c.final && '*'}
              </span>
              <span class="past-what muted small">
                {c.title !== lot.title && (
                  <a class="dupe-title" href={lotHref(c.auctionPeriod, c.id)} target="_blank" rel="noopener">
                    {c.title}
                  </a>
                )}
                {c.condition ?? 'Unknown'} · {c.location ?? 'Unknown'} · {plural(c.bidCount, 'bid')}
              </span>
              <a class="muted small" href={lotHref(c.auctionPeriod, c.id)} target="_blank" rel="noopener" title="Open on Triangle Liquidators">
                {shortDate(c.endsAt)}
              </a>
            </li>
          ))}
        </ol>
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

  const blocker = bidBlocker(row, now);
  if (blocker) {
    return (
      <div class="bid-panel">
        {!authed ? (
          <span class="muted">
            <LoginLink>Log in</LoginLink> to bid here.
          </span>
        ) : (
          <span class="btn" aria-disabled="true">
            {blocker}
          </span>
        )}
      </div>
    );
  }

  const leading = isLeading(lot);
  const min = minMaxBid(lot);
  const quick = quickBidAmount(lot);
  const n = parseNum(value);
  const error = maxBidError(value, n, min);

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
            onInput={(e) => setValue(e.currentTarget.value)}
          />
        </label>
        <button type="submit" class="btn" aria-disabled={n == null || error || pending ? 'true' : undefined}>
          {leading ? 'Raise max bid' : 'Set max bid'}
        </button>
        {!leading && (
          <button
            type="button"
            class="btn btn-outline"
            disabled={pending}
            onClick={() => modalActions.startBid({ lotId: lot.id, amount: quick, type: 'next_increment' })}
            title="Bid the next increment now"
          >
            Bid {dollars(quick)}
          </button>
        )}
      </div>
      <div class={`small ${error ? 'error' : 'muted'}`}>
        {pending
          ? 'Placing bid…'
          : error ||
          (leading
            ? `You’re winning. Raise your max to ${dollars(min)} or more.`
            : 'A max bid bids for you automatically, only as much as needed to keep you winning.')}
      </div>
    </form>
  );
}

/** Why the typed max bid can't be used, or null if it's fine (or empty). */
function maxBidError(text: string, n: number | null, min: number): string | null {
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
