import { dequal } from 'dequal';

import {
  attrKey,
  compareAttrValues,
  extractAttrs,
  parseAttrKey,
  type Attrs,
} from '../../shared/attrs';
import { HOUR } from '../../shared/constants';
import { totalCost } from '../../shared/cost';
// Catalog view: filters and sorting applied locally to the cached catalog.
import { buildRegexes, filterMatches } from '../../shared/filters';
import { endsAtMs } from '../../shared/lot';
import { itemIdentity, type ItemDetails } from '../../shared/names';
import {
  buildVocabulary,
  compileQuery,
  correctQuery,
  prepareDoc,
  type PreparedDoc,
} from '../../shared/search';
import { collator } from '../../shared/sortKey';
import type { Lot } from '../types';
import { hasBidOn } from './bid';
import { memoize, memoizeWeak, memoLast } from './util';
import '../../shared/arrayToSet';

/** A lot with everything the grid needs computed once. */
export interface Row {
  lot: Lot;
  category: Lot['category']; // my custom category if one matches the item type, else the site's
  transferFee: number; // fee to get it to my pickup location (0 if already there)
  pickupOnly: boolean; // at another location and not transferable
  total: number;
  retailPct: number | null;
  matched: string | null; // regex filter that matched the title
  others: Row[]; // listings of the same item folded into this card (best condition, then cheapest, first)
  cheaper: Row | null; // the cheapest of `others` in a worse condition that costs less than this lot
  score: number; // search relevance (0 without a search)
}

type Compare = (a: Row, b: Row) => number;

/** Per-page-load random key per lot, so the random order stays put until the page refreshes. */
const randomKeys = new Map<number, number>();
const randomKey = (id: number) => {
  let k = randomKeys.get(id);
  if (k === undefined) {
    k = Math.random();
    randomKeys.set(id, k);
  }
  return k;
};

/** Sort options. Ties always fall back to ending soonest. */
export const SORTS = {
  relevance: { label: 'Best match', compare: (a, b) => b.score - a.score },
  'ending-soonest': { label: 'Ending soonest', compare: () => 0 },
  'newly-listed': { label: 'Newly listed', compare: (a, b) => b.lot.id - a.lot.id },
  'title-asc': {
    label: 'Title A–Z',
    compare: (a, b) => collator.compare(titleKey(a.lot), titleKey(b.lot)),
  },
  'title-desc': {
    label: 'Title Z–A',
    compare: (a, b) => collator.compare(titleKey(b.lot), titleKey(a.lot)),
  },
  'item-type-asc': {
    label: 'Item type A–Z',
    compare: (a, b) =>
      +!a.lot.itemType - +!b.lot.itemType ||
      collator.compare(a.lot.itemType ?? '', b.lot.itemType ?? ''),
  },
  'brand-model-asc': { label: 'Brand + model A–Z', compare: () => 0 },
  'total-asc': { label: 'Total cost: low to high', compare: (a, b) => a.total - b.total },
  'total-desc': { label: 'Total cost: high to low', compare: (a, b) => b.total - a.total },
  'retail-pct-asc': {
    label: 'Best deal (% of retail)',
    compare: (a, b) =>
      (a.retailPct ?? Infinity) - (b.retailPct ?? Infinity) ||
      b.lot.estimated_retail_price - a.lot.estimated_retail_price,
  },
  'retail-desc': {
    label: 'Retail price: high to low',
    compare: (a, b) => b.lot.estimated_retail_price - a.lot.estimated_retail_price,
  },
  random: { label: 'Random', compare: (a, b) => randomKey(a.lot.id) - randomKey(b.lot.id) },
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
    // Temporal handles DST-length days and the local time zone.
    const start = Temporal.Instant.fromEpochMilliseconds(now)
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .startOfDay()
      .add({ days: offset });
    const end = start.add({ days: 1 });
    return [Math.max(now, start.epochMilliseconds), end.epochMilliseconds];
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
  leading: { label: 'I’m winning', test: l => Boolean(l.your_standing?.is_leading) },
  outbid: { label: 'I’m outbid', test: l => hasBidOn(l) && !l.your_standing?.is_leading },
  watch: { label: 'Watchlist', test: l => l.is_watchlisted && !hasBidOn(l) },
} satisfies Record<string, { label: string; test: (lot: Lot) => boolean }>;
export type MineId = keyof typeof MINE;

