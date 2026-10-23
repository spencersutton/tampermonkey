import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { KEYS, lotHref, siteUrl } from '../shared/keys';
import { fetchPickupLocation } from './api';
import { LoginLink, useAuthed } from './auth';
import { nextPullAt, pullCatalog } from './source';
import { getLot, useCatalog } from './catalog';
import { getSetting, setSetting, useSetting } from './settings';
import { navFromUrl, useHistory } from './history';
import { Icon } from './icons';
import { watchLots, useLiveState, type LiveState } from './live';
import { BidConfirm } from './BidConfirm';
import { CategoryEditor } from './CategoryEditor';
import type { BidRequest } from './bid';
import { LotCard } from './LotCard';
import { LotModal } from './LotModal';
import { Sidebar } from './Sidebar';
import { Toasts } from './toast';
import { ago, countdown, DAY, fmtCount, shortTime, useNow } from './util';
import {
  activeFilterCount,
  computeFacets,
  computeView,
  makeRow,
  normalizeView,
  sameFilters,
  savedFilters,
  savedSearchStats,
  searchRegexOf,
  SORTS,
  suggestName,
  type SavedSearch,
  type ViewState,
} from './view';
import type { Lot } from './types';

/** Lots added to the grid each time the end of it scrolls into view. */
const PAGE_SIZE = 60;

/**
 * Ids of the lot cards in `grid` that are on screen or close to it, for live
 * updates. `key` changes whenever the rendered cards do.
 */
function useOnScreenLots(grid: { current: HTMLElement | null }, key: string): number[] {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    const el = grid.current;
    if (!el) {
      return;
    }
    const near = new Set<number>();
    let t: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = Number((e.target as HTMLElement).dataset.lot);
          e.isIntersecting ? near.add(id) : near.delete(id);
        }
        clearTimeout(t);
        t = setTimeout(() => setIds([...near].sort((a, b) => a - b)), 150);
      },
      { rootMargin: '600px 0px' },
    );
    el.querySelectorAll('[data-lot]').forEach((c) => io.observe(c));
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, [key]);
  return ids;
}

/** Name of the account's pickup location, fetched at most once a day while logged in. */
function useAccountPickup(lots: Map<number, Lot>, authed: boolean): string | null {
  const [acct] = useSetting(KEYS.accountPickup);
  useEffect(() => {
    if (authed && !(acct && Date.now() - acct.at < DAY)) {
      fetchPickupLocation().then(
        (p) => setSetting(KEYS.accountPickup, { id: p?.id ?? null, name: p?.name ?? null, at: Date.now() }),
        () => {},
      );
    }
  }, [authed]);
  if (acct?.name || acct?.id == null) {
    return acct?.name ?? null;
  }
  // The account may only give the location's id; find its name among the lots.
  return lots.values().find((l) => l.location?.id === acct.id)?.location?.name ?? null;
}

