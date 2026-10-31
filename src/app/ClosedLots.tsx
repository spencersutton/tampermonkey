// The site's "Closed Auctions" pages (Won / Lost), shown in place of the grid.
// Each lot opens in the usual popup; lots listed again under the same name
// (matched like duplicate listings) are offered right under the lot, so a
// lost item can be bid on again.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { costBreakdown, dollars, money, totalCost } from '../shared/cost';
import { KEYS, lotHref } from '../shared/keys';
import { nameMatchPct, namesMatch, nameTokens } from '../shared/names';
import { CDN, fetchClosed, type ClosedSection } from './api';
import { isAuthenticated, LoginLink, me } from './auth';
import { getLot, loadDetail, lots as catalogLots, rev } from './catalog';
import type { ClosedCounts } from './closedStream';
import { Icon } from './icons';
import { LocationText, TimeLeft } from './LotCard';
import { LotModal } from './LotModal';
import { useSetting } from './settings';
import { toast } from './toast';
import type { ClosedLot, Lot } from './types';
import { clock, fmtCount, plural, shortDate } from './util';
import type { Row } from './view';

const TITLES: Record<ClosedSection, string> = { won: 'Won', lost: 'Lost' };

interface Loaded {
  lots: ClosedLot[];
  count: number; // what the site reports, while pages are still arriving
  done: boolean;
  error?: string;
}

function useClosed(section: ClosedSection, authed: boolean): { data: Loaded | null; counts: ClosedCounts } {
  const [state, setState] = useState<{ section: ClosedSection; data: Loaded | null; counts: ClosedCounts }>({
    section, data: null, counts: {},
  });
  useEffect(() => {
    setState({ section, data: null, counts: {} });
    if (!authed) {
      return;
    }
    const ac = new AbortController();
    fetchClosed(section, (lots, count, counts) => {
      if (!ac.signal.aborted) {
        setState({ section, data: { lots, count, done: false }, counts });
      }
    }, ac.signal).then(
      (lots) => !ac.signal.aborted && setState((s) => ({ section, data: { lots, count: lots.length, done: true }, counts: { ...s.counts, [section]: lots.length } })),
      (e) => !ac.signal.aborted && setState({ section, data: { lots: [], count: 0, done: true, error: (e as Error).message || String(e) }, counts: {} }),
    );
    return () => ac.abort();
  }, [section, authed]);
  return state.section === section && authed ? state : { data: null, counts: {} };
}

interface Props {
  section: ClosedSection;
  onSection: (s: ClosedSection) => void;
  onBack: () => void;
  onOpenLot: (lot: Lot) => void; // a lot in the catalog
  onToggleHide: (lot: Lot) => void;
  rowOf: (lot: Lot) => Row;
}

export function ClosedLots(props: Props) {
  const authed = isAuthenticated();
  const account = me.value?.site?.email ?? null;
  return <ClosedLotsContent key={`${authed}:${account ?? ''}`} {...props} authed={authed} />;
}