export interface ViewState {
  sort: SortId;
  search: string;
  searchRegex: boolean; // the search box holds a case-insensitive regex rather than words
  categories: string[];
  types: string[]; // item types (lowercase)
  excludedTypes: string[]; // item types to exclude (lowercase)
  brands: string[]; // brand keys (see brandKey)
  attrs: string[]; // attribute keys (e.g. "hose length:50 ft", lowercase)
  conditions: number[];
  locations: string[];
  reachable: boolean; // only lots available at my pickup location (there already, or transferable)
  priceMin: number | null;
  priceMax: number | null;
  totalMax: number | null;
  retailMin: number | null;
  ending: EndingId;
  mine: MineId;
  newSince: number | null; // epoch ms; only lots first seen after this time (not saved with searches)
}

/** View with no filters, sorted by ending soonest. */
export const DEFAULT_VIEW: ViewState = {
  sort: 'relevance',
  search: '',
  searchRegex: false,
  categories: [],
  types: [],
  excludedTypes: [],
  brands: [],
  attrs: [],
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
  const view = {
    ...DEFAULT_VIEW,
    ...(v && typeof v === 'object' ? (v as Partial<ViewState>) : {}),
  };
  const strings = (a: unknown): string[] =>
    Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  return {
    ...view,
    types: strings(view.types),
    brands: strings(view.brands),
    attrs: strings(view.attrs)
      .map(s => s.toLowerCase())
      .filter(s => parseAttrKey(s) != null)
      .toUnique(),
    newSince: typeof view.newSince === 'number' ? view.newSince : null,
    sort: Object.hasOwn(SORTS, view.sort) ? view.sort : DEFAULT_VIEW.sort,
    ending: Object.hasOwn(ENDING, view.ending) ? view.ending : DEFAULT_VIEW.ending,
    mine: Object.hasOwn(MINE, view.mine) ? view.mine : DEFAULT_VIEW.mine,
  };
}

/** Use saved defaults only when the browser has no view of its own. */
export function initialView(stored: unknown): ViewState {
  return normalizeView(stored);
}

/** How many filters the view has turned on (shown on the "Clear" button). */
export const activeFilterCount = (v: ViewState) =>
  [
    v.search.trim(),
    v.categories.length,
    v.types.length,
    v.excludedTypes.length,
    v.brands.length,
    v.attrs.length,
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
}

const titleKey = memoizeWeak((lot: Lot) => `${lot.itemType ?? ''}\u0000${lot.title}`);
const lotAttrs = memoizeWeak((lot: Lot): Attrs => extractAttrs(lot.title));

/**
 * The filter words whose regex matches a lot's title (in filter order), cached by title until the
 * filter words change, so view changes don't re-run every regex on every lot.
 */
const lotMatcher = memoLast((words: string[]) => {
  const compiled = buildRegexes(words);
  const byTitle = memoize((title: string) =>
    compiled.filter(f => filterMatches(f, title)).map(({ word }) => word),
  );
  return (lot: Lot) => byTitle(lot.title);
});

/**
 * Build the grid row for a lot: pickup/transfer cost, total, % of retail, filter match and hidden
 * state.
 */
export function makeRow(lot: Lot, pickup: string, ex: Exclusions): Row {
  const elsewhere = lot.location.name !== pickup;
  const transferFee = elsewhere && lot.is_transferable ? lot.transfer_fee : 0;
  return {
    lot,
    category: lot.category,
    transferFee,
    pickupOnly: elsewhere && !lot.is_transferable,
    total: totalCost(lot.current_price, transferFee),
    retailPct: lot.estimated_retail_price
      ? Math.round((lot.current_price / lot.estimated_retail_price) * 100) / 100
      : null,
    matched: ex.filterOn ? (lotMatcher(ex.words)(lot)[0] ?? null) : null,
    others: [],
    cheaper: null,
    score: 0,
  };
}

/** Brand facet key: case and spacing ignored, so "DEWALT" and "DeWalt " are one brand. */
const brandKey = (brand: string) => brand.trim().replace(/\s+/g, ' ').toLowerCase();