/** The whole /tlx page: sidebar, toolbar, infinitely scrolling lot grid, and the lot / bid popups. */
export function App() {
  // A URL with parameters (/tlx?search=foo&sort=...) overrides the saved view, pages shown and open lot.
  const [fromUrl] = useState(() => {
    const nav = navFromUrl();
    if (nav) {
      setSetting(KEYS.view, nav.view);
    }
    return nav;
  });
  const catalog = useCatalog();
  const [storedView, setStoredView] = useSetting(KEYS.view);
  const view = useMemo(() => normalizeView(storedView), [storedView]);
  const [words] = useSetting(KEYS.words);
  const [filterOn] = useSetting(KEYS.filterOn);
  const [removeFiltered] = useSetting(KEYS.removeFiltered);
  const [hiddenLots, setHiddenLots] = useSetting(KEYS.hidden);
  const [showHidden] = useSetting(KEYS.showHidden);
  const [pickupOverride] = useSetting(KEYS.pickup);
  const [customCategories] = useSetting(KEYS.customCategories);
  const [sortTypes] = useSetting(KEYS.sortTypes);
  const [titleLines] = useSetting(KEYS.titleLines);
  const authed = useAuthed();
  const accountPickup = useAccountPickup(catalog.lots, authed);
  const pickup = pickupOverride || accountPickup || 'Raleigh';

  // How many PAGE_SIZE batches of lots the grid shows; grows as the end of it scrolls into view.
  const [page, setPage] = useState(fromUrl?.page ?? 1);
  const [openId, setOpenId] = useState<number | null>(fromUrl?.openId ?? null);
  const [bidReq, setBidReq] = useState<BidRequest | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [search, setSearch] = useState(view.search);
  const gridTop = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gridEnd = useRef<HTMLDivElement>(null);

  // Closed lots drop out on this cadence; countdowns tick on their own.
  const now30 = useNow(30_000);

  const [saved] = useSetting(KEYS.savedSearches);
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
    if (search === view.search) {
      return;
    }
    const t = setTimeout(() => {
      pushed.current = search;
      setView({ search });
    }, 200);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (view.search !== pushed.current) {
      pushed.current = view.search;
      setSearch(view.search);
    }
  }, [view.search]);

  const exclusions = useMemo(
    () => ({ words, filterOn, removeFiltered, hidden: hiddenLots, showHidden, customCategories, sortTypes }),
    [words, filterOn, removeFiltered, hiddenLots, showHidden, customCategories, sortTypes],
  );
  const result = useMemo(
    () => computeView(catalog.lots.values(), view, pickup, exclusions, now30),
    [catalog.rev, view, pickup, exclusions, now30],
  );
  const facets = useMemo(
    () => computeFacets(catalog.lots.values(), now30, customCategories),
    [catalog.lots, catalog.meta.fetchedAt, catalog.loaded, now30, customCategories],
  );

  const savedStats = useMemo(
    () => savedSearchStats(catalog.lots.values(), saved, pickup, exclusions, now30),
    [catalog.rev, saved, pickup, exclusions, now30],
  );
  const totalNew = savedStats.values().reduce((n, s) => n + s.fresh, 0);
  const activeSaved = saved.find((s) => sameFilters(view, s.view)) ?? null;
  const newSince = view.newSince ?? (highlight && activeSaved?.id === highlight.id ? highlight.since : null);
  const isNew = (lot: Lot) => newSince != null && (lot.firstSeenAt ?? 0) > newSince;

  useEffect(() => {
    document.title = totalNew ? `(${totalNew}) TL Catalog` : 'TL Catalog';
  }, [totalNew]);

  const updateSaved = (fn: (list: SavedSearch[]) => SavedSearch[]) =>
    setSetting(KEYS.savedSearches, fn(getSetting(KEYS.savedSearches)));
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
  const shownRows = result.rows.slice(0, curPage * PAGE_SIZE);

  // Show the next batch once the end of the grid comes near. A new observer per
  // batch reports straight away, so a short batch that leaves the end on screen loads another.
  useEffect(() => {
    const el = gridEnd.current;
    if (!el || curPage >= pages) {
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setPage(curPage + 1), {
      rootMargin: '0px 0px 1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [curPage, pages]);

  // Live prices for exactly the lots on screen (plus the open one).
  const onScreen = useOnScreenLots(grid, shownRows.map((r) => r.lot.id).join(','));
  const watchIds = [...onScreen, ...(openId && !onScreen.includes(openId) ? [openId] : [])];
  const watchKey = watchIds.join(',');
  useEffect(() => {
    if (catalog.loaded) {
      const t = setTimeout(() => void watchLots(watchIds).catch(() => {}), 300);
      return () => clearTimeout(t);
    }
  }, [watchKey, catalog.loaded]);

  const toggleHide = useCallback((lot: Lot) => {
    const { [lot.id]: wasHidden, ...rest } = getSetting(KEYS.hidden);
    setHiddenLots(wasHidden ? rest : { ...rest, [lot.id]: { title: lot.title, href: lotHref(lot.auctionPeriod, lot.id), ts: Date.now() } });
  }, []);
  const openLot = useCallback((lot: Lot) => setOpenId(lot.id), []);
  const openHidden = useCallback((id: number) => {
    if (getLot(id)) {
      setOpenId(id);
    } else {
      window.open(siteUrl(getSetting(KEYS.hidden)[id]?.href ?? '/'), '_blank', 'noopener');
    }
  }, []);

  const closeLot = useHistory(
    { view, page, openId },
    (nav) => {
      setStoredView(normalizeView(nav.view));
      setPage(nav.page);
      setOpenId(nav.openId);
    },
    () => setOpenId(null),
  );

  const openLotObj = openId != null ? catalog.lots.get(openId) : undefined;
  const bidLot = bidReq ? catalog.lots.get(bidReq.lotId) : undefined;
  const nFilters = activeFilterCount(view);
  const badRegex = view.searchRegex && !!search.trim() && !searchRegexOf({ ...view, search });
  // On a saved search's own filters, how many of the matches are new since its last visit.
  const freshMatches = view.newSince == null && activeSaved && newSince != null ? result.rows.filter((r) => isNew(r.lot)).length : 0;

  return (
    <div class="app">
      <header class="topbar">
        <a class="brand" href="/" title="Back to Triangle Liquidators">
          TL <span>Catalog</span>
        </a>
        <div class="search-box">
          <input
            class={`search ${badRegex ? 'has-error' : ''}`}
            type="search"
            placeholder={view.searchRegex ? `Regex search ${fmtCount(result.open)} lots` : `Search ${fmtCount(result.open)} lots`}
            aria-label="Search lots"
            aria-invalid={badRegex}
            title={badRegex ? 'Invalid regex' : undefined}
            spellcheck={!view.searchRegex}
            value={search}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <button
            type="button"
            class={`regex-toggle ${view.searchRegex ? 'on' : ''}`}
            aria-pressed={view.searchRegex}
            title={view.searchRegex ? 'Regex search on (case-insensitive)' : 'Use regex search'}
            onClick={() => setView({ searchRegex: !view.searchRegex })}
          >
            .*
          </button>
        </div>
        <select class="sort" aria-label="Sort" value={view.sort} onChange={(e) => setView({ sort: e.currentTarget.value as ViewState['sort'] })}>
          {Object.entries(SORTS).map(([k, { label }]) => (
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
            onEditCategories={() => setEditingCategories(true)}
            typeCounts={result.typeCounts}
            saved={savedProps}
          />
        </aside>

        <main class="main">
          <StatusBar />
          {!authed && (
            <p class="notice">
              Not logged in: your bids, standings and watchlist aren’t shown. <LoginLink>Log in</LoginLink> to see them and bid.
            </p>
          )}
          <div class="results-line" ref={gridTop}>
            <span>
              {result.rows.length
                ? `${fmtCount(result.rows.length)} ${result.rows.length === 1 ? 'lot' : 'lots'}`
                : catalog.loaded && !catalog.progress
                  ? 'No lots match'
                  : ''}
              {result.removed > 0 && <span class="muted"> · {fmtCount(result.removed)} hidden or removed</span>}
              {result.filteredOut > 0 && <span class="muted"> · {fmtCount(result.filteredOut)} outside filters</span>}
              {result.combined > 0 && <span class="muted"> · {fmtCount(result.combined)} duplicates combined</span>}
            </span>
            {view.newSince != null && (
              <span class="new-line">
                Only lots listed since {shortTime(view.newSince)}
                <button type="button" class="btn-text" onClick={() => setView({ newSince: null })}>
                  Show all
                </button>
              </span>
            )}
            {freshMatches > 0 && (
              <span class="new-line">
                {fmtCount(freshMatches)} new since your last look at “{activeSaved!.name}”
                <button type="button" class="btn-text" onClick={() => setView({ newSince })}>
                  Show only new
                </button>
              </span>
            )}
          </div>

          <div class={`grid ${titleLines ? '' : 'full-titles'}`} ref={grid} style={titleLines ? { '--title-lines': titleLines } : undefined}>
            {shownRows.map((row) => (
              <LotCard
                key={row.lot.id}
                row={row}
                isNew={isNew(row.lot)}
                onOpen={openLot}
                onToggleHide={toggleHide}
                onBid={setBidReq}
              />
            ))}
          </div>

          <div ref={gridEnd} />
          {curPage < pages && <p class="grid-more muted">Loading more lots…</p>}
        </main>
      </div>

      {openLotObj && (
        <LotModal
          row={makeRow(openLotObj, pickup, exclusions)}
          onClose={closeLot}
          onToggleHide={() => toggleHide(openLotObj)}
          onBid={setBidReq}
          group={result.groups.get(openLotObj.id)}
          onOpenLot={openLot}
        />
      )}
      {bidReq && bidLot && (
        <BidConfirm key={`${bidReq.lotId}:${bidReq.type}:${bidReq.amount}`} req={bidReq} row={makeRow(bidLot, pickup, exclusions)} pickup={pickup} onClose={() => setBidReq(null)} />
      )}
      {editingCategories && <CategoryEditor lots={catalog.lots.values().filter((l) => l.endsAt > now30).toArray()} onClose={() => setEditingCategories(false)} />}
      <Toasts />
    </div>
  );
}

const LIVE_LABELS: Record<LiveState, string> = { connected: 'Live', connecting: 'Connecting', off: 'Live off', disconnected: 'Offline' };

/** Catalog freshness, pull progress, live connection state and the manual refresh button. */
function StatusBar() {
  const catalog = useCatalog();
  const live = useLiveState();
  const now = useNow(1000);
  const { meta, progress, error, loaded } = catalog;
  const wait = nextPullAt() - now;
  const due = wait <= 0;

  let text = 'No cached catalog yet';
  if (!loaded) {
    text = 'Loading catalog…';
  } else if (progress) {
    text = progress.total ? `Refreshing catalog… ${fmtCount(progress.done)} of ${fmtCount(progress.total)}` : 'Refreshing catalog…';
  } else if (meta.fetchedAt) {
    text = `${fmtCount(catalog.lots.size)} lots · refreshed ${ago(meta.fetchedAt, now)}`;
  }

  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div class="statusbar">
      <span>{text}</span>
      <span class={`live live-${live}`} title={`Live price updates for lots on screen: ${live}`}>
        ● {LIVE_LABELS[live]}
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
