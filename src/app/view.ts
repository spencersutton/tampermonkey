// Catalog view: filters and sorting applied locally to the cached catalog.
import { buildRegexes, compileFilter, firstMatch, type CompiledFilter } from '../shared/filters';
import { totalCost } from '../shared/cost';
import { collator, sortKey } from '../shared/sortKey';
import type { CustomCategory, HiddenLot } from '../shared/keys';
import { hasBidOn } from './bid';
import type { Lot } from './types';
import { HOUR } from './util';

/** A lot with everything the grid needs computed once. */
export interface Row {
  lot: Lot;
  category: Lot['category']; // my custom category if one matches the title, else the site's
  transferFee: number; // fee to get it to my pickup location (0 if already there)
  pickupOnly: boolean; // at another location and not transferable
  total: number;
  retailPct: number | null;
  matched: string | null; // regex filter that matched the title
  hidden: boolean;
  others: Row[]; // identical listings folded into this card (cheapest first)
}

type Compare = (a: Row, b: Row) => number;

/** Sort options. Ties always fall back to ending soonest. */
export const SORTS = {
  'ending-soonest': { label: 'Ending soonest', compare: () => 0 },
  'newly-listed': { label: 'Newly listed', compare: (a, b) => b.lot.id - a.lot.id },
  'title-asc': { label: 'Title A–Z', compare: (a, b) => collator.compare(titleKey(a.lot.title), titleKey(b.lot.title)) },
  'title-desc': { label: 'Title Z–A', compare: (a, b) => collator.compare(titleKey(b.lot.title), titleKey(a.lot.title)) },
  'total-asc': { label: 'Total cost: low to high', compare: (a, b) => a.total - b.total },
  'total-desc': { label: 'Total cost: high to low', compare: (a, b) => b.total - a.total },
  'retail-pct-asc': { label: 'Best deal (% of retail)', compare: (a, b) => (a.retailPct ?? Infinity) - (b.retailPct ?? Infinity) },
  'retail-desc': { label: 'Retail price: high to low', compare: (a, b) => (b.lot.estimatedRetailPrice ?? -1) - (a.lot.estimatedRetailPrice ?? -1) },
  'bids-most': { label: 'Most bids', compare: (a, b) => b.lot.bidCount - a.lot.bidCount },
  'bids-fewest': { label: 'Fewest bids', compare: (a, b) => a.lot.bidCount - b.lot.bidCount },
} satisfies Record<string, { label: string; compare: Compare }>;
export type SortId = keyof typeof SORTS;

type Window = [start: number, end: number];

/** The next `h` hours. */
function nextHours(h: number) {
  return (now: number): Window => [now, now + h * HOUR];
}

/** The calendar day `offset` days from today, minus the part already past. */
function day(offset: number) {
  return (now: number): Window => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    const start = d.getTime();
    d.setDate(d.getDate() + 1);
    return [Math.max(start, now), d.getTime()];
  };
}

/** "Ending" filter options, with the closing-time window each allows. */
export const ENDING = {
  '': { label: 'Any time', window: null },
  '1h': { label: 'Within 1 hour', window: nextHours(1) },
  '3h': { label: 'Within 3 hours', window: nextHours(3) },
  today: { label: 'Today', window: day(0) },
  tomorrow: { label: 'Tomorrow', window: day(1) },
} satisfies Record<string, { label: string; window: ((now: number) => Window) | null }>;
export type EndingId = keyof typeof ENDING;

/** "My lots" filter options. */
export const MINE = {
  '': { label: 'All lots', test: () => true },
  bid: { label: 'Lots I bid on', test: hasBidOn },
  leading: { label: 'I’m winning', test: (l) => !!l.yourStanding?.isLeading },
  outbid: { label: 'I’m outbid', test: (l) => hasBidOn(l) && !l.yourStanding?.isLeading },
  watch: { label: 'Watchlist', test: (l) => l.isWatchlisted },
} satisfies Record<string, { label: string; test: (lot: Lot) => boolean }>;
export type MineId = keyof typeof MINE;

export interface ViewState {
  sort: SortId;
  search: string;
  categories: string[];
  conditions: number[];
  locations: string[];
  reachable: boolean; // only lots available at my pickup location (there already, or transferable)
  priceMin: number | null;
  priceMax: number | null;
  totalMax: number | null;
  retailMin: number | null;
  ending: EndingId;
  mine: MineId;
  newSince: number | null; // only lots first seen after this time (not saved with searches)
}

