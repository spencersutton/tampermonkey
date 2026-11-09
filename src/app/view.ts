// Catalog view: filters and sorting applied locally to the cached catalog.
import { buildRegexes } from '../shared/filters';
import { totalCost } from '../shared/cost';
import { brandModelKey, groupItems, itemIdentity, type ItemDetails } from '../shared/names';
import { collator, sortKey } from '../shared/sortKey';
import { type CustomCategory, type DefaultFilters, type HiddenLot } from '../shared/keys';
import { hasBidOn } from './bid';
import type { Lot } from './types';
import { HOUR } from './util';

/** A lot with everything the grid needs computed once. */
export interface Row {
  lot: Lot;
  category: Lot['category']; // my custom category if one matches the item type, else the site's
  transferFee: number; // fee to get it to my pickup location (0 if already there)
  pickupOnly: boolean; // at another location and not transferable
  total: number;
  retailPct: number | null;
  matched: string | null; // regex filter that matched the title
  hidden: boolean;
  others: Row[]; // listings of the same item folded into this card (cheapest first)
}

type Compare = (a: Row, b: Row) => number;

/** Sort options. Ties always fall back to ending soonest. */
export const SORTS = {
  'ending-soonest': { label: 'Ending soonest', compare: () => 0 },
  'newly-listed': { label: 'Newly listed', compare: (a, b) => b.lot.id - a.lot.id },
  'title-asc': { label: 'Title A–Z', compare: (a, b) => collator.compare(titleKey(a.lot), titleKey(b.lot)) },
  'title-desc': { label: 'Title Z–A', compare: (a, b) => collator.compare(titleKey(b.lot), titleKey(a.lot)) },
  'brand-model-asc': { label: 'Brand + model A–Z', compare: () => 0 },
  'total-asc': { label: 'Total cost: low to high', compare: (a, b) => a.total - b.total },
  'total-desc': { label: 'Total cost: high to low', compare: (a, b) => b.total - a.total },
  'retail-pct-asc': {
    label: 'Best deal (% of retail)', compare: (a, b) => (a.retailPct ?? Infinity) - (b.retailPct ?? Infinity) || (b.lot.estimatedRetailPrice ?? 0) - (a.lot.estimatedRetailPrice ?? 0)
  },
  'retail-desc': { label: 'Retail price: high to low', compare: (a, b) => (b.lot.estimatedRetailPrice ?? -1) - (a.lot.estimatedRetailPrice ?? -1) },
  'bids-most': { label: 'Most bids', compare: (a, b) => b.lot.bidCount - a.lot.bidCount },
  'bids-fewest': { label: 'Fewest bids', compare: (a, b) => a.lot.bidCount - b.lot.bidCount },
} satisfies Record<string, { label: string; compare: Compare }>;
export type SortId = keyof typeof SORTS;

type Window = [start: Temporal.Instant, end: Temporal.Instant];

/** The next `h` hours. */
function nextHours(h: number) {
  return (now: Temporal.Instant): Window => [now, now.add({ milliseconds: h * HOUR })];
}

/** The calendar day `offset` days from today, minus the part already past. */
function day(offset: number) {
  return (now: Temporal.Instant): Window => {
    const today = now.toZonedDateTimeISO(Temporal.Now.timeZoneId()).startOfDay();
    const start = today.add({ days: offset });
    const end = start.add({ days: 1 }).toInstant();
    const startInstant = start.toInstant();
    return [Temporal.Instant.compare(startInstant, now) < 0 ? now : startInstant, end];
  };
}

/** "Ending" filter options, with the closing-time window each allows. */
export const ENDING = {
  '': { label: 'Any time', window: null },
  '1h': { label: 'Within 1 hour', window: nextHours(1) },
  '3h': { label: 'Within 3 hours', window: nextHours(3) },
  today: { label: 'Today', window: day(0) },
  tomorrow: { label: 'Tomorrow', window: day(1) },
} satisfies Record<string, { label: string; window: ((now: Temporal.Instant) => Window) | null }>;
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
  searchRegex: boolean; // the search box holds a case-insensitive regex rather than words
  categories: string[];
  noCategories: boolean; // explicitly match none; an empty categories list otherwise means all
  conditions: number[];
  locations: string[];
  reachable: boolean; // only lots available at my pickup location (there already, or transferable)
  priceMin: number | null;
  priceMax: number | null;
  totalMax: number | null;
  retailMin: number | null;
  ending: EndingId;
  mine: MineId;
  newSince: Temporal.Instant | null; // only lots first seen after this time (not saved with searches)
}