/** Quick price ranges for the current bid (both ends inclusive; null = open-ended). */
export const PRICE_BUCKETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Under $10', min: null, max: 10 },
  { label: '$10 – $25', min: 10, max: 25 },
  { label: '$25 – $50', min: 25, max: 50 },
  { label: '$50 – $100', min: 50, max: 100 },
  { label: '$100 – $250', min: 100, max: 250 },
  { label: '$250 & up', min: 250, max: null },
];

const inBucket = (price: number, b: (typeof PRICE_BUCKETS)[number]) =>
  (b.min == null || price >= b.min) && (b.max == null || price <= b.max);

/**
 * Facet dimensions whose counts ignore their own selection (so you can pick several). Each
 * attribute group is one: `attr:hose length`, `attr:size`, etc.
 */
type Dim = 'category' | 'condition' | 'location' | 'type' | 'brand' | 'price' | `attr:${string}`;

/** Lot counts per facet value among the results, each ignoring its own facet's filter. */
export interface FacetCounts {
  total: number; // matching lots (ignoring no dimensions)
  category: Map<string, number>;
  condition: Map<number, number>;
  location: Map<string, number>;
  type: Map<string, number>;
  brand: Map<string, number>;
  price: number[]; // per PRICE_BUCKETS entry
  attr: Map<string, Map<string, { label: string; count: number }>>; // group key -> attrKey -> count
  attrLabels: Map<string, string>; // group key -> display label (e.g. "hose length" -> "Hose length")
  attrLots: Map<string, number>; // group key -> matching lots having this attribute
}

const emptyCounts = (): FacetCounts => ({
  total: 0,
  category: new Map(),
  condition: new Map(),
  location: new Map(),
  type: new Map(),
  brand: new Map(),
  price: PRICE_BUCKETS.map(() => 0),
  attr: new Map(),
  attrLabels: new Map(),
  attrLots: new Map(),
});

const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);

/** The lot's brand, from the newest detail cache when there is one. */
function brandOf(lot: Lot, details?: ItemDetails): string | null {
  const brand = itemIdentity(lot, details).brand?.trim();
  return brand || null;
}

function tallyAttrGroup(counts: FacetCounts, groupKey: string, label: string, values: string[]) {
  counts.attrLabels.set(groupKey, label);
  bump(counts.attrLots, groupKey);
  const group = counts.attr.getOrInsertComputed(groupKey, () => new Map());
  for (const val of values) {
    const key = attrKey(label, val);
    const cur = group.get(key);
    if (cur) {
      cur.count++;
    } else {
      group.set(key, { label: val, count: 1 });
    }
  }
}

function tallyRow(counts: FacetCounts, row: Row, only: Dim | null, details?: ItemDetails) {
  const { lot } = row;
  if (only == null) {
    counts.total++;
  }
  if (only == null || only === 'category') {
    bump(counts.category, row.category.value);
  }
  if (only == null || only === 'condition') {
    bump(counts.condition, lot.condition.value);
  }
  if (only == null || only === 'location') {
    bump(counts.location, lot.location.name);
  }
  if ((only == null || only === 'type') && lot.itemType) {
    bump(counts.type, lot.itemType);
  }
  if (only == null || only === 'brand') {
    const brand = brandOf(lot, details);
    if (brand) {
      bump(counts.brand, brandKey(brand));
    }
  }
  if (only == null || only === 'price') {
    PRICE_BUCKETS.forEach((b, i) => {
      if (inBucket(lot.current_price, b)) {
        counts.price[i]!++;
      }
    });
  }
  if (only == null) {
    for (const [label, values] of Object.entries(lotAttrs(lot))) {
      tallyAttrGroup(counts, label.toLowerCase(), label, values);
    }
  } else if (only.startsWith('attr:')) {
    const target = only.slice(5);
    for (const [label, values] of Object.entries(lotAttrs(lot))) {
      if (label.toLowerCase() === target) {
        tallyAttrGroup(counts, target, label, values);
      }
    }
  }
}