function ClosedLotsContent({ section, onSection, onBack, onOpenLot, onToggleHide, rowOf, authed }: Props & { authed: boolean }) {
  const { data, counts } = useClosed(section, authed);
  const [nameMatch] = useSetting(KEYS.nameMatch);
  const [filter, setFilter] = useState('');
  const [opening, setOpening] = useState<number | null>(null);
  const [modalLot, setModalLot] = useState<Lot | null>(null);
  const now = clock(30_000);

  // Open lots by their title words, to find the ones listed again.
  const open = useMemo(
    () =>
      catalogLots.value
        .values()
        .filter((l) => l.endsAt > now)
        .map((l) => ({ lot: l, words: nameTokens(l.title) }))
        .toArray(),
    [catalogLots.value, rev.value, now],
  );
  const pct = nameMatchPct(nameMatch);
  const relisted = useMemo(() => {
    const out = new Map<string, Row[]>();
    for (const c of data?.lots ?? []) {
      const words = nameTokens(c.title);
      const rows = open
        .filter((o) => o.lot.id !== c.lotId && namesMatch(words, o.words, pct))
        .map((o) => rowOf(o.lot))
        .sort((a, b) => a.total - b.total);
      if (rows.length) {
        out.set(key(c), rows);
      }
    }
    return out;
  }, [data?.lots, open, pct, rowOf]);

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const lots = (data?.lots ?? []).filter((c) => {
    const hay = `${c.title} ${c.lotNumber} ${c.locationName ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const bids = lots.reduce((n, c) => n + c.finalPrice, 0);
  const total = lots.reduce((n, c) => n + totalCost(c.finalPrice), 0);

  const openClosed = (c: ClosedLot) => {
    const inCatalog = getLot(c.lotId);
    if (inCatalog) {
      onOpenLot(inCatalog);
      return;
    }
    setOpening(c.lotId);
    loadDetail({ id: c.lotId, auctionPeriod: c.auctionPeriod }).then(
      ({ description, brand, model, lotFee, bidHistory, similar, ...lot }) => {
        setOpening(null);
        setModalLot(lot);
      },
      (e) => {
        setOpening(null);
        toast('bad', `Couldn’t load the lot: ${(e as Error).message || e}`);
      },
    );
  };

  return (
    <section class="closed">
      <div class="closed-head">
        <button type="button" class="btn btn-text" onClick={onBack}>
          <Icon name="chevronLeft" size={18} /> Catalog
        </button>
        <h1>Closed auctions</h1>
      </div>
      <div class="tabs" role="tablist">
        {(['won', 'lost'] as const).map((s) => {
          const count = counts[s];
          return (
            <button type="button" role="tab" aria-selected={s === section} class={s === section ? 'on' : ''} onClick={() => onSection(s)}>
              {TITLES[s]}
              {count != null && <span class="muted"> ({fmtCount(count)})</span>}
            </button>
          );
        })}
      </div>

      {!authed ? (
        <p class="notice">
          <LoginLink>Log in</LoginLink> to see the lots you won and lost.
        </p>
      ) : (
        <>
          <div class="closed-tools">
            <input type="search" placeholder={`Filter ${TITLES[section].toLowerCase()} lots`} aria-label="Filter lots" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
            {data && !data.error && (
              <span class="muted small">
                {data.done ? plural(lots.length, 'lot') : `Loading… ${fmtCount(data.lots.length)} of ${fmtCount(data.count)}`}
                {section === 'won' && lots.length > 0 && (
                  <span title="Each lot's winning bid plus the buyer's premium, lot fee and sales tax (transfer fees not included)">
                    {' '}
                    · {dollars(bids)} in bids · ≈ {money(total)} with fees and tax
                  </span>
                )}
                {section === 'lost' && ' · the site keeps lost lots for 14 days'}
              </span>
            )}
          </div>
          {data?.error && <p class="error">Couldn’t load your {TITLES[section].toLowerCase()} lots: {data.error}</p>}
          {!data && <p class="muted">Loading…</p>}
          {data?.done && !data.error && !data.lots.length && <p class="muted">{section === 'won' ? 'No won lots.' : 'No lost lots in the last 14 days.'}</p>}
          <ol class="closed-list">
            {lots.map((c) => (
              <ClosedRow
                key={key(c)}
                lot={c}
                won={section === 'won'}
                relisted={relisted.get(key(c))}
                opening={opening === c.lotId}
                onOpen={() => openClosed(c)}
                onOpenLot={onOpenLot}
              />
            ))}
          </ol>
        </>
      )}

      {modalLot && (
        <LotModal
          row={rowOf(modalLot)}
          onClose={() => setModalLot(null)}
          onToggleHide={() => onToggleHide(modalLot)}
          onBid={() => {}}
          onOpenLot={(l) => {
            setModalLot(null);
            onOpenLot(l);
          }}
        />
      )}
    </section>
  );
}

const key = (c: ClosedLot) => `${c.auctionPeriod}:${c.lotId}`;

function ClosedRow(props: { lot: ClosedLot; won: boolean; relisted?: Row[]; opening: boolean; onOpen: () => void; onOpenLot: (lot: Lot) => void }) {
  const { lot: c, won, relisted, opening, onOpen, onOpenLot } = props;
  const [showRelisted, setShowRelisted] = useState(false);
  const href = lotHref(c.auctionPeriod, c.lotId);
  const click = (e: MouseEvent) => {
    if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <li class={`closed-row ${opening ? 'opening' : ''}`}>
      <div class="closed-main">
        <a class="closed-img" href={href} onClick={click} tabIndex={-1} aria-hidden="true">
          {c.heroImage ? <img src={`${CDN}/${c.heroImage}`} alt="" loading="lazy" /> : <span class="noimg" />}
        </a>
        <div class="closed-what">
          <a class="closed-title" href={href} onClick={click}>
            {c.title}
          </a>
          <span class="muted small">
            {c.locationName ?? 'Unknown'} · Lot #{c.lotNumber}
            {c.endsAt != null && ` · ${shortDate(c.endsAt)}`}
            {relisted && (
              <>
                {' · '}
                <button type="button" class="link-button" aria-expanded={showRelisted} onClick={() => setShowRelisted(!showRelisted)}>
                  {plural(relisted.length, 'listing')} open now
                </button>
              </>
            )}
          </span>
        </div>
        <div class="closed-price">
          <span class="price">{dollars(c.finalPrice)}</span>
          {won ? (
            <span class="muted small" title={costBreakdown(c.finalPrice)}>
              ≈ {money(totalCost(c.finalPrice))}
            </span>
          ) : (
            <span class="muted small">sold for</span>
          )}
        </div>
      </div>
      {showRelisted && relisted && (
        <ol class="dupes closed-relisted">
          {relisted.map((r) => (
            <li>
              <button type="button" onClick={() => onOpenLot(r.lot)}>
                <span class="price" title={costBreakdown(r.lot.currentPrice, r.transferFee)}>
                  {dollars(r.lot.currentPrice)} <span class="muted small">≈ {money(r.total)}</span>
                </span>
                <span class="muted small">
                  {r.lot.title !== c.title && <span class="dupe-title">{r.lot.title}</span>}
                  {r.lot.condition?.label ?? 'Unknown'} · <LocationText row={r} /> · {plural(r.lot.bidCount, 'bid')}
                </span>
                <TimeLeft endsAt={r.lot.endsAt} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