/** View with no filters, sorted by ending soonest. */
export const DEFAULT_VIEW: ViewState = {
  sort: 'ending-soonest',
  search: '',
  searchRegex: false,
  categories: [],
  noCategories: false,
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
  const rawNewSince: unknown = view.newSince;
  return {
    ...view,
    noCategories: !view.categories.length && view.noCategories === true,
    newSince: typeof rawNewSince === 'string' ? Temporal.Instant.from(rawNewSince)
      : rawNewSince instanceof Temporal.Instant ? rawNewSince : null,
    sort: Object.hasOwn(SORTS, view.sort) ? view.sort : DEFAULT_VIEW.sort,
    ending: Object.hasOwn(ENDING, view.ending) ? view.ending : DEFAULT_VIEW.ending,
    mine: Object.hasOwn(MINE, view.mine) ? view.mine : DEFAULT_VIEW.mine,
  };
}

/** Reset all filters to the saved defaults while preserving the current sort. */
export function defaultFilterView(defaults: DefaultFilters, sort: SortId = DEFAULT_VIEW.sort): ViewState {
  return { ...DEFAULT_VIEW, sort, categories: [...defaults.categories], noCategories: !defaults.categories.length && defaults.noCategories === true, conditions: [...defaults.conditions] };
}

/** Use saved defaults only when the browser has no view of its own. */
export function initialView(stored: unknown, defaults: DefaultFilters): ViewState {
  return stored == null ? defaultFilterView(defaults) : normalizeView(stored);
}

/** Compare category and condition selections without depending on their order. */
export function sameDefaultFilters(view: DefaultFilters, defaults: DefaultFilters): boolean {
  const same = <T>(a: T[], b: T[]) => a.length === b.length && a.every((v) => b.includes(v));
  return !!view.noCategories === !!defaults.noCategories && same(view.categories, defaults.categories) && same(view.conditions, defaults.conditions);
}

/** How many filters the view has turned on (shown on the "Clear" button). */
export const activeFilterCount = (v: ViewState) =>
  [
    v.search.trim(),
    v.categories.length || v.noCategories,
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
  nameMatch: number; // how alike titles must be to combine listings (% of words in common; see shared/names.ts)
}

/** Memoized sortKey() results by item type and title. */
const sortKeys = new Map<string, string>();
// Debugging: `tlxSortKeys` in the dev console shows what each title sorts on.
Object.assign(globalThis, { tlxSortKeys: sortKeys });

/** sortKey() for a lot, cached. */
function titleKey(lot: Lot) {
  const id = `${lot.itemType ?? ''}\u0000${lot.title}`;
  let key = sortKeys.get(id);
  if (key === undefined) {
    key = sortKey(lot.title, lot.itemType);
    sortKeys.set(id, key);
  }
  return key;
}

/** `fn`, recomputed only when its argument changes (by identity), e.g. to compile a settings list once. */
function memoLast<A, R>(fn: (arg: A) => R): (arg: A) => R {
  let last: { arg: A; result: R } | null = null;
  return (arg) => (last?.arg === arg ? last : (last = { arg, result: fn(arg) })).result;
}

/**
 * The filter words whose regex matches a title (in filter order), cached by
 * title until the filter words change, so view changes don't re-run every
 * regex on every lot.
 */
const titleMatcher = memoLast((words: string[]) => {
  const compiled = buildRegexes(words);
  const byTitle = new Map<string, string[]>();
  return (title: string) => {
    let matched = byTitle.get(title);
    if (matched === undefined) {
      matched = compiled.filter(({ re }) => re?.test(title)).map(({ word }) => word);
      byTitle.set(title, matched);
    }
    return matched;
  };
});

/** Prefix that keeps custom category values apart from the site's. */
const CUSTOM_PREFIX = 'custom:';

/** Filter value of a custom category. */
export const customCategoryValue = (name: string) => CUSTOM_PREFIX + name;

