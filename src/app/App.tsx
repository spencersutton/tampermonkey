// oxlint-disable typescript/no-unsafe-type-assertion
import { batch } from '@preact/signals';
import { useRef } from 'preact/hooks';

import { KEYS } from '../shared/keys';
import { isAuthenticated, LoginLink } from './auth';
import { BidConfirm } from './BidConfirm';
import { error, fetchedAt, getLot, loaded, lots, progress } from './catalog';
import { ClosedLots } from './ClosedLots';
import { Dialog } from './Dialog';
import { closeLot } from './history';
import { Icon } from './icons';
import { ItemTypeEditor } from './ItemType';
import { liveState, type LiveState } from './live';
import { LotCard } from './LotCard';
import { LotModal } from './LotModal';
import { getSetting, setSetting } from './settings';
import { Sidebar } from './Sidebar';
import { nextPullAt, pullCatalog } from './source';
import {
  accountPickupName,
  closed,
  filteredOnly,
  openFiltered,
  modalActions,
  filterFacets,
  gridView,
  highlight,
  modal,
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
  searchDraft,
  setSearchDraft,
  resetSearch,
  shownRows,
  PAGE_SIZE,
} from './state';
import { Toasts } from './toast';
import { TypeCategory } from './TypeCategory';
import type { Lot } from './types';
import { clock, fmtCount, MINUTE, plural, shortTime } from './util';
import {
  activeFilterCount,
  firstSeenAfter,
  normalizeView,
  sameFilters,
  savedFilters,
  searchRegexOf,
  SORTS,
  suggestName,
  type SavedSearch,
  type ViewState,
} from './view';
import { observeEnd } from './viewport';

/** How long ago `ts` was, e.g. "just now", "12 min ago"; older than a day shows the date. */
function ago(ts: Temporal.Instant, now: Temporal.Instant) {
  const m = Math.round((now.epochMilliseconds - ts.epochMilliseconds) / MINUTE);
  if (m < 1) {
    return 'just now';
  }
  if (m < 60) {
    return `${m} min ago`;
  }
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : new Date(ts.epochMilliseconds).toLocaleString();
}

/** Remaining time as "m:ss", or "Ns" under a minute. */
export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60
    ? `${Math.floor(s / 60)}:${((n: number) => String(n).padStart(2, '0'))(s % 60)}`
    : `${s}s`;
}

/** The whole /tlx page: sidebar, toolbar, infinitely scrolling lot grid, and the lot / bid popups. */
export function App() {
  const gridTop = useRef<HTMLDivElement>(null);
  const authed = isAuthenticated();
  const curClosed = closed.value;

  return (
    <div class="app">
      <AppHeader />
      <div class="layout">
        <AppSidebar gridTop={gridTop} authed={authed} />
        <main class="main">
          <StatusBar />
          {!authed && (
            <p class="notice">
              Not logged in: your bids, standings and watchlist aren’t shown.{' '}
              <LoginLink>Log in</LoginLink> to see them and bid.
            </p>
          )}
          {curClosed && <ClosedLots section={curClosed} />}
          <CatalogResults gridTop={gridTop} />
        </main>
      </div>
      <AppDialogs />
      <Toasts />
    </div>
  );
}

function AppSidebar({
  gridTop,
  authed,
}: {
  gridTop: { current: HTMLDivElement | null };
  authed: boolean;
}) {
  const saved = getSetting(KEYS.savedSearches);
  const view = storedView.value;
  const pickup = pickupName.value;
  const result = gridView.value;
  const facets = filterFacets.value;
  const savedStats = searchStats.value;
  const accountPickup = accountPickupName.value;
  const curClosed = closed.value;
  const curFiltered = filteredOnly.value;
  const search = searchDraft.value;
  const activeSaved = curFiltered ? null : (saved.find((s) => sameFilters(view, s.view)) ?? null);

  const updateSaved = (fn: (list: SavedSearch[]) => SavedSearch[]) =>
    setSetting(KEYS.savedSearches, fn(getSetting(KEYS.savedSearches)));
  const savedProps = {
    searches: saved,
    stats: savedStats,
    activeId: activeSaved?.id ?? null,
    canSave: !curFiltered && activeFilterCount({ ...view, newSince: null }) > 0 && !activeSaved,
    canUpdate: (s: SavedSearch) =>
      !curFiltered &&
      !curClosed &&
      (!sameFilters({ ...view, search }, s.view) || view.sort !== normalizeView(s.view).sort),
    suggestedName: suggestName(view, facets),
    onSave: (name: string) => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      updateSaved((l) =>
        l.some((x) => sameFilters(view, x.view))
          ? l
          : [...l, { id, name, view: savedFilters(view), lastViewedAt: Temporal.Now.instant() }],
      );
    },
    onOpen: (s: SavedSearch, newOnly: boolean) => {
      batch(() => {
        setSetting(KEYS.view, {
          ...normalizeView(s.view),
          newSince: newOnly ? s.lastViewedAt : null,
        });
        page.value = 1;
        closed.value = null;
        filteredOnly.value = false;
        highlight.value = { id: s.id, since: s.lastViewedAt };
        updateSaved((l) =>
          l.map((x) => (x.id === s.id ? { ...x, lastViewedAt: Temporal.Now.instant() } : x)),
        );
        sidebarOpen.value = false;
      });
      resetSearch(s.view.search);
      gridTop.current?.scrollIntoView({ block: 'start' });
    },
    onDelete: (id: string) => updateSaved((l) => l.filter((x) => x.id !== id)),
    onRename: (id: string, name: string) =>
      updateSaved((l) => l.map((x) => (x.id === id ? { ...x, name } : x))),
    onUpdate: (id: string) => {
      // Include text typed just before clicking, without waiting for the search debounce.
      setView({ search: searchDraft.value });
      updateSaved((l) =>
        l.map((x) => (x.id === id ? { ...x, view: savedFilters(storedView.value) } : x)),
      );
    },
  };

  return (
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
  );
}

