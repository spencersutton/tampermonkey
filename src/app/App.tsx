import { batch } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { KEYS } from '../shared/keys';
import { isAuthenticated, LoginLink } from './auth';
import { nextPullAt, pullCatalog } from './source';
import { error, getLot, loaded, lots, meta, progress } from './catalog';
import { getSetting, setSetting, useSetting } from './settings';
import { closeLot } from './history';
import { Icon } from './icons';
import { liveState, type LiveState } from './live';
import { BidConfirm } from './BidConfirm';
import { CategoryEditor } from './CategoryEditor';
import { ClosedLots } from './ClosedLots';
import { LotCard } from './LotCard';
import { LotModal } from './LotModal';
import { Sidebar } from './Sidebar';
import { Toasts } from './toast';
import { TypeCategory } from './TypeCategory';
import { ItemTypeEditor } from './ItemType';
import { ago, clock, countdown, fmtCount, plural, shortTime } from './util';
import {
  accountPickupName,
  closed,
  closeModal,
  filterFacets,
  gridView,
  highlight,
  modal,
  onScreen,
  openId,
  page,
  pickupName,
  rowOf,
  searchStats,
  setView,
  sidebarOpen,
  storedView,
  totalNew,
  visitSince,
} from './state';
import {
  activeFilterCount,
  normalizeView,
  sameFilters,
  savedFilters,
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
 * Keep `onScreen` to the lot cards in `grid` that are on screen or close to
 * it. `key` changes whenever the rendered cards do.
 */
function useOnScreenLots(grid: { current: HTMLElement | null }, key: string) {
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
        t = setTimeout(() => (onScreen.value = [...near].sort((a, b) => a - b)), 150);
      },
      { rootMargin: '600px 0px' },
    );
    el.querySelectorAll('[data-lot]').forEach((c) => io.observe(c));
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, [key]);
}

/** The whole /tlx page: sidebar, toolbar, infinitely scrolling lot grid, and the lot / bid popups. */
export function App() {
  const authed = isAuthenticated();
  const [titleLines] = useSetting(KEYS.titleLines);
  const [saved] = useSetting(KEYS.savedSearches);
  const view = storedView.value;
  const pickup = pickupName.value;
  const result = gridView.value;
  const facets = filterFacets.value;
  const savedStats = searchStats.value;
  const accountPickup = accountPickupName.value;
  const curOpenId = openId.value;
  const curClosed = closed.value;
  const curModal = modal.value;
  const [search, setSearch] = useState(view.search);
  const gridTop = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const gridEnd = useRef<HTMLDivElement>(null);

  const now30 = clock(30_000);

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

  const activeSaved = saved.find((s) => sameFilters(view, s.view)) ?? null;
  // Lots that are new since the previous visit get a badge; while a saved
  // search is open, since that search's previous visit instead.
  const hl = highlight.value;
  const sinceSaved = !!hl && activeSaved?.id === hl.id;
  const newSince = view.newSince ?? (sinceSaved ? hl.since : visitSince.value);
  const isNew = (lot: Lot) => newSince != null && (lot.firstSeenAt ?? 0) > newSince;

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
      batch(() => {
        setSetting(KEYS.view, { ...normalizeView(s.view), newSince: newOnly ? s.lastViewedAt : null });
        page.value = 1;
        closed.value = null;
        highlight.value = { id: s.id, since: s.lastViewedAt };
        updateSaved((l) => l.map((x) => (x.id === s.id ? { ...x, lastViewedAt: Date.now() } : x)));
        sidebarOpen.value = false;
      });
      setSearch(s.view.search);
      gridTop.current?.scrollIntoView({ block: 'start' });
    },
    onDelete: (id: string) => updateSaved((l) => l.filter((x) => x.id !== id)),
    onRename: (id: string, name: string) => updateSaved((l) => l.map((x) => (x.id === id ? { ...x, name } : x))),
  };

  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  const curPage = Math.min(page.value, pages);
  const shownRows = result.rows.slice(0, curPage * PAGE_SIZE);

  // Show the next batch once the end of the grid comes near. A new observer per
  // batch reports straight away, so a short batch that leaves the end on screen loads another.
  useEffect(() => {
    const el = gridEnd.current;
    if (!el || curPage >= pages) {
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && (page.value = curPage + 1), {
      rootMargin: '0px 0px 1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [curPage, pages]);

  useOnScreenLots(grid, shownRows.map((r) => r.lot.id).join(','));

  const openLotObj = curOpenId != null ? getLot(curOpenId) : undefined;
  const bidLot = curModal?.kind === 'bid' ? getLot(curModal.req.lotId) : undefined;
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
        <button type="button" class="btn btn-outline filters-toggle" onClick={() => (sidebarOpen.value = !sidebarOpen.value)} aria-expanded={sidebarOpen.value}>
          <Icon name="filter" /> Filters{nFilters ? ` (${nFilters})` : ''}
          {totalNew.value > 0 && <span class="pill pill-new">{fmtCount(totalNew.value)} new</span>}
        </button>
      </header>

      <div class="layout">
        <aside class={`sidebar ${sidebarOpen.value ? 'open' : ''}`}>
          <Sidebar
            view={view}
            facets={facets}
            matchCounts={result.matchCounts}
            pickup={pickup}
            accountPickup={accountPickup}
            authed={authed}
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
          {curClosed && <ClosedLots section={curClosed} />}
          {/* Kept mounted under the Won / Lost page so its scroll observers keep working. */}
          <div hidden={!!curClosed}>
            <div class="results-line" ref={gridTop}>
              <span>
                {result.rows.length > 0 && plural(result.rows.length, 'lot')}
                {result.rows.length === 0 && loaded.value && !progress.value && 'No lots match'}
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
                <LotCard key={row.lot.id} row={row} isNew={isNew(row.lot)} />
              ))}
            </div>

            <div ref={gridEnd} />
            {curPage < pages && <p class="grid-more muted">Loading more lots…</p>}
          </div>
        </main>
      </div>

      {openLotObj && <LotModal row={rowOf(openLotObj)} onClose={closeLot} group={result.groups.get(openLotObj.id)} />}
      {curModal?.kind === 'bid' && bidLot && (
        <BidConfirm
          key={`${curModal.req.lotId}:${curModal.req.type}:${curModal.req.amount}`}
          req={curModal.req}
          row={rowOf(bidLot)}
          pickup={pickup}
          onClose={() => closeModal(curModal)}
        />
      )}
      {curModal?.kind === 'categories' && (
        <CategoryEditor lots={lots.value.values().filter((l) => l.endsAt > now30).toArray()} onClose={() => closeModal(curModal)} />
      )}
      {curModal?.kind === 'typeCategory' && (
        <TypeCategory lot={curModal.lot} lots={lots.value.values().filter((l) => l.endsAt > now30).toArray()} onClose={() => closeModal(curModal)} />
      )}
      {curModal?.kind === 'itemType' && (
        <ItemTypeEditor key={curModal.lot.id} lot={getLot(curModal.lot.id) ?? curModal.lot} onClose={() => closeModal(curModal)} />
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
  let refreshLabel = `Refresh in ${countdown(wait)}`;
  if (pull) {
    refreshLabel = 'Refreshing';
  } else if (due) {
    refreshLabel = 'Refresh';
  }
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
        <Icon name="refresh" size={16} /> {refreshLabel}
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