/** Whether a category value is one of my custom categories. */
export const isCustomCategory = (value: string) => value.startsWith(CUSTOM_PREFIX);

export interface CompiledCategories {
  byType: Map<string, number>; // item type -> original index of the alphabetically first matching category
}

/** Compare category names in the same order used for display and matching. */
export function compareCategoryNames(a: string, b: string): number {
  const left = a.trim();
  const right = b.trim();
  return collator.compare(left, right) || (left < right ? -1 : left > right ? 1 : 0);
}

/** Custom categories ready for categoryIndex(). */
export function compileCategories(cats: CustomCategory[]): CompiledCategories {
  const byType = new Map<string, number>();
  const ordered = cats.map((category, index) => ({ category, index })).sort((a, b) => compareCategoryNames(a.category.name, b.category.name));
  for (const { category: c, index: i } of ordered) {
    for (const t of c.types ?? []) {
      if (!byType.has(t)) {
        byType.set(t, i);
      }
    }
  }
  return { byType };
}

/**
 * Index of the lot's custom category, or -1 for none. The alphabetically
 * first category listing the lot's item type wins.
 */
export function categoryIndex(lot: Lot, { byType }: CompiledCategories): number {
  const t = lot.itemType;
  return t != null ? (byType.get(t) ?? -1) : -1;
}

const compiledCategories = memoLast(compileCategories);

/** The lot's category: its custom category (see categoryIndex) if any, else the site's. */
export function categoryOf(lot: Lot, cats: CustomCategory[]): Lot['category'] {
  const c = cats[categoryIndex(lot, compiledCategories(cats))];
  return c ? { value: customCategoryValue(c.name), label: c.name } : lot.category;
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
    retailPct: lot.estimatedRetailPrice ? Math.round((lot.currentPrice / lot.estimatedRetailPrice) * 100) / 100 : null,
    matched: ex.filterOn ? (titleMatcher(ex.words)(lot.title)[0] ?? null) : null,
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
export function computeView(lots: Iterable<Lot>, view: ViewState, pickup: string, ex: Exclusions, now: Temporal.Instant, details?: ItemDetails): ViewResult {
  const matches = makeMatcher(view, now, details);
  const matchCounts = new Map(ex.words.map((w) => [w, 0]));
  const titleMatches = titleMatcher(ex.words);

  const rows: Row[] = [];
  let open = 0;
  let removed = 0;
  let filteredOut = 0;
  for (const lot of lots) {
    if (Temporal.Instant.compare(lot.endsAt, now) <= 0) {
      continue;
    }
    open++;
    for (const word of titleMatches(lot.title)) {
      matchCounts.set(word, matchCounts.get(word)! + 1);
    }
    const row = makeRow(lot, pickup, ex);
    // My lots views show every lot of mine, hidden or regex-filtered included.
    if (!view.mine && ((row.hidden && !ex.showHidden) || (row.matched && ex.removeFiltered))) {
      removed++;
    } else if (!matches(row)) {
      filteredOut++;
    } else {
      rows.push(row);
    }
  }
  const { cards, groups } = combineDuplicates(rows, ex.nameMatch, details);
  const sortIdentity = (lot: Lot) => {
    const identity = itemIdentity(lot, details);
    return brandModelKey(identity)
      ? [identity.brand!.trim().replace(/\s+/g, ' '), identity.model!.trim().replace(/\s+/g, ' ')]
      : [lot.title, ''];
  };
  const compare: Compare = view.sort === 'brand-model-asc'
    ? (a, b) => {
      const left = sortIdentity(a.lot), right = sortIdentity(b.lot);
      return collator.compare(left[0]!, right[0]!) || collator.compare(left[1]!, right[1]!);
    }
    : SORTS[view.sort].compare;
  cards.sort((a, b) => compare(a, b) || Temporal.Instant.compare(a.lot.endsAt, b.lot.endsAt) || a.lot.id - b.lot.id);
  return { rows: cards, open, removed, filteredOut, matchCounts, combined: rows.length - cards.length, groups };
}

/**
 * Cheapest total cost first (so a transfer fee counts against a lot at another
 * location); ties go to the one ending soonest. Lots you can't get to your
 * pickup location come last.
 */
const byCost = (a: Row, b: Row) =>
  +a.pickupOnly - +b.pickupOnly || a.total - b.total || Temporal.Instant.compare(a.lot.endsAt, b.lot.endsAt) || a.lot.id - b.lot.id;

let groupCache: { key: string; groups: Map<number, number> } | undefined;
function itemGroups(rows: Row[], pct: number, details?: ItemDetails): Map<number, number> {
  const items = rows.map(({ lot }) => ({ id: lot.id, ...itemIdentity(lot, details), condition: lot.condition?.value ?? -1 }));
  const key = JSON.stringify([pct, items]);
  if (groupCache?.key !== key) {
    const groups = new Map<number, number>();
    for (const condition of Map.groupBy(items, (item) => item.condition).values()) {
      for (const [id, group] of groupItems(condition, pct)) groups.set(id, group);
    }
    groupCache = { key, groups };
  }
  return groupCache.groups;
}

/**
 * Fold matching items with the same condition, at any location, into one card showing the
 * cheapest by total cost (ties: ending soonest). Lots you've bid on, hidden
 * lots and regex-filtered lots keep their own card.
 */
function combineDuplicates(rows: Row[], pct: number, details?: ItemDetails): { cards: Row[]; groups: Map<number, Row[]> } {
  const ownCard = (row: Row) => hasBidOn(row.lot) || row.hidden || !!row.matched;
  const cards = rows.filter(ownCard);
  const groups = new Map<number, Row[]>();
  const candidates = rows.filter((row) => !ownCard(row));
  const names = itemGroups(candidates, pct, details);
  const buckets = Map.groupBy(candidates, ({ lot }) => names.get(lot.id)!);
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      cards.push(bucket[0]!);
      continue;
    }
    bucket.sort(byCost);
    cards.push({ ...bucket[0]!, others: bucket.slice(1) });
    bucket.forEach((r) => groups.set(r.lot.id, bucket));
  }
  return { cards, groups };
}