export interface ViewResult {
  rows: Row[]; // after all filters, sorted
  open: number; // lots still open
  removed: number; // open lots dropped by hide / remove-filtered
  filteredOut: number; // open lots dropped by the view's own filters
  matchCounts: Map<string, number>; // open lots each regex filter matches
  combined: number; // listings folded into another card as duplicates
  groups: Map<number, Row[]>; // lot id -> every listing in its group (cheapest first)
  facetCounts: FacetCounts;
  correctedSearch: string | null; // the search actually run when the typed one matched nothing
}

/** Filter, combine and sort the catalog for the grid, with counts for the status line and sidebar. */
export function computeView(
  lots: Iterable<Lot>,
  view: ViewState,
  pickup: string,
  ex: Exclusions,
  now: number,
  details?: ItemDetails,
  filteredOnly = false,
): ViewResult {
  const matchCounts = new Map(ex.words.map(w => [w, 0]));
  const lotMatches = lotMatcher(ex.words);
  const rowRules = filteredOnly ? { ...ex, filterOn: true } : ex;

  // Rows that the hide / regex rules leave in, before the view's own filters.
  const candidates: Row[] = [];
  let open = 0;
  let removed = 0;
  for (const lot of lots) {
    if (endsAtMs(lot) <= now) {
      continue;
    }
    open++;
    for (const word of lotMatches(lot)) {
      matchCounts.set(word, matchCounts.get(word)! + 1);
    }
    const row = makeRow(lot, pickup, rowRules);
    if (filteredOnly && !row.matched) {
      continue;
    }
    // My lots views show every lot of mine, regex-filtered included.
    if (!filteredOnly && !view.mine && row.matched && ex.removeFiltered) {
      removed++;
    } else {
      candidates.push(row);
    }
  }

  const run = (v: ViewState) => {
    const p = makePredicates(v, now, details);
    const counts = emptyCounts();
    const rows: Row[] = [];
    for (const row of candidates) {
      const score = p.search(row.lot);
      if (score == null || !p.base(row)) {
        continue;
      }
      let failed: Dim | null = null;
      let nFailed = 0;
      for (const [dim, test] of p.dims) {
        if (!test(row)) {
          failed = dim;
          if (++nFailed > 1) {
            break;
          }
        }
      }
      if (nFailed === 0) {
        rows.push({ ...row, score });
        tallyRow(counts, row, null, details);
      } else if (nFailed === 1) {
        tallyRow(counts, row, failed, details);
      }
    }
    return { rows, counts };
  };

  let correctedSearch: string | null = null;
  let { rows, counts } = run(view);
  if (!rows.length && !view.searchRegex && view.search.trim() && candidates.length) {
    const docs = candidates.map(r => docOf(r.lot, details));
    const fixed = correctQuery(view.search, docs, buildVocabulary(docs));
    if (fixed) {
      const retry = run({ ...view, search: fixed });
      if (retry.rows.length) {
        ({ rows, counts } = retry);
        correctedSearch = fixed;
      }
    }
  }

  const { cards, groups } = combineDuplicates(rows);
  const sortIdentity = (lot: Lot) => {
    const { brand, model } = itemIdentity(lot, details);
    const tidy = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ');
    return tidy(brand) && tidy(model) ? [tidy(brand), tidy(model)] : [lot.title, ''];
  };
  const compare: Compare =
    view.sort === 'brand-model-asc'
      ? (a, b) => {
          const left = sortIdentity(a.lot),
            right = sortIdentity(b.lot);
          return collator.compare(left[0]!, right[0]!) || collator.compare(left[1]!, right[1]!);
        }
      : SORTS[view.sort].compare;
  cards.sort((a, b) => compare(a, b) || endsAtMs(a.lot) - endsAtMs(b.lot) || a.lot.id - b.lot.id);
  return {
    rows: cards,
    open,
    removed,
    filteredOut: candidates.length - rows.length,
    matchCounts,
    combined: rows.length - cards.length,
    groups,
    facetCounts: counts,
    correctedSearch,
  };
}

/**
 * Cheapest total cost first (so a transfer fee counts against a lot at another location); ties go
 * to the one ending soonest. Lots you can't get to your pickup location come last.
 */
const byCost = (a: Row, b: Row) =>
  +a.pickupOnly - +b.pickupOnly ||
  a.total - b.total ||
  endsAtMs(a.lot) - endsAtMs(b.lot) ||
  a.lot.id - b.lot.id;

