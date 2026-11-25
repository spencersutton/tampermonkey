import { useEffect, useMemo, useState } from 'preact/hooks';

import { CDN } from '../../shared/constants';
import { costBreakdown, totalCost } from '../../shared/cost';
import * as format from '../../shared/format';
import { lotHref } from '../../shared/keys';
// The site's "Closed Auctions" pages (Won / Lost), shown in place of the grid.
// Each lot opens in the usual popup; matching items listed again (found by
// the tlx server, which matches them like duplicate listings) are offered
// right under the lot, so a lost item can be bid on again.
import type { Lot } from '../../shared/lot';
import {
  closedLotKey,
  closedTotals,
  closedTransferFee,
  collectByDate,
  filterClosedLots,
  relistedRowsFor,
} from '../logic/closed';
import { errorMessage, plural } from '../logic/util';
import type { Row } from '../logic/view';
import type { ClosedSection } from '../server/api';
import { isAuthenticated } from '../server/auth';
import { getLot, loadDetail, lots as catalogLots, rev } from '../server/catalog';
import { getCachedClosed, loadClosedSection, type ClosedCache } from '../server/closed';
import { clock } from '../server/reactive';
import { toast } from '../server/toast';
import type { ClosedLot } from '../types';
import { LoginLink } from './Auth';
import { openHandler } from './dom';
import { Icon } from './icons';
import { ListingRow } from './ListingRow';
import { LotModal } from './LotModal';
import { exclusionRules, openClosed, openLot, pickupName, rowOf } from './state';

const TITLES: Record<ClosedSection, string> = { won: 'Won', lost: 'Lost' };

function useClosed(section: ClosedSection, authed: boolean): ClosedCache | null {
  const [data, setData] = useState<ClosedCache | null>(() => getCachedClosed(section));
  useEffect(() => {
    setData(getCachedClosed(section));
    return loadClosedSection(section, authed, setData);
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

  const relisted = useMemo(
    () => relistedRowsFor(data?.lots ?? [], catalogLots.value, now, pickup, exclusions),
    [data?.lots, catalogLots.value, rev.value, now, pickup, exclusions],
  );

  const lots = filterClosedLots(data?.lots ?? [], filter);
  const { bids, total } = closedTotals(lots, pickup);

  const openClosedLot = (c: ClosedLot) => {
    const inCatalog = getLot(c.lot_id);
    if (inCatalog) {
      openLot(inCatalog);
      return;
    }
    setOpening(c.lot_id);
    loadDetail({ id: c.lot_id, auction_period: c.auction_period }).then(
      lot => {
        setOpening(null);
        setModalLot(lot);
      },
      e => {
        setOpening(null);
        toast('bad', `Couldn’t load the lot: ${errorMessage(e) || String(e)}`);
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
        {(['won', 'lost'] as const).map(s => {
          const d = s === section ? data : getCachedClosed(s);
          return (
            <button
              type="button"
              role="tab"
              aria-selected={s === section}
              class={s === section ? 'on' : ''}
              onClick={() => openClosed(s)}
            >
              {TITLES[s]}
              {d?.done && !d.error && <span class="muted"> ({format.num(d.lots.length)})</span>}
            </button>
          );
        })}
      </div>

      {!authed && (
        <p class="notice">
          <LoginLink>Log in</LoginLink> to see the lots you won and lost.
        </p>
      )}
      {authed && (
        <>
          <div class="closed-tools">
            <input
              type="search"
              placeholder={`Filter ${TITLES[section].toLowerCase()} lots`}
              aria-label="Filter lots"
              value={filter}
              onInput={e => setFilter(e.currentTarget.value)}
            />
            {data && !data.error && (
              <span class="muted small">
                {data.done && plural(lots.length, 'lot')}
                {!data.done &&
                  `Loading… ${format.num(data.lots.length)} of ${format.num(data.count)}`}
                {section === 'won' && lots.length > 0 && (
                  <span title="Each lot's winning bid plus the buyer's premium, lot fee and sales tax, plus the transfer fee for lots not at your pickup location">
                    {' '}
                    · {format.dollars(bids)} in bids · ≈ {format.money(total)} with fees and tax
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
            {lots.map(c => (
              <ClosedRow
                key={closedLotKey(c)}
                lot={c}
                won={section === 'won'}
                relisted={relisted.get(closedLotKey(c))}
                opening={opening === c.lot_id}
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
          onOpenLot={l => {
            setModalLot(null);
            openLot(l);
          }}
        />
      )}
    </section>
  );
}

function ClosedRow(props: {
  lot: ClosedLot;
  won: boolean;
  relisted?: Row[] | undefined;
  opening: boolean;
  onOpen: () => void;
}) {
  const { lot: c, won, relisted, opening, onOpen } = props;
  const fee = closedTransferFee(c, pickupName.value);
  const [showRelisted, setShowRelisted] = useState(false);
  const href = lotHref(c.auction_period, c.lot_id);
  const click = openHandler(onOpen);
  let hero = <span class="noimg" />;
  if (c.hero_image) {
    hero = <img src={`${CDN}/${c.hero_image}`} alt="" loading="lazy" />;
  }
  let priceNote = <span class="muted small">sold for</span>;
  if (won) {
    priceNote = (
      <span class="muted small" title={costBreakdown(c.final_price, fee)}>
        ≈ {format.money(totalCost(c.final_price, fee))}
      </span>
    );
  }
  return (
    <li class={`closed-row ${opening ? 'opening' : ''}`}>
      <div class="closed-main">
        <a class="closed-img" href={href} onClick={click} tabIndex={-1} aria-hidden="true">
          {hero}
        </a>
        <div class="closed-what">
          <a class="closed-title" href={href} onClick={click}>
            {c.title}
          </a>
          <span class="muted small">
            {c.location_name} · Lot #{c.lot_number}
            {c.fulfillment_status && ` · ${c.fulfillment_status}`}
            {c.collect_by_date &&
              ` · collect by ${format.shortDate(collectByDate(c.collect_by_date))}`}
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
          <span class="price">{format.dollars(c.final_price)}</span>
          {priceNote}
        </div>
      </div>
      {showRelisted && relisted && (
        <ol class="dupes closed-relisted">
          {relisted.map(r => (
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