/** Predicate for "value is one of the selected", where selecting nothing allows everything. */
function oneOf<T>(selected: T[]): (value: T) => boolean {
  const set = new Set(selected);
  return (value) => !set.size || set.has(value);
}

/** Whether the lot was first seen strictly after the given instant. */
export function firstSeenAfter(lot: Lot, since: Temporal.Instant): boolean {
  return Temporal.Instant.compare(lot.firstSeenAt ?? Temporal.Instant.from('1970-01-01T00:00:00Z'), since) > 0;
}

/** The search box's regex in regex mode, or null when it's blank or invalid. */
export function searchRegexOf(v: ViewState): RegExp | null {
  const pattern = v.search.trim();
  if (!v.searchRegex || !pattern) {
    return null;
  }
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

/** Predicate for the view's own filters (not hide / regex exclusions). */
export function makeMatcher(v: ViewState, now: Temporal.Instant, details?: ItemDetails): (row: Row) => boolean {
  const terms = v.searchRegex ? [] : Array.from(
    v.search.toLowerCase().matchAll(/(?:^|\s+)(?:(brand|model):\s*)?("[^"]*"(?=\s|$)|\S+)/g),
    ([, field, value = '']) => ({ field, value: value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value }),
  );
  // An invalid regex matches nothing, so the mistake is obvious.
  const re = v.searchRegex && v.search.trim() ? (searchRegexOf(v) ?? /$^/) : null;
  const win = ENDING[v.ending].window?.(now);
  const newSince = v.newSince;
  const category = oneOf(v.categories);
  const condition = oneOf(v.conditions);
  const location = oneOf(v.locations);
  const mine: (lot: Lot) => boolean = MINE[v.mine].test;
  const searchMatches = (lot: Lot) => {
    const identity = itemIdentity(lot, details);
    const brand = identity.brand ?? '';
    const model = identity.model ?? '';
    const hay = [`${lot.title} ${lot.lotNumber}`, brand, model].filter(Boolean).join(' ');
    if (re) return re.test(hay);
    return terms.every(({ field, value }) =>
      !!value && (field === 'brand' ? brand : field === 'model' ? model : hay).toLowerCase().includes(value),
    );
  };
  return ({ lot, category: cat, total, pickupOnly }) =>
    !v.noCategories &&
    (newSince == null || firstSeenAfter(lot, newSince)) &&
    ((!terms.length && !re) || searchMatches(lot)) &&
    category(cat?.value ?? '') &&
    condition(lot.condition?.value ?? -1) &&
    location(lot.location?.name ?? '') &&
    !(v.reachable && pickupOnly) &&
    (v.priceMin == null || lot.currentPrice >= v.priceMin) &&
    (v.priceMax == null || lot.currentPrice <= v.priceMax) &&
    (v.totalMax == null || total <= v.totalMax) &&
    (v.retailMin == null || (lot.estimatedRetailPrice ?? 0) >= v.retailMin) &&
    (!win || (Temporal.Instant.compare(lot.endsAt, win[0]) >= 0 && Temporal.Instant.compare(lot.endsAt, win[1]) < 0)) &&
    mine(lot);
}

export interface Facet<T> {
  value: T;
  label: string;
  count: number;
}

export interface Facets {
  categories: Facet<string>[];
  siteCategories: Facet<string>[]; // the site's own categories, before custom ones take lots out
  conditions: Facet<number>[];
  locations: Facet<string>[];
}

/** Distinct values with how often each occurs (the first label seen wins). */
function tally<T>(items: ({ value: T; label: string } | null)[]): Facet<T>[] {
  const groups = Map.groupBy(
    items.filter((i) => i != null),
    (i) => i.value,
  );
  return Array.from(groups.values(), (g) => ({ value: g[0]!.value, label: g[0]!.label, count: g.length }));
}

/** Categories (custom ones included), conditions and locations among open lots, with counts, for the filter lists. */
export function computeFacets(lots: Iterable<Lot>, now: Temporal.Instant, customCategories: CustomCategory[]): Facets {
  const open = Array.from(lots).filter((l) => Temporal.Instant.compare(l.endsAt, now) > 0);
  const categories = tally(open.map((l) => categoryOf(l, customCategories)));
  // Keep custom parents visible when all their open lots moved into descendants.
  for (const c of customCategories) {
    const value = customCategoryValue(c.name);
    if (!categories.some((f) => f.value === value) && categories.some((f) => isCustomCategory(f.value) && f.label.startsWith(c.name + ' - '))) {
      categories.push({ value, label: c.name, count: 0 });
    }
  }
  return {
    categories: categories.sort((a, b) => a.label.localeCompare(b.label)),
    siteCategories: tally(open.map((l) => l.category)),
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
  lastViewedAt: Temporal.Instant; // lots first seen after this count as new
}

/** The parts of a view that a saved search stores. */
export const savedFilters = ({ newSince: _newSince, ...rest }: ViewState): Omit<ViewState, 'newSince'> => rest;

/** Same filters (ignoring sort and the "new only" toggle)? */
export function sameFilters(a: ViewState, b: Omit<ViewState, 'newSince'>): boolean {
  const strip = ({ sort: _sort, ...rest }: Omit<ViewState, 'newSince'>) => rest;
  return JSON.stringify(strip(savedFilters(a))) === JSON.stringify(strip(savedFilters(normalizeView(b))));
}

/** Default name for a new saved search, built from its filters. */
export function suggestName(v: ViewState, facets: Facets): string {
  const parts = [
    v.search.trim(),
    v.noCategories && 'No categories',
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
  now: Temporal.Instant,
  details?: ItemDetails,
): Map<string, SavedSearchStats> {
  const matchers = searches.map((s) => ({
    s,
    since: s.lastViewedAt,
    matches: makeMatcher(normalizeView(s.view), now, details),
    stats: { total: 0, fresh: 0 },
  }));
  for (const lot of lots) {
    if (Temporal.Instant.compare(lot.endsAt, now) <= 0) {
      continue;
    }
    const row = makeRow(lot, pickup, ex);
    if (row.hidden || row.matched) {
      continue;
    }
    for (const { since, matches, stats } of matchers) {
      if (matches(row)) {
        stats.total++;
        if (firstSeenAfter(lot, since)) {
          stats.fresh++;
        }
      }
    }
  }
  return new Map(matchers.map(({ s, stats }) => [s.id, stats]));
}
