// The site's "Closed Auctions" pages (Won / Lost), shown in place of the grid.
// Each lot opens in the usual popup; matching items listed again
// (matched like duplicate listings) are offered right under the lot, so a
// lost item can be bid on again.
import { useEffect, useMemo, useState } from 'preact/hooks';

import { costBreakdown, dollars, money, totalCost } from '../shared/cost';
import { lotHref } from '../shared/keys';
import { DEFAULT_NAME_MATCH, itemIdentity, itemsMatch } from '../shared/names';
import { CDN, fetchClosed, type ClosedSection } from './api';
import { isAuthenticated, LoginLink } from './auth';
import { getLot, loadDetail, lotBrands, lotModels, lots as catalogLots, rev } from './catalog';
import { Icon } from './icons';
import { ListingRow } from './ListingRow';
import { LotModal } from './LotModal';
import { exclusionRules, openClosed, openLot, pickupName, rowOf } from './state';
import { toast } from './toast';
import type { ClosedLot, Lot } from './types';
import { clock, fmtCount, MINUTE, openHandler, plural } from './util';
import { makeRow, type Row } from './view';

/** A fetched section is shown again without refetching for this long. */
const FRESH = 2 * MINUTE;

const TITLES: Record<ClosedSection, string> = { won: 'Won', lost: 'Lost' };

interface Loaded {
  lots: ClosedLot[];
  count: number; // what the site reports, while pages are still arriving
  done: boolean;
  at: number;
  error?: string;
}

/** Last fetch of each section, kept while the app is open. */
const cache = new Map<ClosedSection, Loaded>();

function useClosed(section: ClosedSection, authed: boolean): Loaded | null {
  const [data, setData] = useState<Loaded | null>(() => cache.get(section) ?? null);
  useEffect(() => {
    setData(cache.get(section) ?? null);
    const hit = cache.get(section);
    if (!authed || (hit && !hit.error && Date.now() - hit.at < FRESH)) {
      return;
    }
    const ac = new AbortController();
    const put = (d: Loaded) => {
      cache.set(section, d);
      if (!ac.signal.aborted) {
        setData(d);
      }
    };
    fetchClosed(
      section,
      (lots, count) => put({ lots, count, done: false, at: Date.now() }),
      ac.signal,
    ).then(
      (lots) => put({ lots, count: lots.length, done: true, at: Date.now() }),
      (e) =>
        !ac.signal.aborted &&
        put({
          lots: hit?.lots ?? [],
          count: 0,
          done: true,
          at: 0,
          error: e instanceof Error ? e.message : String(e) || String(e),
        }),
    );
    return () => ac.abort();
  }, [section, authed]);
  return data;
}