/** View with no filters, sorted by ending soonest. */
export const DEFAULT_VIEW: ViewState = {
  sort: 'ending-soonest',
  search: '',
  categories: [],
  conditions: [],
  locations: [],
  reachable: false,
  priceMin: null,
  priceMax: null,
  totalMax: null,
  retailMin: null,
  ending: '',
  mine: '',
  newSince: null,
};

/** Turn a stored (possibly old or invalid) view into a complete ViewState. */
export function normalizeView(v: unknown): ViewState {
  const view = { ...DEFAULT_VIEW, ...(v && typeof v === 'object' ? (v as Partial<ViewState>) : {}) };
  return {
    ...view,
    sort: Object.hasOwn(SORTS, view.sort) ? view.sort : DEFAULT_VIEW.sort,
    ending: Object.hasOwn(ENDING, view.ending) ? view.ending : DEFAULT_VIEW.ending,
    mine: Object.hasOwn(MINE, view.mine) ? view.mine : DEFAULT_VIEW.mine,
  };
}

/** How many filters the view has turned on (shown on the "Clear" button). */
export const activeFilterCount = (v: ViewState) =>
  [
    v.search.trim(),
    v.categories.length,
    v.conditions.length,
    v.locations.length,
    v.reachable,
    v.priceMin != null || v.priceMax != null,
    v.totalMax != null,
    v.retailMin != null,
    v.ending,
    v.mine,
    v.newSince != null,
  ].filter(Boolean).length;

export interface Exclusions {
  words: string[];
  filterOn: boolean;
  removeFiltered: boolean;
  hidden: Record<string, HiddenLot>;
  showHidden: boolean;
  customCategories: CustomCategory[];
}

/** Memoized sortKey() results by title. */
const sortKeys = new Map<string, string>();

/** sortKey() for a title, cached. */
function titleKey(title: string) {
  let key = sortKeys.get(title);
  if (key === undefined) {
    key = sortKey(title);
    sortKeys.set(title, key);
  }
  return key;
}

/** Compiled regex filters for the most recent word list. */
let regexCache: { words: string[]; compiled: CompiledFilter[] } | null = null;

/** Compiled regexes for the filter words, recompiled only when the list changes. */
function compiledFilters(words: string[]) {
  if (regexCache?.words !== words) {
    regexCache = { words, compiled: buildRegexes(words) };
  }
  return regexCache.compiled;
}

/** Prefix that keeps custom category values apart from the site's. */
const CUSTOM_PREFIX = 'custom:';

/** Filter value of a custom category. */
export const customCategoryValue = (name: string) => CUSTOM_PREFIX + name;

/** Compiled custom categories for the most recent list. */
let categoryCache: { cats: CustomCategory[]; compiled: { category: NonNullable<Lot['category']>; re: RegExp | null }[] } | null = null;

/**
 * The lot's category: the first custom category whose regex matches the
 * title, else the site's. A lot in a custom category is in that one only.
 */
export function categoryOf(lot: Lot, cats: CustomCategory[]): Lot['category'] {
  if (categoryCache?.cats !== cats) {
    categoryCache = {
      cats,
      compiled: cats.map((c) => ({ category: { value: customCategoryValue(c.name), label: c.name }, re: compileFilter(c.pattern) })),
    };
  }
  return categoryCache.compiled.find(({ re }) => re?.test(lot.title))?.category ?? lot.category;
}

/** Build the grid row for a lot: pickup/transfer cost, total, % of retail, filter match and hidden state. */
export function makeRow(lot: Lot, pickup: string, ex: Exclusions): Row {
  const elsewhere = !!lot.location && lot.location.name !== pickup;
  const transferFee = elsewhere && lot.isTransferable ? lot.transferFee : 0;
  return {
    lot,
    category: categoryOf(lot, ex.customCategories),
    transferFee,
    pickupOnly: elsewhere && !lot.isTransferable,
    total: totalCost(lot.currentPrice, transferFee),
    retailPct: lot.estimatedRetailPrice ? lot.currentPrice / lot.estimatedRetailPrice : null,
    matched: ex.filterOn ? firstMatch(compiledFilters(ex.words), lot.title) : null,
    hidden: !!ex.hidden[lot.id],
    others: [],
  };
}

