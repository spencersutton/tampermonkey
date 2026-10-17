import { useEffect, useRef, useState } from 'preact/hooks';
import { costBreakdown, dollars, money } from '../shared/cost';
import { lotHref } from '../shared/keys';
import { CDN, isAuthenticated } from './api';
import { bidBlocker, isLeading, minMaxBid, quickBidAmount, useBidPending, type BidRequest } from './bid';
import { cachedDetail, loadDetail } from './catalog';
import { Icon } from './icons';
import { LocationText, StandingBadge, TimeLeft } from './LotCard';
import { fmtCount, parseNum, useNow } from './util';
import type { LotDetail } from './types';
import type { Row } from './view';

interface Props {
  row: Row;
  onClose: () => void;
  onToggleHide: () => void;
  onBid: (req: BidRequest) => void;
}

export function LotModal({ row, onClose, onToggleHide, onBid }: Props) {
  const { lot } = row;
  const [detail, setDetail] = useState<LotDetail | null>(() => cachedDetail(lot.id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    setError(null);
    loadDetail(lot, ac.signal).then(setDetail, (e) => {
      if (!ac.signal.aborted) setError((e as Error).message || String(e));
    });
    return () => ac.abort();
  }, [lot.id, lot.yourStanding?.yourMaxBid, lot.yourStanding?.isLeading]);

  const images = (detail ?? lot).images;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      else if (e.key === 'ArrowLeft') setImgIdx((i) => (i - 1 + images.length) % Math.max(images.length, 1));
      else if (e.key === 'ArrowRight') setImgIdx((i) => (i + 1) % Math.max(images.length, 1));
    };
    document.addEventListener('keydown', onKey);
    const prevFocus = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      prevFocus?.focus?.();
    };
  }, [images.length]);

  const img = images[Math.min(imgIdx, images.length - 1)];

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
                  <button type="button" class="icon-btn gal-prev" aria-label="Previous image" onClick={() => setImgIdx((i) => (i - 1 + images.length) % images.length)}>
                    <Icon name="chevronLeft" size={24} />
                  </button>
                  <button type="button" class="icon-btn gal-next" aria-label="Next image" onClick={() => setImgIdx((i) => (i + 1) % images.length)}>
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
            <div class="card-meta">
              <LocationText row={row} />
              {lot.condition && <span>{lot.condition.label}</span>}
              {lot.category && <span>{lot.category.label}</span>}
              <span>Lot #{lot.lotNumber}</span>
            </div>
            <div class="modal-price">
              <div>
                <div class="price big">{dollars(lot.currentPrice)}</div>
                <div class="muted small">Current bid · {fmtCount(lot.bidCount)} bids</div>
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
                <div class="muted small">{new Date(lot.endsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</div>
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
              <button type="button" class="btn btn-text" onClick={onToggleHide}>
                <Icon name={row.hidden ? 'visibility' : 'visibilityOff'} /> {row.hidden ? 'Unhide' : 'Hide'}
              </button>
            </div>

            {error && <p class="error">Couldn’t load lot details: {error}</p>}
            {!detail && !error && <p class="muted">Loading details…</p>}
            {detail && (
              <>
                {(detail.brand || detail.model) && (
                  <p class="small">
                    {detail.brand && <span>Brand: {detail.brand}</span>}
                    {detail.brand && detail.model && ' · '}
                    {detail.model && <span>Model: {detail.model}</span>}
                  </p>
                )}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BidPanel({ row, onBid }: { row: Row; onBid: (req: BidRequest) => void }) {
  const { lot } = row;
  const now = useNow(1000);
  const pending = useBidPending(lot.id);
  const [value, setValue] = useState('');
  useEffect(() => setValue(''), [lot.id, lot.yourStanding?.yourMaxBid]);

  const blocker = bidBlocker(row, now);
  if (blocker) {
    return (
      <div class="bid-panel">
        {!isAuthenticated() ? (
          <span class="muted">
            <a href="/">Log in on Triangle Liquidators</a>, then reload this page to bid here.
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
  const n = value.trim() ? parseNum(value) : null;
  const error =
    value.trim() && n == null
      ? 'Enter a dollar amount'
      : n != null && !Number.isInteger(n)
        ? 'Whole dollars only'
        : n != null && n < min
          ? `Must be at least ${dollars(min)}`
          : null;

  const submit = (e: Event) => {
    e.preventDefault();
    if (n == null || error || pending) return;
    onBid({ lotId: lot.id, amount: n, type: 'max_bid' });
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