export function ClosedLots({ section }: { section: ClosedSection }) {
  const authed = isAuthenticated();
  const data = useClosed(section, authed);
  const pickup = pickupName.value;
  const exclusions = exclusionRules.value;
  const [filter, setFilter] = useState('');
  const [opening, setOpening] = useState<number | null>(null);
  const [modalLot, setModalLot] = useState<Lot | null>(null);
  const now = clock(30_000);

  const brands = lotBrands.value;
  const models = lotModels.value;
  const open = useMemo(
    () =>
      catalogLots.value
        .values()
        .filter((l) => Temporal.Instant.compare(l.endsAt, now) > 0)
        .map((l) => ({ lot: l, identity: itemIdentity(l, { brands, models }) }))
        .toArray(),
    [catalogLots.value, rev.value, now, brands, models],
  );
  const relisted = useMemo(() => {
    const out = new Map<string, Row[]>();
    for (const c of data?.lots ?? []) {
      const identity = itemIdentity({ ...c, id: c.lotId }, { brands, models });
      const rows = open
        .filter((o) => o.lot.id !== c.lotId && itemsMatch(identity, o.identity, DEFAULT_NAME_MATCH))
        .map((o) => makeRow(o.lot, pickup, exclusions))
        .toSorted((a, b) => a.total - b.total);
      if (rows.length) {
        out.set(key(c), rows);
      }
    }
    return out;
  }, [data?.lots, open, pickup, exclusions, brands, models]);

  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const lots = (data?.lots ?? []).filter((c) => {
    const hay = `${c.title} ${c.lotNumber} ${c.locationName ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const bids = lots.reduce((n, c) => n + c.finalPrice, 0);
  const total = lots.reduce((n, c) => n + totalCost(c.finalPrice), 0);

  const openClosedLot = (c: ClosedLot) => {
    const inCatalog = getLot(c.lotId);
    if (inCatalog) {
      openLot(inCatalog);
      return;
    }
    setOpening(c.lotId);
    loadDetail({ id: c.lotId, auctionPeriod: c.auctionPeriod }).then(
      (lot) => {
        setOpening(null);
        setModalLot(lot);
      },
      (e) => {
        setOpening(null);
        toast('bad', `Couldn’t load the lot: ${e instanceof Error ? e.message : String(e) || e}`);
      },
    );
  };

  return (
    <section class="closed">
      <div class="closed-head">
        <button type="button" class="btn btn-text" onClick={() => openClosed(null)}>
          <Icon name="chevronLeft" size={18} /> Catalog
        </button>
        <h1>Closed auctions</h1>
      </div>
      <div class="tabs" role="tablist">
        {(['won', 'lost'] as const).map((s) => {
          const d = s === section ? data : cache.get(s);
          return (
            <button
              type="button"
              role="tab"
              aria-selected={s === section}
              class={s === section ? 'on' : ''}
              onClick={() => openClosed(s)}
            >
              {TITLES[s]}
              {d?.done && !d.error && <span class="muted"> ({fmtCount(d.lots.length)})</span>}
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
            <input
              type="search"
              placeholder={`Filter ${TITLES[section].toLowerCase()} lots`}
              aria-label="Filter lots"
              value={filter}
              onInput={(e) => setFilter(e.currentTarget.value)}
            />
            {data && !data.error && (
              <span class="muted small">
                {data.done
                  ? plural(lots.length, 'lot')
                  : `Loading… ${fmtCount(data.lots.length)} of ${fmtCount(data.count)}`}
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
          {data?.error && (
            <p class="error">
              Couldn’t load your {TITLES[section].toLowerCase()} lots: {data.error}
            </p>
          )}
          {!data && <p class="muted">Loading…</p>}
          {data?.done && !data.error && !data.lots.length && (
            <p class="muted">
              {section === 'won' ? 'No won lots.' : 'No lost lots in the last 14 days.'}
            </p>
          )}
          <ol class="closed-list">
            {lots.map((c) => (
              <ClosedRow
                key={key(c)}
                lot={c}
                won={section === 'won'}
                relisted={relisted.get(key(c))}
                opening={opening === c.lotId}
                onOpen={() => openClosedLot(c)}
              />
            ))}
          </ol>
        </>
      )}

      {modalLot && (
        <LotModal
          row={rowOf(modalLot)}
          onClose={() => setModalLot(null)}
          onOpenLot={(l) => {
            setModalLot(null);
            openLot(l);
          }}
        />
      )}
    </section>
  );
}

const key = (c: ClosedLot) => `${c.auctionPeriod}:${c.lotId}`;

function ClosedRow(props: {
  lot: ClosedLot;
  won: boolean;
  relisted?: Row[] | undefined;
  opening: boolean;
  onOpen: () => void;
}) {
  const { lot: c, won, relisted, opening, onOpen } = props;
  const [showRelisted, setShowRelisted] = useState(false);
  const href = lotHref(c.auctionPeriod, c.lotId);
  const click = openHandler(onOpen);
  return (
    <li class={`closed-row ${opening ? 'opening' : ''}`}>
      <div class="closed-main">
        <a class="closed-img" href={href} onClick={click} tabIndex={-1} aria-hidden="true">
          {c.heroImage ? (
            <img src={`${CDN}/${c.heroImage}`} alt="" loading="lazy" />
          ) : (
            <span class="noimg" />
          )}
        </a>
        <div class="closed-what">
          <a class="closed-title" href={href} onClick={click}>
            {c.title}
          </a>
          <span class="muted small">
            {c.locationName ?? 'Unknown'} · Lot #{c.lotNumber}
            {relisted && (
              <>
                {' · '}
                <button
                  type="button"
                  class="link-button"
                  aria-expanded={showRelisted}
                  onClick={() => setShowRelisted(!showRelisted)}
                >
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
            <ListingRow
              key={r.lot.id}
              row={r}
              currentTitle={c.title}
              showCondition
              onOpen={openLot}
            />
          ))}
        </ol>
      )}
    </li>
  );
}