export interface ViewResult {
  rows: Row[]; // after all filters, sorted
  open: number; // lots still open
  removed: number; // open lots dropped by hide / remove-filtered
  filteredOut: number; // open lots dropped by the view's own filters
  matchCounts: Map<string, number>; // open lots each regex filter matches
  combined: number; // listings folded into another card as duplicates
  groups: Map<number, Row[]>; // lot id -> every listing in its group (cheapest first)
}

/** Filter, combine and sort the catalog for the grid, with counts for the status line and sidebar. */
export function computeView(lots: Iterable<Lot>, view: ViewState, pickup: string, ex: Exclusions, now: number): ViewResult {
  const matches = makeMatcher(view, now);
  const matchCounts = new Map(ex.words.map((w) => [w, 0]));
  const compiled = compiledFilters(ex.words);

  const rows: Row[] = [];
  let open = 0;
  let removed = 0;
  let filteredOut = 0;
  for (const lot of lots) {
    if (lot.endsAt <= now) {
      continue;
    }
    open++;
    for (const { word, re } of compiled) {
      if (re?.test(lot.title)) {
        matchCounts.set(word, matchCounts.get(word)! + 1);
      }
    }
    const row = makeRow(lot, pickup, ex);
    if ((row.hidden && !ex.showHidden) || (row.matched && ex.removeFiltered)) {
      removed++;
    } else if (!matches(row)) {
      filteredOut++;
    } else {
      rows.push(row);
    }
  }
  const { cards, groups } = combineDuplicates(rows);
  const compare: Compare = SORTS[view.sort].compare;
  cards.sort((a, b) => compare(a, b) || a.lot.endsAt - b.lot.endsAt || a.lot.id - b.lot.id);
  return { rows: cards, open, removed, filteredOut, matchCounts, combined: rows.length - cards.length, groups };
}

/**
 * Cheapest total cost first (so a transfer fee counts against a lot at another
 * location); ties go to the one ending soonest. Lots you can't get to your
 * pickup location come last.
 */
const byCost = (a: Row, b: Row) =>
  +a.pickupOnly - +b.pickupOnly || a.total - b.total || a.lot.endsAt - b.lot.endsAt || a.lot.id - b.lot.id;

/**
 * Fold listings with the same title and condition, at any location, into one
 * card showing the cheapest by total cost (ties: ending soonest). Lots you've
 * bid on, hidden lots and regex-filtered lots keep their own card.
 */
function combineDuplicates(rows: Row[]): { cards: Row[]; groups: Map<number, Row[]> } {
  const ownCard = (row: Row) => hasBidOn(row.lot) || row.hidden || !!row.matched;
  const cards = rows.filter(ownCard);
  const groups = new Map<number, Row[]>();
  const buckets = Map.groupBy(
    rows.filter((row) => !ownCard(row)),
    ({ lot }) => `${lot.title.trim().toLowerCase()}\u0000${lot.condition?.value ?? ''}`,
  );
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      cards.push(bucket[0]);
      continue;
    }
    bucket.sort(byCost);
    cards.push({ ...bucket[0], others: bucket.slice(1) });
    bucket.forEach((r) => groups.set(r.lot.id, bucket));
  }
  return { cards, groups };
}

/** Predicate for "value is one of the selected", where selecting nothing allows everything. */
function oneOf<T>(selected: T[]): (value: T) => boolean {
  const set = new Set(selected);
  return (value) => !set.size || set.has(value);
}

