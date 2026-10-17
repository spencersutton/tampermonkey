import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { KEYS, lotHref } from '../shared/keys';
import { fetchPickupLocation } from './api';
import { useAuthed } from './auth';
import { getLot, nextPullAt, pullCatalog, useCatalog } from './catalog';
import { getSetting, setSetting, useSetting } from './gm';
import { Icon } from './icons';
import { watchLots, useLiveState } from './live';
import { BidConfirm } from './BidConfirm';
import type { BidRequest } from './bid';
import { LotCard } from './LotCard';
import { LotModal } from './LotModal';
import { Sidebar } from './Sidebar';
import { Toasts } from './toast';
import { ago, countdown, fmtCount, useNow } from './util';
import {
  activeFilterCount,
  computeFacets,
  computeView,
  makeRow,
  normalizeView,
  sameFilters,
  savedFilters,
  savedSearchStats,
  SORTS,
  suggestName,
  type SavedSearch,
  type ViewState,
} from './view';
import type { Lot } from './types';

const PAGE_SIZE = 60;
const DAY = 86400_000;

function useAccountPickup(lots: Map<number, Lot>, authed: boolean): string | null {
  const [acct] = useSetting(KEYS.accountPickup);
  useEffect(() => {
    if (!authed || (acct && Date.now() - acct.at < DAY)) return;
    fetchPickupLocation().then(
      (p) => setSetting(KEYS.accountPickup, { id: p?.id ?? null, name: p?.name ?? null, at: Date.now() }),
      () => {},
    );
  }, [authed]);
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
  const authed = useAuthed();
  const accountPickup = useAccountPickup(catalog.lots, authed);
  const pickup = pickupOverride || accountPickup || 'Raleigh';

  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);
  const [bidReq, setBidReq] = useState<BidRequest | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState(view.search);
  const gridTop = useRef<HTMLDivElement>(null);

  // Closed lots drop out on this cadence; countdowns tick on their own.
  const now30 = useNow(30_000);

  const [savedRaw, setSavedRaw] = useSetting(KEYS.savedSearches);
  const saved = savedRaw as SavedSearch[];
  // While a saved search is open, lots that are new since its previous visit get a badge.
  const [highlight, setHighlight] = useState<{ id: string; since: number } | null>(null);

  const setView = useCallback((patch: Partial<ViewState>) => {
    setStoredView({ ...normalizeView(getSetting(KEYS.view)), ...patch });
    setPage(1);
  }, []);

  // Debounce the search box into the view. `pushed` remembers what the box
  // itself sent, so only outside changes (saved search, Clear, another tab)
  // are copied back into the box – otherwise a debounced value arriving
  // mid-typing would overwrite what was typed since.
  const pushed = useRef(view.search);
  useEffect(() => {
    if (search === view.search) return;
    const t = setTimeout(() => {
      pushed.current = search;
      setView({ search });
    }, 200);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (view.search === pushed.current) return;
    pushed.current = view.search;
    setSearch(view.search);
  }, [view.search]);

  const exclusions = useMemo(
    () => ({ words, filterOn: !!filterOn, removeFiltered: !!removeFiltered, hidden: hiddenLots, showHidden: !!showHidden }),
    [words, filterOn, removeFiltered, hiddenLots, showHidden],
  );
  const result = useMemo(
    () => computeView(catalog.lots.values(), view, pickup, exclusions, now30),
    [catalog.rev, view, pickup, exclusions, now30],
  );
  const facets = useMemo(() => computeFacets(catalog.lots.values(), now30), [catalog.lots, catalog.meta.fetchedAt, catalog.loaded, now30]);

  const savedStats = useMemo(
    () => savedSearchStats(catalog.lots.values(), saved, pickup, exclusions, now30),
    [catalog.rev, saved, pickup, exclusions, now30],
  );
  const totalNew = [...savedStats.values()].reduce((n, s) => n + s.fresh, 0);
  const activeSaved = saved.find((s) => sameFilters(view, s.view)) ?? null;
  const newSince = view.newSince ?? (highlight && activeSaved?.id === highlight.id ? highlight.since : null);

  useEffect(() => {
    document.title = totalNew ? `(${totalNew}) TL Catalog` : 'TL Catalog';
  }, [totalNew]);

  const updateSaved = (fn: (list: SavedSearch[]) => SavedSearch[]) =>
    setSetting(KEYS.savedSearches, fn(getSetting(KEYS.savedSearches) as SavedSearch[]));
  const savedProps = {
    searches: saved,
    stats: savedStats,
    activeId: activeSaved?.id ?? null,
    canSave: activeFilterCount({ ...view, newSince: null }) > 0 && !activeSaved,
    suggestedName: suggestName(view, facets),
    onSave: (name: string) => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      updateSaved((l) => (l.some((x) => sameFilters(view, x.view)) ? l : [...l, { id, name, view: savedFilters(view), lastViewedAt: Date.now() }]));
    },
    onOpen: (s: SavedSearch, newOnly: boolean) => {
      setStoredView({ ...normalizeView(s.view), newSince: newOnly ? s.lastViewedAt : null });
      setSearch(s.view.search);
      setPage(1);
      setHighlight({ id: s.id, since: s.lastViewedAt });
      updateSaved((l) => l.map((x) => (x.id === s.id ? { ...x, lastViewedAt: Date.now() } : x)));
      setSidebarOpen(false);
      gridTop.current?.scrollIntoView({ block: 'start' });
    },
    onDelete: (id: string) => updateSaved((l) => l.filter((x) => x.id !== id)),
    onRename: (id: string, name: string) => updateSaved((l) => l.map((x) => (x.id === id ? { ...x, name } : x))),
  };

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
  const askBid = useCallback((req: BidRequest) => setBidReq(req), []);
  const openHidden = useCallback((id: number) => {
    if (getLot(id)) setOpenId(id);
    else window.open(getSetting(KEYS.hidden)[id]?.href ?? '/', '_blank', 'noopener');
  }, []);

  const goPage = (p: number) => {
    setPage(p);
    gridTop.current?.scrollIntoView({ block: 'start' });
  };

  const openLotObj = openId != null ? catalog.lots.get(openId) : undefined;
  const bidLot = bidReq ? catalog.lots.get(bidReq.lotId) : undefined;
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
          {totalNew > 0 && <span class="pill pill-new">{fmtCount(totalNew)} new</span>}
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
            saved={savedProps}
          />
        </aside>

        <main class="main">
          <StatusBar />
          {!authed && (
            <p class="notice">
              Not logged in: your bids, standings and watchlist aren’t shown. <a href="/" target="_blank" rel="noopener">Log in on the site</a> and this page picks it up.
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
              {result.combined > 0 && <span class="muted"> · {fmtCount(result.combined)} duplicates combined</span>}
            </span>
            {view.newSince != null ? (
              <span class="new-line">
                Only lots listed since {new Date(view.newSince).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                <button type="button" class="btn-text" onClick={() => setView({ newSince: null })}>
                  Show all
                </button>
              </span>
            ) : (
              activeSaved &&
              newSince != null &&
              (() => {
                const n = result.rows.filter((r) => (r.lot.firstSeenAt ?? 0) > newSince).length;
                return n > 0 ? (
                  <span class="new-line">
                    {fmtCount(n)} new since your last look at “{activeSaved.name}”
                    <button type="button" class="btn-text" onClick={() => setView({ newSince })}>
                      Show only new
                    </button>
                  </span>
                ) : null;
              })()
            )}
          </div>

          <div class="grid">
            {pageRows.map((row) => (
              <LotCard
                key={row.lot.id}
                row={row}
                isNew={newSince != null && (row.lot.firstSeenAt ?? 0) > newSince}
                onOpen={openLot}
                onToggleHide={toggleHide}
                onBid={askBid}
              />
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
          onBid={askBid}
          group={result.groups.get(openLotObj.id)}
          onOpenLot={openLot}
        />
      )}
      {bidReq && bidLot && (
        <BidConfirm key={`${bidReq.lotId}:${bidReq.type}:${bidReq.amount}`} req={bidReq} row={makeRow(bidLot, pickup, exclusions)} pickup={pickup} onClose={() => setBidReq(null)} />
      )}
      <Toasts />
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
