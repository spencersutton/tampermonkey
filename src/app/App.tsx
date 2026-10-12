import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { KEYS, lotHref } from '../shared/keys';
import { fetchPickupLocation, isAuthenticated } from './api';
import { getLot, nextPullAt, pullCatalog, useCatalog } from './catalog';
import { getSetting, setSetting, useSetting } from './gm';
import { Icon } from './icons';
import { watchLots, useLiveState } from './live';
import { LotCard } from './LotCard';
import { LotModal } from './LotModal';
import { Sidebar } from './Sidebar';
import { ago, countdown, fmtCount, useNow } from './util';
import { computeFacets, computeView, makeRow, normalizeView, SORTS, activeFilterCount, type ViewState } from './view';
import type { Lot } from './types';

const PAGE_SIZE = 60;
const DAY = 86400_000;

function useAccountPickup(lots: Map<number, Lot>): string | null {
  const [acct] = useSetting(KEYS.accountPickup);
  useEffect(() => {
    if (!isAuthenticated() || (acct && Date.now() - acct.at < DAY)) return;
    fetchPickupLocation().then(
      (p) => setSetting(KEYS.accountPickup, { id: p?.id ?? null, name: p?.name ?? null, at: Date.now() }),
      () => {},
    );
  }, []);
  if (!acct) return null;
  if (acct.name) return acct.name;
  if (acct.id != null) for (const l of lots.values()) if (l.location?.id === acct.id) return l.location.name;
  return null;
}