/** Predicate for the view's own filters (not hide / regex exclusions). */
export function makeMatcher(v: ViewState, now: number): (row: Row) => boolean {
  const terms = v.search.toLowerCase().split(/\s+/).filter(Boolean);
  const win = ENDING[v.ending].window?.(now);
  const category = oneOf(v.categories);
  const condition = oneOf(v.conditions);
  const location = oneOf(v.locations);
  const mine: (lot: Lot) => boolean = MINE[v.mine].test;
  const searchMatches = (lot: Lot) => {
    const hay = `${lot.title} ${lot.lotNumber}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
  return ({ lot, category: cat, total, pickupOnly }) =>
    (v.newSince == null || (lot.firstSeenAt ?? 0) > v.newSince) &&
    (!terms.length || searchMatches(lot)) &&
    category(cat?.value ?? '') &&
    condition(lot.condition?.value ?? -1) &&
    location(lot.location?.name ?? '') &&
    !(v.reachable && pickupOnly) &&
    (v.priceMin == null || lot.currentPrice >= v.priceMin) &&
    (v.priceMax == null || lot.currentPrice <= v.priceMax) &&
    (v.totalMax == null || total <= v.totalMax) &&
    (v.retailMin == null || (lot.estimatedRetailPrice ?? 0) >= v.retailMin) &&
    (!win || (lot.endsAt >= win[0] && lot.endsAt < win[1])) &&
    mine(lot);
}

export interface Facet<T> {
  value: T;
  label: string;
  count: number;
}

export interface Facets {
  categories: Facet<string>[];
  conditions: Facet<number>[];
  locations: Facet<string>[];
}

/** Distinct values with how often each occurs (the first label seen wins). */
function tally<T>(items: ({ value: T; label: string } | null)[]): Facet<T>[] {
  const groups = Map.groupBy(
    items.filter((i) => i != null),
    (i) => i.value,
  );
  return Array.from(groups.values(), (g) => ({ value: g[0].value, label: g[0].label, count: g.length }));
}

/** Categories (custom ones included), conditions and locations among open lots, with counts, for the filter lists. */
export function computeFacets(lots: Iterable<Lot>, now: number, customCategories: CustomCategory[]): Facets {
  const open = Array.from(lots).filter((l) => l.endsAt > now);
  return {
    categories: tally(open.map((l) => categoryOf(l, customCategories))).sort((a, b) => a.label.localeCompare(b.label)),
    conditions: tally(open.map((l) => l.condition)).sort((a, b) => a.value - b.value),
    locations: tally(open.map((l) => l.location && { value: l.location.name, label: l.location.name })).sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------
export interface SavedSearch {
  id: string;
  name: string;
  view: Omit<ViewState, 'newSince'>;
  lastViewedAt: number; // lots first seen after this count as new
}

/** The parts of a view that a saved search stores. */
export const savedFilters = ({ newSince, ...rest }: ViewState): Omit<ViewState, 'newSince'> => rest;

/** Same filters (ignoring sort and the "new only" toggle)? */
export function sameFilters(a: ViewState, b: Omit<ViewState, 'newSince'>): boolean {
  const strip = ({ sort, ...rest }: Omit<ViewState, 'newSince'>) => rest;
  return JSON.stringify(strip(savedFilters(a))) === JSON.stringify(strip(savedFilters(normalizeView(b))));
}

/** Default name for a new saved search, built from its filters. */
export function suggestName(v: ViewState, facets: Facets): string {
  const parts = [
    v.search.trim(),
    ...v.categories.map((c) => facets.categories.find((f) => f.value === c)?.label ?? c),
    v.locations.join('/'),
    v.priceMax != null && `≤ $${v.priceMax}`,
    v.totalMax != null && `total ≤ $${v.totalMax}`,
  ];
  return parts.filter(Boolean).join(' · ') || 'Saved search';
}

export interface SavedSearchStats {
  total: number;
  fresh: number; // matches first seen since lastViewedAt
}

/** Counts for each saved search; hidden lots and regex-filtered lots never count. */
export function savedSearchStats(
  lots: Iterable<Lot>,
  searches: SavedSearch[],
  pickup: string,
  ex: Exclusions,
  now: number,
): Map<string, SavedSearchStats> {
  const matchers = searches.map((s) => ({ s, matches: makeMatcher(normalizeView(s.view), now), stats: { total: 0, fresh: 0 } }));
  for (const lot of lots) {
    if (lot.endsAt <= now) {
      continue;
    }
    const row = makeRow(lot, pickup, ex);
    if (row.hidden || row.matched) {
      continue;
    }
    for (const { s, matches, stats } of matchers) {
      if (matches(row)) {
        stats.total++;
        if ((lot.firstSeenAt ?? 0) > s.lastViewedAt) {
          stats.fresh++;
        }
      }
    }
  }
  return new Map(matchers.map(({ s, stats }) => [s.id, stats]));
}
