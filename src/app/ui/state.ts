import { batch, computed, effect, signal, untracked } from '@preact/signals';

import { DAY, MINUTE } from '../../shared/constants';
import { KEYS, siteUrl } from '../../shared/keys';
// App-wide UI state as signals, the values derived from it, and the actions
// that change it. Components read and call these directly instead of passing
// state and callbacks down.
import {
  addFilterType,
  firstVisitSince,
  hideItemTypeView,
  rememberSearchList,
  toggleHiddenLot,
} from '../logic/catalog';
import type { ClosedSection } from '../logic/history';
import { suggest } from '../logic/suggest';
import {
  computeFacets,
  computeView,
  contextualFacets,
  DEFAULT_VIEW,
  initialView,
  makeRow,
  savedSearchStats,
  type ViewState,
} from '../logic/view';
import { fetchPickupLocation } from '../server/api';
import { isAuthenticated } from '../server/auth';
import type { BidRequest } from '../server/bid';
import { getLot, lotBrands, lotDescriptions, lotModels, lots, rev } from '../server/catalog';
import { clock } from '../server/reactive';
import { getSetting, setSetting } from '../server/settings';
import { settingsReady } from '../server/source';
import { keepScrollAnchor } from './dom';

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

/** Open the Filtered lots view narrowed to a single filtered item type. */
export function openFilteredType(type: string) {
  const key = type.trim().toLowerCase();
  batch(() => {
    resetSearch('');
    setSetting(KEYS.view, { ...DEFAULT_VIEW, sort: storedView.value.sort, types: [key] });
    filteredOnly.value = true;
    closed.value = null;
    page.value = 1;
    sidebarOpen.value = false;
  });
  window.scrollTo(0, 0);
}

export function toggleHide(lot: Lot) {
  setSetting(KEYS.hidden, toggleHiddenLot(getSetting(KEYS.hidden), lot));
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
const accountPickupName = computed(() => {
  const acct = getSetting(KEYS.accountPickup);
  if (acct?.name || acct?.id == null) {
    return acct?.name ?? null;
  }
  // The account may only give the location's id; find its name among the lots.
  return lots.value.values().find(l => l.location.id === acct.id)?.location.name ?? null;
});
export const pickupName = computed(() => accountPickupName.value || 'Raleigh');

// Filters and debounced search

export const storedView = computed(() => initialView(getSetting(KEYS.view)));
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
    if (patch.search != null) {
      resetSearch(patch.search);
    }
    setSetting(KEYS.view, { ...storedView.value, ...patch });
    page.value = 1;
    closed.value = null; // changing the filters goes back to the grid
  });
}

/**
 * Hide an item type without moving the page: by default adds it to the permanent global item-type
 * filter list; with `temporary` (when a modifier key is held), excludes it only from the current
 * search view.
 */
export function hideItemType(type: string, from?: EventTarget | null, temporary = false) {
  if (temporary) {
    const next = hideItemTypeView(storedView.value, type);
    keepScrollAnchor(from, () => setSetting(KEYS.view, next));
    return;
  }
  const cur = getSetting(KEYS.filterTypes);
  const next = addFilterType(cur, type);
  if (next !== cur) {
    keepScrollAnchor(from, () => setSetting(KEYS.filterTypes, next));
  }
}

export const exclusionRules = computed(() => ({
  words: getSetting(KEYS.words),
  filterTypes: getSetting(KEYS.filterTypes),
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
const searchDetails = computed(() => ({
  brands: lotBrands.value,
  models: lotModels.value,
  descriptions: lotDescriptions.value,
}));
/** The grid: lots through the view's filters and sort, recomputed on every lot update. */
export const gridView = computed(() => {
  void rev.value; // subscribe to in-place lot updates
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
    storedView.value.searchDescriptions,
  ),
);

/** Remember a search the user settled on, most recent first. */
export function rememberSearch(text: string) {
  const next = rememberSearchList(getSetting(KEYS.recentSearches), text);
  if (next) {
    setSetting(KEYS.recentSearches, next);
  }
}
export const shownRows = computed(() => gridView.value.rows.slice(0, page.value * PAGE_SIZE));
export const rowOf = (lot: Lot) => makeRow(lot, pickupName.value, exclusionRules.value);

// Saved searches and visit tracking

/** The saved search opened last, and when it had been viewed before that. */
export const highlight = signal<{ id: string; since: number } | null>(null);

export const searchStats = computed(() => {
  void rev.value; // subscribe to in-place lot updates
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
export const totalNew = computed(() => searchStats.value.values().sumBy(s => s.fresh));

/** Coming back to the tab after it was hidden this long counts as a new visit. */
const VISIT_GAP = 30 * MINUTE;

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
    visitSince.value = lastVisit ?? firstVisitSince(lots.peek().values(), now);
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
