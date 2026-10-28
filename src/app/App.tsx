import { computed } from '@preact/signals';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { KEYS, lotHref, siteUrl } from '../shared/keys';
import { nameMatchPct } from '../shared/names';
import { fetchPickupLocation, type ClosedSection } from './api';
import { isAuthenticated, LoginLink } from './auth';
import { nextPullAt, pullCatalog, settingsSynced } from './source';
import { error, getLot, loaded, lots, meta, progress, rev } from './catalog';
import { getSetting, setSetting, useSetting } from './settings';
import { useHistory, type NavState } from './history';
import { Icon } from './icons';
import { liveState, watchLots, type LiveState } from './live';
import { BidConfirm } from './BidConfirm';
import { CategoryEditor } from './CategoryEditor';
import { ClosedLots } from './ClosedLots';
import type { BidRequest } from './bid';
import { LotCard } from './LotCard';
import { LotModal } from './LotModal';
import { Sidebar } from './Sidebar';
import { Toasts } from './toast';
import { TypeCategory } from './TypeCategory';
import { ago, clock, countdown, DAY, fmtCount, MINUTE, shortTime } from './util';
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

/** Name of the account's pickup location (fetched by App at most once a day while logged in). */
const accountPickupName = computed(() => {
  const acct = getSetting(KEYS.accountPickup);
  if (acct?.name || acct?.id == null) {
    return acct?.name ?? null;
  }
  // The account may only give the location's id; find its name among the lots.
  return lots.value.values().find((l) => l.location?.id === acct.id)?.location?.name ?? null;
});
const pickupName = computed(() => getSetting(KEYS.pickup) || accountPickupName.value || 'Raleigh');

const storedView = computed(() => normalizeView(getSetting(KEYS.view)));
const exclusionRules = computed(() => ({
  words: getSetting(KEYS.words),
  filterOn: getSetting(KEYS.filterOn),
  removeFiltered: getSetting(KEYS.removeFiltered),
  hidden: getSetting(KEYS.hidden),
  showHidden: getSetting(KEYS.showHidden),
  customCategories: getSetting(KEYS.customCategories),
  nameMatch: nameMatchPct(getSetting(KEYS.nameMatch)),
}));

// Closed lots drop out on a 30 s clock; countdowns tick on their own.
/** The grid: lots through the view's filters and sort, recomputed on every lot update. */
const gridView = computed(() => {
  void rev.value;
  return computeView(lots.value.values(), storedView.value, pickupName.value, exclusionRules.value, clock(30_000));
});
/** Filter options and their counts; these don't follow live price updates. */
const filterFacets = computed(() => computeFacets(lots.value.values(), clock(30_000), getSetting(KEYS.customCategories)));
const searchStats = computed(() => {
  void rev.value;
  return savedSearchStats(lots.value.values(), getSetting(KEYS.savedSearches), pickupName.value, exclusionRules.value, clock(30_000));
});

/** Fetch the account's pickup location at most once a day while logged in. */
function useAccountPickupFetch(authed: boolean) {
  useEffect(() => {
    const acct = getSetting(KEYS.accountPickup);
    if (authed && !(acct && Date.now() - acct.at < DAY)) {
      fetchPickupLocation().then(
        (p) => setSetting(KEYS.accountPickup, { id: p?.id ?? null, name: p?.name ?? null, at: Date.now() }),
        () => {},
      );
    }
  }, [authed]);
}

/** Coming back to the tab after it was hidden this long counts as a new visit. */
const VISIT_GAP = 30 * MINUTE;
/** Before any visit was recorded, lots with more than this left are taken to be new. */
const FIRST_VISIT_NEW_LEFT = 2 * DAY;

/**
 * Lots first seen after this count as new: the start of the previous visit
 * (a page load, or the tab coming back after VISIT_GAP hidden), shared by all
 * devices. null until the synced settings have arrived.
 */
function useVisitSince(): number | null {
  const [since, setSince] = useState<number | null>(null);
  useEffect(() => {
    const visit = () => {
      const now = Date.now();
      setSince(getSetting(KEYS.lastVisit) ?? firstVisitSince(now));
      setSetting(KEYS.lastVisit, now);
    };
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= VISIT_GAP) {
        visit();
      }
    };
    void settingsSynced.then(() => {
      visit();
      document.addEventListener('visibilitychange', onVisibility);
    });
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  return since;
}

