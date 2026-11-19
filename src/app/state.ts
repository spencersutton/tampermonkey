// App-wide UI state as signals, the values derived from it, and the actions
// that change it. Components read and call these directly instead of passing
// state and callbacks down.
import { batch, computed, effect, signal, untracked } from '@preact/signals';

import { KEYS, lotHref, siteUrl } from '../shared/keys';
import { endsAtMs } from '../shared/lot';
import { fetchPickupLocation, type ClosedSection } from './api';
import { isAuthenticated } from './auth';
import type { BidRequest } from './bid';
import { getLot, lotBrands, lotModels, lots, rev } from './catalog';
import { getSetting, setSetting } from './settings';
import { settingsReady } from './source';
import { suggest } from './suggest';
import type { Lot } from './types';
import { clock, DAY, MINUTE } from './util';
import {
  computeFacets,
  computeView,
  contextualFacets,
  initialView,
  makeRow,
  savedSearchStats,
  type ViewState,
} from './view';

// Navigation and lot actions

export const openId = signal<number | null>(null);
/** The Won / Lost page, shown in place of the grid. */
export const closed = signal<ClosedSection | null>(null);
export const filteredOnly = signal(false);
export const sidebarOpen = signal(false);

export const openLot = (lot: Lot) => void (openId.value = lot.id);

/** Open a hidden lot: in the popup when it's in the catalog, else on the site. */
export function openHidden(id: number) {
  if (getLot(id)) {
    openId.value = id;
  } else {
    window.open(siteUrl(getSetting(KEYS.hidden)[id]?.href ?? '/'), '_blank', 'noopener');
  }
}

/** Show the Won / Lost page, or the grid again for null. */
export function openClosed(section: ClosedSection | null) {
  batch(() => {
    closed.value = section;
    filteredOnly.value = false;
    sidebarOpen.value = false;
  });
  window.scrollTo(0, 0);
}

export function openFiltered(show = true) {
  batch(() => {
    filteredOnly.value = show;
    closed.value = null;
    page.value = 1;
    sidebarOpen.value = false;
  });
  window.scrollTo(0, 0);
}

export function toggleHide(lot: Lot) {
  const { [lot.id]: wasHidden, ...rest } = getSetting(KEYS.hidden);
  setSetting(
    KEYS.hidden,
    wasHidden
      ? rest
      : {
          ...rest,
          [lot.id]: { title: lot.title, href: lotHref(lot.auction_period, lot.id), ts: Date.now() },
        },
  );
}

// Modal state and actions

export type Modal =
  | { kind: 'bid'; req: BidRequest }
  | { kind: 'categories' }
  | { kind: 'shortcuts' }
  | { kind: 'typeCategory'; lot: Lot } // making the lot's item type a category
  | { kind: 'itemType'; lot: Lot };
/** The popup over everything else, including the lot popup. */
export const modal = signal<Modal | null>(null);

export const modalActions = {
  startBid: (req: BidRequest) => {
    modal.value = { kind: 'bid', req };
  },
  addType: (lot: Lot) => {
    modal.value = { kind: 'typeCategory', lot };
  },
  editType: (lot: Lot) => {
    modal.value = { kind: 'itemType', lot };
  },
  editCategories: () => {
    modal.value = { kind: 'categories' };
  },
  showShortcuts: () => {
    modal.value = { kind: 'shortcuts' };
  },
  /** Close `m` if it is still the open popup (a late close mustn't close a newer one). */
  close: (m: Modal) => {
    if (modal.peek() === m) {
      modal.value = null;
    }
  },
};

// Pickup location

/** Name of the account's pickup location (fetched at most once a day while logged in). */
export const accountPickupName = computed(() => {
  const acct = getSetting(KEYS.accountPickup);
  if (acct?.name || acct?.id == null) {
    return acct?.name ?? null;
  }
  // The account may only give the location's id; find its name among the lots.
  return lots.value.values().find(l => l.location.id === acct.id)?.location.name ?? null;
});
export const pickupName = computed(() => accountPickupName.value || 'Raleigh');