const CONDITION_RANK: Record<string, number> = { new: 0, 'like new': 1, used: 2, 'as-is': 3 };

/** How good a lot's condition is: New 0, Like New 1, Used 2, As-is 3; unknown ones last. */
function conditionRank(lot: Lot): number {
  return CONDITION_RANK[lot.condition.display_name.trim().toLowerCase()] ?? 4;
}

/**
 * Best condition first, then cheapest (see byCost). Lots you can't get to your pickup location
 * still come last.
 */
const byConditionThenCost = (a: Row, b: Row) =>
  +a.pickupOnly - +b.pickupOnly || conditionRank(a.lot) - conditionRank(b.lot) || byCost(a, b);

/**
 * Fold the shown lots the server grouped as the same item (at any location; any condition when the
 * brand and model match) into one card showing the best condition, cheapest by total cost within it
 * (ties: ending soonest). The card notes the cheapest listing in a worse condition that costs less.
 * Lots you've bid on, hidden lots and regex-filtered lots keep their own card. The card keeps the
 * best search score in its group.
 */
function combineDuplicates(rows: Row[]): { cards: Row[]; groups: Map<number, Row[]> } {
  const ownCard = (row: Row) => hasBidOn(row.lot) || Boolean(row.matched);
  const cards = rows.filter(ownCard);
  const groups = new Map<number, Row[]>();
  const candidates = rows.filter(row => !ownCard(row));
  const buckets = Map.groupBy(candidates, ({ lot }) => lot.groupId ?? lot.id);
  for (const bucket of buckets.values()) {
    if (bucket.length === 1) {
      cards.push(bucket[0]!);
      continue;
    }
    bucket.sort(byConditionThenCost);
    const lead = bucket[0]!;
    const others = bucket.slice(1);
    const score = Math.max(...bucket.map(r => r.score));
    const cheaper =
      others
        .filter(
          r =>
            conditionRank(r.lot) > conditionRank(lead.lot) &&
            r.total < lead.total &&
            (lead.pickupOnly || !r.pickupOnly),
        )
        .toSorted(byCost)[0] ?? null;
    cards.push({ ...lead, others, cheaper, score });
    bucket.forEach(r => groups.set(r.lot.id, bucket));
  }
  return { cards, groups };
}

/** Predicate for "value is one of the selected", where selecting nothing allows everything. */
function oneOf<T>(selected: T[]): (value: T) => boolean {
  const set = selected.toSet();
  return value => !set.size || set.has(value);
}