function AppHeader() {
  const view = storedView.value;
  const search = searchDraft.value;
  const result = gridView.value;
  const nFilters = activeFilterCount(view);
  const badRegex = view.searchRegex && search.trim() !== '' && !searchRegexOf({ ...view, search });
  let searchTitle =
    'Search title, lot number, and known brand/model details. Narrow with brand:dewalt model:dcd791; quote multi-word values, e.g. brand:"Black & Decker". All terms must match. Uncached details become searchable when loaded.';
  if (badRegex) {
    searchTitle = 'Invalid regex';
  } else if (view.searchRegex) {
    searchTitle = 'Case-insensitive regex across title, lot number, and known brand/model details';
  }
  return (
    <header class="topbar">
      <a class="brand" href="/" title="Back to Triangle Liquidators">
        TL <span>Catalog</span>
      </a>
      <div class="search-box">
        <input
          class={`search ${badRegex ? 'has-error' : ''}`}
          type="search"
          placeholder={
            view.searchRegex
              ? `Regex search ${fmtCount(result.open)} lots`
              : `Search ${fmtCount(result.open)} lots: title, brand, model`
          }
          aria-label="Search lots"
          aria-invalid={badRegex}
          title={searchTitle}
          spellcheck={!view.searchRegex}
          value={search}
          onInput={(e) => setSearchDraft(e.currentTarget.value)}
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
      <select
        class="sort"
        aria-label="Sort"
        value={view.sort}
        onChange={(e) => setView({ sort: e.currentTarget.value as ViewState['sort'] })}
      >
        {Object.entries(SORTS).map(([k, { label }]) => (
          <option value={k}>{label}</option>
        ))}
      </select>
      <button
        type="button"
        class="btn btn-outline filters-toggle"
        onClick={() => (sidebarOpen.value = !sidebarOpen.value)}
        aria-expanded={sidebarOpen.value}
      >
        <Icon name="filter" /> Filters{nFilters ? ` (${nFilters})` : ''}
        {totalNew.value > 0 && <span class="pill pill-new">{fmtCount(totalNew.value)} new</span>}
      </button>
    </header>
  );
}

function CatalogResults({ gridTop }: { gridTop: { current: HTMLDivElement | null } }) {
  const view = storedView.value;
  const result = gridView.value;
  const curClosed = closed.value;
  const curFiltered = filteredOnly.value;
  const titleLines = getSetting(KEYS.titleLines);
  const saved = getSetting(KEYS.savedSearches);
  const activeSaved = curFiltered ? null : (saved.find((s) => sameFilters(view, s.view)) ?? null);
  // Lots that are new since the previous visit get a badge; while a saved
  // search is open, since that search's previous visit instead.
  const hl = highlight.value;
  const sinceSaved = hl != null && activeSaved?.id === hl.id;
  const newSince = view.newSince ?? (sinceSaved ? hl.since : visitSince.value);
  const isNew = (lot: Lot) => newSince != null && firstSeenAfter(lot, newSince);
  const freshMatches =
    view.newSince == null && newSince != null ? result.rows.filter((r) => isNew(r.lot)).length : 0;
  const pages = Math.max(1, Math.ceil(result.rows.length / PAGE_SIZE));
  const curPage = Math.min(page.value, pages);

  // Kept mounted under the Won / Lost page so its scroll observers keep working.
  return (
    <div hidden={curClosed != null}>
      {curFiltered && (
        <>
          <div class="closed-head">
            <button type="button" class="btn btn-text" onClick={() => openFiltered(false)}>
              <Icon name="chevronLeft" size={18} /> Catalog
            </button>
            <h1>Filtered lots</h1>
          </div>
          <p class="muted">
            Only lots matching your exclusion rules, including hidden lots. Search and sidebar
            filters still apply.
          </p>
        </>
      )}
      <div class="results-line" ref={gridTop}>
        <span>
          {result.rows.length > 0 && plural(result.rows.length, 'lot')}
          {result.rows.length === 0 &&
            loaded.value &&
            !progress.value &&
            (curFiltered ? 'No filtered lots match' : 'No lots match')}
          {result.removed > 0 && (
            <span class="muted"> · {fmtCount(result.removed)} hidden or removed</span>
          )}
          {result.filteredOut > 0 && (
            <span class="muted"> · {fmtCount(result.filteredOut)} outside filters</span>
          )}
          {result.combined > 0 && (
            <span class="muted"> · {fmtCount(result.combined)} duplicates combined</span>
          )}
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
            {fmtCount(freshMatches)} new since your last{' '}
            {sinceSaved ? `look at “${activeSaved.name}”` : 'visit'}
            <button type="button" class="btn-text" onClick={() => setView({ newSince })}>
              Show only new
            </button>
          </span>
        )}
      </div>

      <div
        class={`grid ${titleLines ? '' : 'full-titles'}`}
        style={titleLines ? { '--title-lines': titleLines } : undefined}
      >
        {shownRows.value.map((row) => (
          <LotCard key={row.lot.id} row={row} isNew={isNew(row.lot)} />
        ))}
      </div>

      <div ref={observeEnd} />
      {curPage < pages && <p class="grid-more muted">Loading more lots…</p>}
    </div>
  );
}