// Filters and debounced search

export const storedView = computed(() =>
  initialView(getSetting(KEYS.view), getSetting(KEYS.defaultFilters)),
);
export const searchDraft = signal('');
const committedSearch = computed(() => storedView.value.search);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

export function setSearchDraft(text: string) {
  searchDraft.value = text;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => setView({ search: text }), 200);
}

export function resetSearch(text: string) {
  clearTimeout(searchTimer);
  searchDraft.value = text;
}

export function setView(patch: Partial<ViewState>) {
  batch(() => {
    if (patch.search != null) resetSearch(patch.search);
    setSetting(KEYS.view, { ...storedView.value, ...patch });
    page.value = 1;
    closed.value = null; // changing the filters goes back to the grid
  });
}

/**
 * Drop a category from the grid without moving the page: keep the cards already loaded, and put the
 * next card that survives where the clicked one was.
 */
export function hideCategory(value: string, from?: EventTarget | null) {
  const view = storedView.value;
  const selected =
    view.categories.length || view.noCategories
      ? view.categories
      : filterFacets.value.categories.map(f => f.value);
  const categories = selected.filter(v => v !== value);
  const clicked =
    typeof Element !== 'undefined' && from instanceof Element
      ? from.closest('article[data-lot]')
      : null;
  const cards = clicked ? [...document.querySelectorAll('article[data-lot]')] : [];
  const at = clicked ? cards.indexOf(clicked) : -1;
  const anchorTop = clicked?.getBoundingClientRect().top;
  const after = at >= 0 ? cards.slice(at + 1) : [];
  const before = at >= 0 ? cards.slice(0, at).toReversed() : [];
  const beforeTops = new Map(before.map(card => [card, card.getBoundingClientRect().top]));
  setSetting(KEYS.view, { ...view, categories, noCategories: !categories.length });
  if (anchorTop == null) return;
  // Preact renders on a microtask, so this runs after the grid updates but before it's painted.
  requestAnimationFrame(() => {
    const next = after.find(card => card.isConnected);
    const prev = next ? undefined : before.find(card => card.isConnected);
    const target = next ?? prev;
    if (!target) return;
    const want = next ? anchorTop : beforeTops.get(target)!;
    window.scrollBy(0, target.getBoundingClientRect().top - want);
  });
}

export const exclusionRules = computed(() => ({
  words: getSetting(KEYS.words),
  filterOn: getSetting(KEYS.filterOn),
  removeFiltered: getSetting(KEYS.removeFiltered),
  hidden: getSetting(KEYS.hidden),
  showHidden: getSetting(KEYS.showHidden),
  customCategories: getSetting(KEYS.customCategories),
}));

// Catalog rows, facets and pagination

export const PAGE_SIZE = 60;
/** How many batches of lots the grid shows; grows as the end of it scrolls into view. */
export const page = signal(1);
/** Ids of the lot cards on screen or close to it, sorted. */
export const onScreen = signal<number[]>([]);

// Closed lots drop out on a 30 s clock; countdowns tick on their own.
const searchDetails = computed(() => ({ brands: lotBrands.value, models: lotModels.value }));
/** The grid: lots through the view's filters and sort, recomputed on every lot update. */
export const gridView = computed(() => {
  void rev.value;
  return computeView(
    lots.value.values(),
    storedView.value,
    pickupName.value,
    exclusionRules.value,
    clock(30_000),
    searchDetails.value,
    filteredOnly.value,
  );
});
/** Every filter option among open lots, with catalog-wide counts; these don't follow live prices. */
export const filterFacets = computed(() =>
  computeFacets(
    lots.value.values(),
    clock(30_000),
    getSetting(KEYS.customCategories),
    searchDetails.value,
  ),
);
/** The sidebar's filter options, counted among the current results (each ignoring its own filter). */
export const sidebarFacets = computed(() =>
  contextualFacets(filterFacets.value, gridView.value.facetCounts, storedView.value),
);
/** The search that produced the grid: the typed one, or its spelling correction. */
export const effectiveSearch = computed(() =>
  storedView.value.searchRegex ? '' : (gridView.value.correctedSearch ?? storedView.value.search),
);
/** Typeahead suggestions for the text in the search box. */
export const suggestions = computed(() =>
  suggest(
    searchDraft.value,
    filterFacets.value,
    lots.value.values(),
    clock(30_000),
    exclusionRules.value.hidden,
    searchDetails.value,
  ),
);