/** With no previous visit, start just before the earliest-seen lot that still has over FIRST_VISIT_NEW_LEFT to go. */
function firstVisitSince(now: number): number {
  const first = lots.value
    .values()
    .filter((l) => l.endsAt - now > FIRST_VISIT_NEW_LEFT)
    .reduce((min, l) => Math.min(min, l.firstSeenAt ?? 0), Infinity);
  return first === Infinity ? now : Math.max(0, first - 1);
}

/** The whole /tlx page: sidebar, toolbar, infinitely scrolling lot grid, and the lot / bid popups. */
export function App({ fromUrl }: { fromUrl: NavState | null }) {
  const authed = isAuthenticated();
  useAccountPickupFetch(authed);
  const [titleLines] = useSetting(KEYS.titleLines);
  const [saved] = useSetting(KEYS.savedSearches);
  const view = storedView.value;
  const pickup = pickupName.value;
  const exclusions = exclusionRules.value;
  const result = gridView.value;
  const facets = filterFacets.value;
  const savedStats = searchStats.value;
  const accountPickup = accountPickupName.value;

  // How many PAGE_SIZE batches of lots the grid shows; grows as the end of it scrolls into view.
  const [page, setPage] = useState(fromUrl?.page ?? 1);
  const [openId, setOpenId] = useState<number | null>(fromUrl?.openId ?? null);
  const [closed, setClosed] = useState<ClosedSection | null>(fromUrl?.closed ?? null); // the Won / Lost page, in place of the grid
  const [bidReq, setBidReq] = useState<BidRequest | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingCategories, setEditingCategories] = useState(false);
  const [typeLot, setTypeLot] = useState<Lot | null>(null); // lot whose item type is being made a category
  const [search, setSearch] = useState(view.search);
  const gridTop = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gridEnd = useRef<HTMLDivElement>(null);

  const now30 = clock(30_000);

  // Lots that are new since the previous visit get a badge; while a saved
  // search is open, since that search's previous visit instead.
  const visitSince = useVisitSince();
  const [highlight, setHighlight] = useState<{ id: string; since: number } | null>(null);

  const setView = useCallback((patch: Partial<ViewState>) => {
    setSetting(KEYS.view, { ...normalizeView(getSetting(KEYS.view)), ...patch });
    setPage(1);
    setClosed(null); // changing the filters goes back to the grid
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

  const totalNew = savedStats.values().reduce((n, s) => n + s.fresh, 0);
  const activeSaved = saved.find((s) => sameFilters(view, s.view)) ?? null;
  const sinceSaved = !!highlight && activeSaved?.id === highlight.id;
  const newSince = view.newSince ?? (sinceSaved ? highlight!.since : visitSince);
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
      setSetting(KEYS.view, { ...normalizeView(s.view), newSince: newOnly ? s.lastViewedAt : null });
      setSearch(s.view.search);
      setPage(1);
      setClosed(null);
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
    if (loaded.value) {
      const t = setTimeout(() => void watchLots(watchIds).catch(() => {}), 300);
      return () => clearTimeout(t);
    }
  }, [watchKey, loaded.value]);

  const toggleHide = useCallback((lot: Lot) => {
    const { [lot.id]: wasHidden, ...rest } = getSetting(KEYS.hidden);
    setSetting(KEYS.hidden, wasHidden ? rest : { ...rest, [lot.id]: { title: lot.title, href: lotHref(lot.auctionPeriod, lot.id), ts: Date.now() } });
  }, []);
  const openLot = useCallback((lot: Lot) => setOpenId(lot.id), []);
  const openHidden = useCallback((id: number) => {
    if (getLot(id)) {
      setOpenId(id);
    } else {
      window.open(siteUrl(getSetting(KEYS.hidden)[id]?.href ?? '/'), '_blank', 'noopener');
    }
  }, []);

  const openClosed = useCallback((section: ClosedSection | null) => {
    setClosed(section);
    setSidebarOpen(false);
    window.scrollTo(0, 0);
  }, []);
  const rowOf = useCallback((lot: Lot) => makeRow(lot, pickup, exclusions), [pickup, exclusions]);

  const closeLot = useHistory(
    { view, page, openId, closed },
    (nav) => {
      setSetting(KEYS.view, normalizeView(nav.view));
      setPage(nav.page);
      setOpenId(nav.openId);
      setClosed(nav.closed);
    },
    () => setOpenId(null),
  );

  const openLotObj = openId != null ? getLot(openId) : undefined;
  const bidLot = bidReq ? getLot(bidReq.lotId) : undefined;
  const nFilters = activeFilterCount(view);
  const badRegex = view.searchRegex && !!search.trim() && !searchRegexOf({ ...view, search });
  // How many of the matches are new since the last visit (to the open saved search, if any).
  const freshMatches = view.newSince == null && newSince != null ? result.rows.filter((r) => isNew(r.lot)).length : 0;

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
            onOpenClosed={openClosed}
            closed={closed}
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
          {closed && <ClosedLots section={closed} onSection={openClosed} onBack={() => openClosed(null)} onOpenLot={openLot} onToggleHide={toggleHide} rowOf={rowOf} />}
          {/* Kept mounted under the Won / Lost page so its scroll observers keep working. */}
          <div hidden={!!closed}>
            <div class="results-line" ref={gridTop}>
              <span>
                {result.rows.length
                  ? `${fmtCount(result.rows.length)} ${result.rows.length === 1 ? 'lot' : 'lots'}`
                  : loaded.value && !progress.value
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
                  {fmtCount(freshMatches)} new since your last {sinceSaved ? `look at “${activeSaved!.name}”` : 'visit'}
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
                  onAddType={setTypeLot}
                />
              ))}
            </div>

            <div ref={gridEnd} />
            {curPage < pages && <p class="grid-more muted">Loading more lots…</p>}
          </div>
        </main>
      </div>

      {openLotObj && (
        <LotModal
          row={rowOf(openLotObj)}
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
      {editingCategories && <CategoryEditor lots={lots.value.values().filter((l) => l.endsAt > now30).toArray()} onClose={() => setEditingCategories(false)} />}
      {typeLot && (
        <TypeCategory
          lot={typeLot}
          lots={lots.value.values().filter((l) => l.endsAt > now30).toArray()}
          onClose={() => setTypeLot(null)}
        />
      )}
      <Toasts />
    </div>
  );
}