function AppDialogs() {
  const curOpenId = openId.value;
  const curModal = modal.value;
  const result = gridView.value;
  const pickup = pickupName.value;
  const now30 = clock(30_000);
  const openLotObj = curOpenId != null ? getLot(curOpenId) : undefined;
  const bidLot = curModal?.kind === 'bid' ? getLot(curModal.req.lotId) : undefined;

  return (
    <>
      {openLotObj && (
        <LotModal
          row={rowOf(openLotObj)}
          onClose={closeLot}
          group={result.groups.get(openLotObj.id)}
        />
      )}
      {curModal?.kind === 'bid' && bidLot && (
        <BidConfirm
          key={`${curModal.req.lotId}:${curModal.req.type}:${curModal.req.amount}`}
          req={curModal.req}
          row={rowOf(bidLot)}
          pickup={pickup}
          onClose={() => modalActions.close(curModal)}
        />
      )}
      {curModal?.kind === 'typeCategory' && (
        <TypeCategory
          lot={curModal.lot}
          lots={lots.value
            .values()
            .filter((l) => Temporal.Instant.compare(l.endsAt, now30) > 0)
            .toArray()}
          onClose={() => modalActions.close(curModal)}
        />
      )}
      {curModal?.kind === 'itemType' && (
        <ItemTypeEditor
          key={curModal.lot.id}
          lot={getLot(curModal.lot.id) ?? curModal.lot}
          onClose={() => modalActions.close(curModal)}
        />
      )}
      {curModal?.kind === 'shortcuts' && (
        <Dialog onClose={() => modalActions.close(curModal)} aria-labelledby="shortcuts-title">
          <div class="confirm" tabIndex={-1}>
            <h2 id="shortcuts-title">Keyboard shortcuts</h2>
            <div class="confirm-body">
              <dl class="shortcut-guide">
                <dt>
                  <kbd>Alt+Shift+D</kbd>
                </dt>
                <dd>Save category &amp; condition defaults</dd>
                <dt>
                  <kbd>Alt+Shift+E</kbd>
                </dt>
                <dd>Expand all categories</dd>
                <dt>
                  <kbd>Alt+Shift+C</kbd>
                </dt>
                <dd>Collapse all categories</dd>
                <dt>
                  <kbd>?</kbd> (Shift+/)
                </dt>
                <dd>Show this guide (outside text fields)</dd>
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>Close the current popup</dd>
              </dl>
              <p class="muted small">
                On Mac, use Option instead of Alt. Catalog shortcuts are inactive while a popup is
                open.
              </p>
            </div>
            <div class="confirm-actions">
              <button type="button" class="btn" onClick={() => modalActions.close(curModal)}>
                Close
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

const LIVE_LABELS: Record<LiveState, string> = {
  connected: 'Live',
  connecting: 'Connecting',
  off: 'Live off',
  disconnected: 'Offline',
};

/** Catalog freshness, pull progress, live connection state and the manual refresh button. */
function StatusBar() {
  const live = liveState.value;
  const now = clock(1000);
  const pull = progress.value;
  const lastFetch = fetchedAt.value;
  const nextPull = nextPullAt();
  const wait = nextPull.epochMilliseconds - now.epochMilliseconds;
  const due = Temporal.Instant.compare(nextPull, now) <= 0;

  let text = 'No cached catalog yet';
  if (!loaded.value) {
    text = 'Loading catalog…';
  } else if (pull) {
    text = pull.total
      ? `Refreshing catalog… ${fmtCount(pull.done)} of ${fmtCount(pull.total)}`
      : 'Refreshing catalog…';
  } else if (lastFetch) {
    text = `${fmtCount(lots.value.size)} lots · refreshed ${ago(lastFetch, now)}`;
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
        disabled={!loaded.value || pull != null || !due}
        onClick={() => void pullCatalog()}
        title={
          due
            ? 'Pull the full catalog now'
            : 'Full refreshes are rate-limited; change the interval in Settings'
        }
      >
        <Icon name="refresh" size={16} /> {refreshLabel}
      </button>
      {pull && (
        <span
          class="progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${pct}%` }} />
        </span>
      )}
      {error.value && <span class="error">{error.value}</span>}
    </div>
  );
}