export function App() {
  const catalog = useCatalog();
  const [storedView, setStoredView] = useSetting(KEYS.view);
  const view = useMemo(() => normalizeView(storedView), [storedView]);
  const [words] = useSetting(KEYS.words);
  const [filterOn] = useSetting(KEYS.filterOn);
  const [removeFiltered] = useSetting(KEYS.removeFiltered);
  const [hiddenLots, setHiddenLots] = useSetting(KEYS.hidden);
  const [showHidden] = useSetting(KEYS.showHidden);
  const [pickupOverride] = useSetting(KEYS.pickup);
  const accountPickup = useAccountPickup(catalog.lots);
  const pickup = pickupOverride || accountPickup || 'Raleigh';

  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState(view.search);
  const gridTop = useRef<HTMLDivElement>(null);

  // Closed lots drop out on this cadence; countdowns tick on their own.
  const now30 = useNow(30_000);

  const setView = useCallback((patch: Partial<ViewState>) => {
    setStoredView({ ...normalizeView(getSetting(KEYS.view)), ...patch });
    setPage(1);
  }, []);

  // Debounce the search box into the view.
  useEffect(() => {
    if (search === view.search) return;
    const t = setTimeout(() => setView({ search }), 200);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setSearch(view.search), [view.search]);

  const exclusions = useMemo(
    () => ({ words, filterOn: !!filterOn, removeFiltered: !!removeFiltered, hidden: hiddenLots, showHidden: !!showHidden }),
    [words, filterOn, removeFiltered, hiddenLots, showHidden],
  );
  const result = useMemo(
    () => computeView(catalog.lots.values(), view, pickup, exclusions, now30),
    [catalog.rev, view, pickup, exclusions, now30],
  );
  const facets = useMemo(() => computeFacets(catalog.lots.values(), now30), [catalog.lots, catalog.meta.fetchedAt, catalog.loaded, now30]);

  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageRows = result.rows.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  // Live prices for exactly the lots on screen (plus the open one).
  const watchKey = [...pageRows.map((r) => r.lot.id), ...(openId ? [openId] : [])].join(',');
  useEffect(() => {
    if (!catalog.loaded) return;
    const ids = watchKey ? watchKey.split(',').map(Number) : [];
    const t = setTimeout(() => void watchLots(ids).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [watchKey, catalog.loaded]);

  const toggleHide = useCallback((lot: Lot) => {
    const cur = getSetting(KEYS.hidden);
    const next = { ...cur };
    if (next[lot.id]) delete next[lot.id];
    else next[lot.id] = { title: lot.title, href: lotHref(lot.auctionPeriod, lot.id), ts: Date.now() };
    setHiddenLots(next);
  }, []);
  const openLot = useCallback((lot: Lot) => setOpenId(lot.id), []);
  const openHidden = useCallback((id: number) => {
    if (getLot(id)) setOpenId(id);
    else window.open(getSetting(KEYS.hidden)[id]?.href ?? '/', '_blank', 'noopener');
  }, []);

  const goPage = (p: number) => {
    setPage(p);
    gridTop.current?.scrollIntoView({ block: 'start' });
  };

  const openLotObj = openId != null ? catalog.lots.get(openId) : undefined;
  const authed = isAuthenticated();
  const nFilters = activeFilterCount(view);

  return (
    <div class="app">
      <header class="topbar">
        <a class="brand" href="/" title="Back to Triangle Liquidators">
          TL <span>Catalog</span>
        </a>
        <input
          class="search"
          type="search"
          placeholder={`Search ${fmtCount(result.open)} lots`}
          aria-label="Search lots"
          value={search}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
        <select class="sort" aria-label="Sort" value={view.sort} onChange={(e) => setView({ sort: e.currentTarget.value as ViewState['sort'] })}>
          {Object.entries(SORTS).map(([k, label]) => (
            <option value={k}>{label}</option>
          ))}
        </select>
        <button type="button" class="btn btn-outline filters-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-expanded={sidebarOpen}>
          <Icon name="filter" /> Filters{nFilters ? ` (${nFilters})` : ''}
        </button>
      </header>

      <div class="layout">
        <aside class={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <Sidebar
            view={view}
            setView={setView}
            facets={facets}
            matchCounts={result.matchCounts}
            pickup={pickup}
            accountPickup={accountPickup}
            authed={authed}
            onOpenHidden={openHidden}
          />
        </aside>

        <main class="main">
          <StatusBar />
          {!authed && (
            <p class="notice">
              Not logged in: your bids, standings and watchlist aren’t shown. <a href="/">Log in on the site</a>, then reload.
            </p>
          )}
          <div class="results-line" ref={gridTop}>
            <span>
              {result.rows.length
                ? `${fmtCount((curPage - 1) * PAGE_SIZE + 1)}–${fmtCount((curPage - 1) * PAGE_SIZE + pageRows.length)} of ${fmtCount(result.rows.length)}`
                : catalog.loaded && !catalog.progress
                  ? 'No lots match'
                  : ''}
              {result.removed > 0 && <span class="muted"> · {fmtCount(result.removed)} hidden or removed</span>}
              {result.filteredOut > 0 && <span class="muted"> · {fmtCount(result.filteredOut)} outside filters</span>}
            </span>
          </div>

          <div class="grid">
            {pageRows.map((row) => (
              <LotCard key={row.lot.id} row={row} onOpen={openLot} onToggleHide={toggleHide} />
            ))}
          </div>

          {pages > 1 && <Pager page={curPage} pages={pages} go={goPage} />}
        </main>
      </div>

      {openLotObj && (
        <LotModal
          row={makeRow(openLotObj, pickup, exclusions)}
          onClose={() => setOpenId(null)}
          onToggleHide={() => toggleHide(openLotObj)}
        />
      )}
    </div>
  );
}

function StatusBar() {
  const catalog = useCatalog();
  const live = useLiveState();
  const now = useNow(1000);
  const { meta, progress, error, loaded } = catalog;
  const wait = nextPullAt() - now;
  const due = wait <= 0;

  let text: string;
  if (!loaded) text = 'Reading local cache…';
  else if (progress) text = progress.total ? `Refreshing catalog… ${fmtCount(progress.done)} of ${fmtCount(progress.total)}` : 'Refreshing catalog…';
  else if (meta.fetchedAt) text = `${fmtCount(catalog.lots.size)} lots · refreshed ${ago(meta.fetchedAt, now)}`;
  else text = 'No cached catalog yet';

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div class="statusbar">
      <span>{text}</span>
      <span class={`live live-${live}`} title={`Live price updates for lots on screen: ${live}`}>
        ● {live === 'connected' ? 'Live' : live === 'connecting' ? 'Connecting' : live === 'off' ? 'Live off' : 'Offline'}
      </span>
      <button
        type="button"
        class="btn-text"
        disabled={!loaded || !!progress || !due}
        onClick={() => void pullCatalog()}
        title={due ? 'Pull the full catalog now' : 'Full refreshes are rate-limited; change the interval in Settings'}
      >
        <Icon name="refresh" size={16} /> {progress ? 'Refreshing' : due ? 'Refresh' : `Refresh in ${countdown(wait)}`}
      </button>
      {progress && (
        <span class="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {error && <span class="error">{error}</span>}
    </div>
  );
}

function pagerItems(page: number, pages: number): (number | '…')[] {
  const nums = [...new Set([1, pages, page - 1, page, page + 1])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

function Pager({ page, pages, go }: { page: number; pages: number; go: (p: number) => void }) {
  return (
    <nav class="pager" aria-label="Pages">
      <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => go(page - 1)}>
        <Icon name="chevronLeft" />
      </button>
      {pagerItems(page, pages).map((n) =>
        n === '…' ? (
          <span class="gap">…</span>
        ) : (
          <button type="button" aria-current={n === page ? 'page' : undefined} onClick={() => go(n)}>
            {n}
          </button>
        ),
      )}
      <button type="button" aria-label="Next page" disabled={page === pages} onClick={() => go(page + 1)}>
        <Icon name="chevronRight" />
      </button>
    </nav>
  );
}
