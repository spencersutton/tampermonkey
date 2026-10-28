import { useEffect, useRef, useState } from 'preact/hooks';
import { costBreakdown, dollars, money } from '../shared/cost';
import { lotHref } from '../shared/keys';
import { CDN } from './api';
import { LoginLink, useAuthed } from './auth';
import { bidBlocker, isLeading, minMaxBid, quickBidAmount, useBidPending, type BidRequest } from './bid';
import { cachedDetail, getLot, loadDetail } from './catalog';
import { useConditions } from './conditions';
import { Icon } from './icons';
import { LocationText, pastPrice, StandingBadge, TimeLeft, WatchButton } from './LotCard';
import { fetchPastCloses } from './source';
import { fmtCount, openHandler, parseNum, plural, shortDate, shortTime, useDialog, useNow } from './util';
import type { Lot, LotDetail, PastCloseDetail } from './types';
import type { Row } from './view';

interface Props {
  row: Row;
  onClose: () => void;
  onToggleHide: () => void;
  onBid: (req: BidRequest) => void;
  group?: Row[]; // listings of the same item, cheapest total first
  onOpenLot?: (lot: Lot) => void;
}

/** Popup with full lot details, images, bid history and bidding. */
export function LotModal({ row, onClose, onToggleHide, onBid, group, onOpenLot }: Props) {
  const { lot } = row;
  const [detail, setDetail] = useState<LotDetail | null>(() => cachedDetail(lot.id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const conditions = useConditions();

  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    loadDetail(lot, ac.signal).then(setDetail, (e) => {
      if (!ac.signal.aborted) {
        setError((e as Error).message || String(e));
      }
    });
    return () => ac.abort();
  }, [lot.id, lot.yourStanding?.yourMaxBid, lot.yourStanding?.isLeading]);

  const images = (detail ?? lot).images;
  const img = images[Math.min(imgIdx, images.length - 1)];
  /** Move through the images by `delta`, wrapping around. */
  const step = (delta: number) => setImgIdx((i) => (i + delta + images.length) % Math.max(images.length, 1));

  useDialog(dialog, (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === 'Escape') {
      onClose();
    } else if (!typing && e.key === 'ArrowLeft') {
      step(-1);
    } else if (!typing && e.key === 'ArrowRight') {
      step(1);
    }
  });
  // Switching to another listing or similar lot starts at the top.
  useEffect(() => dialog.current?.scrollTo(0, 0), [lot.id]);
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="lot-title" tabIndex={-1} ref={dialog}>
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
            {detail && <BrandModel brand={detail.brand} model={detail.model} />}
            <div class="card-meta">
              <LocationText row={row} />
              {lot.condition && <span title={conditions.get(lot.condition.value)?.description}>{lot.condition.label}</span>}
              {row.category && <span>{row.category.label}</span>}
              <span>Lot #{lot.lotNumber}</span>
            </div>
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
            <BidPanel row={row} onBid={onBid} />
            <div class="row-gap">
              <a class="btn btn-text" href={lotHref(lot.auctionPeriod, lot.id)} target="_blank" rel="noopener">
                Open on Triangle Liquidators <Icon name="open" size={16} />
              </a>
              <WatchButton lot={lot} />
              <button type="button" class="btn btn-text" onClick={onToggleHide}>
                <Icon name={row.hidden ? 'visibility' : 'visibilityOff'} /> {row.hidden ? 'Unhide' : 'Hide'}
              </button>
            </div>

            {group && group.length > 1 && onOpenLot && <SameListings group={group} current={lot} onOpen={onOpenLot} />}
            {lot.pastCloses && <PastCloses lot={lot} />}

            {error && <p class="error">Couldn’t load lot details: {error}</p>}
            {!detail && !error && <p class="muted">Loading details…</p>}
            {detail && (
              <>
                {detail.description && <div class="description">{detail.description}</div>}
                {detail.bidHistory.length > 0 && (
                  <div>
                    <h3>Bid history</h3>
                    <ol class="bids">
                      {detail.bidHistory.map((b) => (
                        <li class={b.isYou ? 'you' : ''}>
                          <span>{b.isYou ? 'You' : b.bidderLabel}</span>
                          <span>{dollars(b.amount)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                {detail.similar.length > 0 && <Similar lots={detail.similar} current={lot} onOpen={onOpenLot} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Brand and model, right under the title. The model (or the brand, if there's
 * no model) links to a Google search for both, to look up specs and prices.
 */
function BrandModel({ brand, model }: { brand: string | null; model: string | null }) {
  if (!brand && !model) {
    return null;
  }
  const query = [brand, model].filter(Boolean).join(' ');
  const search = (text: string) => (
    <a href={`https://www.google.com/search?q=${encodeURIComponent(query)}`} target="_blank" rel="noopener" title={`Search Google for “${query}”`}>
      {text} <Icon name="open" size={14} />
    </a>
  );
  return (
    <dl class="brand-model">
      {brand && (
        <div>
          <dt>Brand</dt>
          <dd>{model ? brand : search(brand)}</dd>
        </div>
      )}
      {model && (
        <div>
          <dt>Model</dt>
          <dd>{search(model)}</dd>
        </div>
      )}
    </dl>
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
function Similar({ lots, current, onOpen }: { lots: Lot[]; current: Lot; onOpen?: (lot: Lot) => void }) {
  const now = useNow(30_000);
  const open = lots.map((l) => getLot(l.id) ?? l).filter((l) => l.id !== current.id && l.endsAt > now);
  if (!open.length) {
    return null;
  }
  return (
    <div>
      <h3>Similar auctions</h3>
      <ol class="similar">
        {open.map((l) => {
          const img = l.images[0];
          const inCatalog = !!getLot(l.id) && onOpen;
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

/** What earlier lots with this name closed at, fetched in full when the popup opens. */
function PastCloses({ lot }: { lot: Lot }) {
  const [closes, setCloses] = useState<PastCloseDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setCloses(null);
    setError(null);
    fetchPastCloses(lot.id).then(
      (c) => live && setCloses(c),
      (e) => live && setError((e as Error).message),
    );
    return () => void (live = false);
  }, [lot.id, lot.pastCloses?.n]);
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
                {c.condition ?? 'Unknown'} · {c.location ?? 'Unknown'} · {plural(c.bidCount ?? 0, 'bid')}
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
function BidPanel({ row, onBid }: { row: Row; onBid: (req: BidRequest) => void }) {
  const { lot } = row;
  const now = useNow(1000);
  const pending = useBidPending(lot.id);
  const authed = useAuthed();
  const [value, setValue] = useState('');
  useEffect(() => setValue(''), [lot.id, lot.yourStanding?.yourMaxBid]);

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
      onBid({ lotId: lot.id, amount: n, type: 'max_bid' });
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
        <button type="submit" class="btn" aria-disabled={n == null || !!error || pending ? 'true' : undefined}>
          {leading ? 'Raise max bid' : 'Set max bid'}
        </button>
        {!leading && (
          <button
            type="button"
            class="btn btn-outline"
            disabled={pending}
            onClick={() => onBid({ lotId: lot.id, amount: quick, type: 'next_increment' })}
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