const RECENT_SEARCHES = 8;
/** Remember a search the user settled on, most recent first. */
export function rememberSearch(text: string) {
  const q = text.trim();
  if (!q) return;
  const rest = getSetting(KEYS.recentSearches).filter(s => s.toLowerCase() !== q.toLowerCase());
  setSetting(KEYS.recentSearches, [q, ...rest].slice(0, RECENT_SEARCHES));
}
export const shownRows = computed(() => gridView.value.rows.slice(0, page.value * PAGE_SIZE));
export const rowOf = (lot: Lot) => makeRow(lot, pickupName.value, exclusionRules.value);

// Saved searches and visit tracking

/** The saved search opened last, and when it had been viewed before that. */
export const highlight = signal<{ id: string; since: number } | null>(null);

export const searchStats = computed(() => {
  void rev.value;
  return savedSearchStats(
    lots.value.values(),
    getSetting(KEYS.savedSearches),
    pickupName.value,
    exclusionRules.value,
    clock(30_000),
    searchDetails.value,
  );
});
/** New lots across all saved searches. */
export const totalNew = computed(() => searchStats.value.values().reduce((n, s) => n + s.fresh, 0));

/** Coming back to the tab after it was hidden this long counts as a new visit. */
const VISIT_GAP = 30 * MINUTE;
/** Before any visit was recorded, lots with more than this left are taken to be new. */
const FIRST_VISIT_NEW_LEFT = 2 * DAY;

/**
 * Lots first seen after this count as new: the start of the previous visit (a page load, or the tab
 * coming back after VISIT_GAP hidden), shared by all devices. null until the synced settings have
 * arrived.
 */
export const visitSince = signal<number | null>(null);

function trackVisits() {
  const visit = () => {
    const now = Date.now();
    const lastVisit = getSetting(KEYS.lastVisit);
    visitSince.value = lastVisit ?? firstVisitSince(now);
    setSetting(KEYS.lastVisit, now);
  };
  let hiddenAt = 0;
  void settingsReady.then(() => {
    visit();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= VISIT_GAP) {
        visit();
      }
    });
  });
}

/**
 * With no previous visit, start just before the earliest-seen lot that still has over
 * FIRST_VISIT_NEW_LEFT to go.
 */
function firstVisitSince(now: number): number {
  const newAfter = now + FIRST_VISIT_NEW_LEFT;
  const first = lots
    .peek()
    .values()
    .filter(l => endsAtMs(l) > newAfter)
    .reduce<number | null>((min, l) => Math.min(min ?? Infinity, l.firstSeenAt ?? 0), null);
  if (first == null) return now;
  return Math.max(0, first - 1);
}

// App initialization

/** Start the app-wide effects; call once. */
export function startApp() {
  trackVisits();
  effect(() => resetSearch(committedSearch.value));

  effect(() => {
    if (!isAuthenticated()) {
      return;
    }
    const acct = untracked(() => getSetting(KEYS.accountPickup));
    if (!(acct && Date.now() - acct.at < DAY)) {
      fetchPickupLocation().then(
        p =>
          setSetting(KEYS.accountPickup, {
            id: p?.id ?? null,
            name: p?.name ?? null,
            at: Date.now(),
          }),
        () => {},
      );
    }
  });

  effect(() => {
    document.title = totalNew.value ? `(${totalNew.value}) TL Catalog` : 'TL Catalog';
  });
}