/** Whether the lot was first seen strictly after the given instant. */
export function firstSeenAfter(lot: Lot, since: number): boolean {
  return (lot.firstSeenAt ?? 0) > since;
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

/** Prepared search text per lot, reused until the lot or its brand/model changes. */
const docCache = new WeakMap<
  Lot,
  { brand: string | null | undefined; model: string | null | undefined; doc: PreparedDoc }
>();

/** A lot's searchable fields, with brand and model from the newest detail cache. */
function docOf(lot: Lot, details?: ItemDetails): PreparedDoc {
  const { brand, model } = itemIdentity(lot, details);
  const hit = docCache.get(lot);
  if (hit && hit.brand === brand && hit.model === model) {
    return hit.doc;
  }
  const doc = prepareDoc({
    title: lot.title,
    lotNumber: lot.lot_number,
    brand,
    model,
    itemType: lot.itemType,
  });
  docCache.set(lot, { brand, model, doc });
  return doc;
}

/**
 * The view's search as a scorer: a relevance score for a matching lot (0 with no search), or null
 * when it doesn't match.
 */
export function makeSearch(
  v: Pick<ViewState, 'search' | 'searchRegex'>,
  details?: ItemDetails,
): (lot: Lot) => number | null {
  if (v.searchRegex) {
    if (!v.search.trim()) {
      return () => 0;
    }
    // An invalid regex matches nothing, so the mistake is obvious.
    let re: RegExp = /$^/;
    try {
      re = new RegExp(v.search.trim(), 'i');
    } catch {
      // keep the never-matching pattern
    }
    return lot => {
      const { brand, model } = itemIdentity(lot, details);
      const hay = [`${lot.title} ${lot.lot_number}`, brand, model, lot.itemType]
        .filter(Boolean)
        .join(' ');
      return re.test(hay) ? 1 : null;
    };
  }
  const query = compileQuery(v.search);
  if (query.empty) {
    return () => 0;
  }
  return lot => query.score(docOf(lot, details));
}

interface Predicates {
  search: (lot: Lot) => number | null;
  base: (row: Row) => boolean; // every filter that isn't a facet
  dims: [Dim, (row: Row) => boolean][]; // facet filters that are on
}

/** The view's filters split into search, plain filters and facet filters. */
function makePredicates(v: ViewState, now: number, details?: ItemDetails): Predicates {
  const win = ENDING[v.ending].window?.(now);
  const newSince = v.newSince;
  const mine: (lot: Lot) => boolean = MINE[v.mine].test;
  const excludedTypes = v.excludedTypes.toSet();
  const dims: Predicates['dims'] = [];
  if (v.categories.length) {
    const category = oneOf(v.categories);
    dims.push(['category', r => category(r.category.value)]);
  }
  if (v.conditions.length) {
    const condition = oneOf(v.conditions);
    dims.push(['condition', r => condition(r.lot.condition.value)]);
  }
  if (v.locations.length) {
    const location = oneOf(v.locations);
    dims.push(['location', r => location(r.lot.location.name)]);
  }
  if (v.types.length) {
    const types = v.types.toSet();
    dims.push(['type', r => r.lot.itemType != null && types.has(r.lot.itemType)]);
  }
  if (v.brands.length) {
    const brands = v.brands.toSet();
    dims.push([
      'brand',
      r => {
        const b = brandOf(r.lot, details);
        return b != null && brands.has(brandKey(b));
      },
    ]);
  }
  if (v.priceMin != null || v.priceMax != null) {
    dims.push([
      'price',
      r =>
        (v.priceMin == null || r.lot.current_price >= v.priceMin) &&
        (v.priceMax == null || r.lot.current_price <= v.priceMax),
    ]);
  }
  if (v.attrs.length) {
    const byGroup = new Map<string, Set<string>>();
    for (const key of v.attrs) {
      const parsed = parseAttrKey(key);
      if (parsed) {
        byGroup.getOrInsertComputed(parsed.name, () => new Set()).add(key);
      }
    }
    for (const [groupKey, wanted] of byGroup) {
      dims.push([
        `attr:${groupKey}`,
        r => {
          for (const [label, values] of Object.entries(lotAttrs(r.lot))) {
            if (label.toLowerCase() === groupKey) {
              return values.some(val => wanted.has(attrKey(label, val)));
            }
          }
          return false;
        },
      ]);
    }
  }
  return {
    search: makeSearch(v, details),
    dims,
    base: ({ lot, total, pickupOnly }) =>
      (!excludedTypes.size || lot.itemType == null || !excludedTypes.has(lot.itemType)) &&
      (newSince == null || firstSeenAfter(lot, newSince)) &&
      !(v.reachable && pickupOnly) &&
      (v.totalMax == null || total <= v.totalMax) &&
      (v.retailMin == null || lot.estimated_retail_price >= v.retailMin) &&
      (!win || (endsAtMs(lot) >= win[0] && endsAtMs(lot) < win[1])) &&
      mine(lot),
  };
}

/** Predicate for the view's own filters (not hide / regex exclusions). */
export function makeMatcher(
  v: ViewState,
  now: number,
  details?: ItemDetails,
): (row: Row) => boolean {
  const p = makePredicates(v, now, details);
  return row => p.search(row.lot) != null && p.base(row) && p.dims.every(([, test]) => test(row));
}

export interface Facet<T> {
  value: T;
  label: string;
  count: number;
}

export interface AttrFacetGroup {
  key: string; // lowercase attribute name, e.g. "hose length"
  label: string; // display name, e.g. "Hose length"
  facets: Facet<string>[]; // value is attrKey ("hose length:50 ft"), label is "50 ft"
}

export interface Facets {
  categories: Facet<string>[];
  siteCategories: Facet<string>[];
  conditions: Facet<number>[];
  locations: Facet<string>[];
  types: Facet<string>[]; // item types, most lots first
  brands: Facet<string>[]; // by brandKey, labelled with the most common spelling; most lots first
  attrs: AttrFacetGroup[]; // contextual item attributes relevant to the current results
  prices: Facet<number>[]; // index into PRICE_BUCKETS
}

/** Distinct values with how often each occurs (the first label seen wins). */
function tally<T>(items: ({ value: T; label: string } | null)[]): Facet<T>[] {
  const groups = Map.groupBy(
    items.filter(i => i != null),
    i => i.value,
  );
  return Array.from(groups.values(), g => ({
    value: g[0]!.value,
    label: g[0]!.label,
    count: g.length,
  }));
}

const byCountThenLabel = <T>(a: Facet<T>, b: Facet<T>) =>
  b.count - a.count || collator.compare(a.label, b.label);

/** Values grouped by key, each labelled with its most common spelling, most lots first. */
function tallySpellings(values: string[], keyOf: (v: string) => string): Facet<string>[] {
  const spellings = new Map<string, Map<string, number>>();
  for (const v of values) {
    bump(
      spellings.getOrInsertComputed(keyOf(v), () => new Map()),
      v,
    );
  }
  return Array.from(spellings, ([value, m]) => {
    const [label] = m.entries().reduce((best, cur) => (cur[1] > best[1] ? cur : best));
    return { value, label, count: m.values().sum() };
  }).toSorted(byCountThenLabel);
}

/** Brands among lots, labelled with each brand's most common spelling. */
function tallyBrands(brands: (string | null)[]): Facet<string>[] {
  return tallySpellings(
    brands.filter((b): b is string => Boolean(b)).map(b => b.trim().replace(/\s+/g, ' ')),
    brandKey,
  );
}

/**
 * Categories (custom ones included), conditions, locations, item types, brands and price ranges
 * among open lots, with counts, for the filter lists.
 */
export function computeFacets(lots: Iterable<Lot>, now: number, details?: ItemDetails): Facets {
  const open = Array.from(lots).filter(l => endsAtMs(l) > now);
  const categories = tally(open.map(l => l.category));
  return {
    categories: categories.toSorted((a, b) => a.label.localeCompare(b.label)),
    siteCategories: tally(open.map(l => l.category)),
    conditions: tally(
      open.map(l => ({ value: l.condition.value, label: l.condition.display_name })),
    ).sortBy(c => c.value),
    locations: tally(open.map(l => ({ value: l.location.name, label: l.location.name })))
      .sortBy(l => l.count)
      .toReversed(),
    types: tally(
      open.map(l => (l.itemType ? { value: l.itemType, label: l.itemType } : null)),
    ).toSorted(byCountThenLabel),
    brands: tallyBrands(open.map(l => brandOf(l, details))),
    attrs: [],
    prices: PRICE_BUCKETS.map((b, i) => ({
      value: i,
      label: b.label,
      count: open.filter(l => inBucket(l.current_price, b)).length,
    })),
  };
}

/**
 * The filter lists with counts from the current results (each facet ignoring its own selection),
 * like a shop's sidebar. Every category, condition and location stays listed; item types and brands
 * list only those with results, plus any selected.
 */
export function contextualFacets(all: Facets, counts: FacetCounts, view: ViewState): Facets {
  const recount = <T>(facets: Facet<T>[], m: Map<T, number>) =>
    facets.map(f => ({ ...f, count: m.get(f.value) ?? 0 }));
  const present = (facets: Facet<string>[], m: Map<string, number>, selected: string[]) => {
    const known = new Map(facets.map(f => [f.value, f.label]));
    const values = [...m.keys(), ...selected].toSet();
    return Array.from(values, value => ({
      value,
      label: known.get(value) ?? value,
      count: m.get(value) ?? 0,
    })).toSorted(byCountThenLabel);
  };

  // Show contextual attribute facets only when narrowed (search, category, type, brand, or an
  // active attribute) and when an attribute covers >= 25% of matching lots with >= 2 values.
  const selectedByGroup = new Map<string, string[]>();
  for (const key of view.attrs) {
    const parsed = parseAttrKey(key);
    if (parsed) {
      selectedByGroup.getOrInsertComputed(parsed.name, () => []).push(key);
    }
  }
  const narrowed = Boolean(
    view.search.trim() ||
      view.categories.length ||
      view.types.length ||
      view.brands.length ||
      view.attrs.length,
  );
  const groupKeys = [...counts.attr.keys(), ...selectedByGroup.keys()].toSet();
  const attrGroups: (AttrFacetGroup & { selected: boolean; coverage: number })[] = [];
  for (const groupKey of groupKeys) {
    const selected = selectedByGroup.get(groupKey) ?? [];
    const valueMap = counts.attr.get(groupKey);
    const lotCount = counts.attrLots.get(groupKey) ?? 0;
    const distinct = valueMap ? valueMap.size : 0;
    const relevant =
      narrowed &&
      lotCount >= 2 &&
      counts.total > 0 &&
      lotCount / counts.total >= 0.25 &&
      distinct >= 2;
    if (!selected.length && !relevant) {
      continue;
    }
    const label =
      counts.attrLabels.get(groupKey) ??
      groupKey.replace(/\b[a-z]/g, c => c.toUpperCase());
    const keys = [...(valueMap?.keys() ?? []), ...selected].toSet();
    const facets = Array.from(keys, key => {
      const entry = valueMap?.get(key);
      return {
        value: key,
        label: entry?.label ?? parseAttrKey(key)?.value ?? key,
        count: entry?.count ?? 0,
      };
    }).toSorted((a, b) => compareAttrValues(a.label, b.label));
    attrGroups.push({
      key: groupKey,
      label,
      facets,
      selected: selected.length > 0,
      coverage: lotCount,
    });
  }
  attrGroups.sort(
    (a, b) => Number(b.selected) - Number(a.selected) || b.coverage - a.coverage || collator.compare(a.label, b.label),
  );
  const selectedCount = attrGroups.filter(g => g.selected).length;
  const attrs: AttrFacetGroup[] = attrGroups
    .slice(0, Math.max(4, selectedCount))
    .map(({ key, label, facets }) => ({ key, label, facets }));

  return {
    categories: recount(all.categories, counts.category),
    siteCategories: all.siteCategories,
    conditions: recount(all.conditions, counts.condition),
    locations: recount(all.locations, counts.location)
      .sortBy(l => l.count)
      .toReversed(),
    types: present(all.types, counts.type, view.types),
    brands: present(all.brands, counts.brand, view.brands),
    attrs,
    prices: all.prices.map(f => ({ ...f, count: counts.price[f.value] ?? 0 })),
  };
}

// ---------------------------------------------------------------------------
// Saved searches
// ---------------------------------------------------------------------------
export interface SavedSearch {
  id: string;
  name: string;
  view: Omit<ViewState, 'newSince'>;
  lastViewedAt: number; // epoch ms; lots first seen after this count as new
}

/** The parts of a view that a saved search stores. */
export const savedFilters = ({
  newSince: _newSince,
  ...rest
}: ViewState): Omit<ViewState, 'newSince'> => rest;

/** Same filters (ignoring sort and the "new only" toggle)? */
export function sameFilters(a: ViewState, b: Omit<ViewState, 'newSince'>): boolean {
  const strip = ({ sort: _sort, ...rest }: Omit<ViewState, 'newSince'>) => rest;
  return dequal(strip(savedFilters(a)), strip(savedFilters(normalizeView(b))));
}

/** Default name for a new saved search, built from its filters. */
export function suggestName(v: ViewState, facets: Facets): string {
  const parts = [
    v.search.trim(),
    ...v.categories.map(c => facets.categories.find(f => f.value === c)?.label ?? c),
    ...v.types,
    ...v.brands.map(b => facets.brands.find(f => f.value === b)?.label ?? b),
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
  details?: ItemDetails,
): Map<string, SavedSearchStats> {
  const matchers = searches.map(s => ({
    s,
    since: s.lastViewedAt,
    matches: makeMatcher(normalizeView(s.view), now, details),
    stats: { total: 0, fresh: 0 },
  }));
  for (const lot of lots) {
    if (endsAtMs(lot) <= now) {
      continue;
    }
    const row = makeRow(lot, pickup, ex);
    if (row.matched) {
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