const LIVE_LABELS: Record<LiveState, string> = { connected: 'Live', connecting: 'Connecting', off: 'Live off', disconnected: 'Offline' };

/** Catalog freshness, pull progress, live connection state and the manual refresh button. */
function StatusBar() {
  const live = liveState.value;
  const now = clock(1000);
  const pull = progress.value;
  const { fetchedAt } = meta.value;
  const wait = nextPullAt() - now;
  const due = wait <= 0;

  let text = 'No cached catalog yet';
  if (!loaded.value) {
    text = 'Loading catalog…';
  } else if (pull) {
    text = pull.total ? `Refreshing catalog… ${fmtCount(pull.done)} of ${fmtCount(pull.total)}` : 'Refreshing catalog…';
  } else if (fetchedAt) {
    text = `${fmtCount(lots.value.size)} lots · refreshed ${ago(fetchedAt, now)}`;
  }

  const pct = pull?.total ? Math.round((pull.done / pull.total) * 100) : 0;
  return (
    <div class="statusbar">
      <span>{text}</span>
      <span class={`live live-${live}`} title={`Live price updates for lots on screen: ${live}`}>
        ● {LIVE_LABELS[live]}
      </span>
      <button
        type="button"
        class="btn-text"
        disabled={!loaded.value || !!pull || !due}
        onClick={() => void pullCatalog()}
        title={due ? 'Pull the full catalog now' : 'Full refreshes are rate-limited; change the interval in Settings'}
      >
        <Icon name="refresh" size={16} /> {pull ? 'Refreshing' : due ? 'Refresh' : `Refresh in ${countdown(wait)}`}
      </button>
      {pull && (
        <span class="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {error.value && <span class="error">{error.value}</span>}
    </div>
  );
}
