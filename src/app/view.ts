// Catalog view: filters and sorting applied locally to the cached catalog.
import { buildRegexes, firstMatch, type CompiledFilter } from '../shared/filters';
import { totalCost } from '../shared/cost';
import { collator, sortKey } from '../shared/sortKey';
import type { HiddenLot } from '../shared/keys';
import type { Lot } from './types';

export const SORTS = {
  'ending-soonest': 'Ending soonest',
  'newly-listed': 'Newly listed',
  'title-asc': 'Title A–Z',
  'title-desc': 'Title Z–A',
  'total-asc': 'Total cost: low to high',
  'total-desc': 'Total cost: high to low',
  'retail-pct-asc': 'Best deal (% of retail)',
  'retail-desc': 'Retail price: high to low',
  'bids-most': 'Most bids',
  'bids-fewest': 'Fewest bids',
} as const;
export type SortId = keyof typeof SORTS;

export const ENDING = {
  '': 'Any time',
  '1h': 'Within 1 hour',
  '3h': 'Within 3 hours',
  today: 'Today',
  tomorrow: 'Tomorrow',
} as const;
export type EndingId = keyof typeof ENDING;

export const MINE = {
  '': 'All lots',
  bid: 'Lots I bid on',
  leading: 'I’m winning',
  outbid: 'I’m outbid',
  watch: 'Watchlist',
} as const;
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
}

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
};

export function normalizeView(v: unknown): ViewState {
  const o = v && typeof v === 'object' ? (v as Partial<ViewState>) : {};
  const view = { ...DEFAULT_VIEW, ...o };
  if (!(view.sort in SORTS)) view.sort = DEFAULT_VIEW.sort;
  if (!(view.ending in ENDING)) view.ending = '';
  if (!(view.mine in MINE)) view.mine = '';
  return view;
}

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
  ].filter(Boolean).length;

/** A lot with everything the grid needs computed once. */
export interface Row {
  lot: Lot;
  transferFee: number; // fee to get it to my pickup location (0 if already there)
  pickupOnly: boolean; // at another location and not transferable
  total: number;
  retailPct: number | null;
  matched: string | null; // regex filter that matched the title
  hidden: boolean;
}

export interface Exclusions {
  words: string[];
  filterOn: boolean;
  removeFiltered: boolean;
  hidden: Record<string, HiddenLot>;
  showHidden: boolean;
}

const sortKeys = new Map<string, string>();
function titleKey(title: string) {
  let k = sortKeys.get(title);
  if (k === undefined) sortKeys.set(title, (k = sortKey(title)));
  return k;
}

let regexCache: { words: string[]; compiled: CompiledFilter[] } | null = null;
function compiledFilters(words: string[]) {
  if (regexCache?.words !== words) regexCache = { words, compiled: buildRegexes(words) };
  return regexCache.compiled;
}

export function makeRow(lot: Lot, pickup: string, ex: Exclusions): Row {
  const elsewhere = !!lot.location && lot.location.name !== pickup;
  const transferFee = elsewhere && lot.isTransferable ? lot.transferFee : 0;
  return {
    lot,
    transferFee,
    pickupOnly: elsewhere && !lot.isTransferable,
    total: totalCost(lot.currentPrice, transferFee),
    retailPct: lot.estimatedRetailPrice ? lot.currentPrice / lot.estimatedRetailPrice : null,
    matched: ex.filterOn ? firstMatch(compiledFilters(ex.words), lot.title) : null,
    hidden: !!ex.hidden[lot.id],
  };
}

function endingWindow(e: EndingId, now: number): [number, number] | null {
  if (!e) return null;
  if (e === '1h') return [now, now + 3600_000];
  if (e === '3h') return [now, now + 3 * 3600_000];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (e === 'tomorrow') d.setDate(d.getDate() + 1);
  const start = d.getTime();
  d.setDate(d.getDate() + 1);
  return [Math.max(start, now), d.getTime()];
}

export interface ViewResult {
  rows: Row[]; // after all filters, sorted
  open: number; // lots still open
  removed: number; // open lots dropped by hide / remove-filtered
  filteredOut: number; // open lots dropped by the view's own filters
  matchCounts: Map<string, number>; // open lots each regex filter matches
}

export function computeView(lots: Iterable<Lot>, view: ViewState, pickup: string, ex: Exclusions, now: number): ViewResult {
  const terms = view.search.toLowerCase().split(/\s+/).filter(Boolean);
  const win = endingWindow(view.ending, now);
  const cats = new Set(view.categories);
  const conds = new Set(view.conditions);
  const locs = new Set(view.locations);
  const matchCounts = new Map<string, number>(ex.words.map((w) => [w, 0]));
  const compiled = compiledFilters(ex.words);

  const rows: Row[] = [];
  let open = 0;
  let removed = 0;
  let filteredOut = 0;
  for (const lot of lots) {
    if (lot.endsAt <= now) continue;
    open++;
    for (const { word, re } of compiled) if (re && re.test(lot.title)) matchCounts.set(word, (matchCounts.get(word) || 0) + 1);

    const row = makeRow(lot, pickup, ex);
    if ((row.hidden && !ex.showHidden) || (row.matched && ex.removeFiltered)) {
      removed++;
      continue;
    }
    if (!passes(row, view, terms, win, cats, conds, locs)) {
      filteredOut++;
      continue;
    }
    rows.push(row);
  }
  rows.sort(comparator(view.sort));
  return { rows, open, removed, filteredOut, matchCounts };
}

function passes(
  { lot, total, pickupOnly }: Row,
  v: ViewState,
  terms: string[],
  win: [number, number] | null,
  cats: Set<string>,
  conds: Set<number>,
  locs: Set<string>,
): boolean {
  if (terms.length) {
    const hay = `${lot.title} ${lot.lotNumber}`.toLowerCase();
    if (!terms.every((t) => hay.includes(t))) return false;
  }
  if (cats.size && !cats.has(lot.category?.value ?? '')) return false;
  if (conds.size && !conds.has(lot.condition?.value ?? -1)) return false;
  if (locs.size && !locs.has(lot.location?.name ?? '')) return false;
  if (v.reachable && pickupOnly) return false;
  if (v.priceMin != null && lot.currentPrice < v.priceMin) return false;
  if (v.priceMax != null && lot.currentPrice > v.priceMax) return false;
  if (v.totalMax != null && total > v.totalMax) return false;
  if (v.retailMin != null && (lot.estimatedRetailPrice ?? 0) < v.retailMin) return false;
  if (win && (lot.endsAt < win[0] || lot.endsAt >= win[1])) return false;
  switch (v.mine) {
    case 'bid':
      if (!lot.hasBid && !lot.yourStanding) return false;
      break;
    case 'leading':
      if (!lot.yourStanding?.isLeading) return false;
      break;
    case 'outbid':
      if (!(lot.hasBid || lot.yourStanding) || lot.yourStanding?.isLeading) return false;
      break;
    case 'watch':
      if (!lot.isWatchlisted) return false;
      break;
  }
  return true;
}

function comparator(sort: SortId): (a: Row, b: Row) => number {
  const tie = (a: Row, b: Row) => a.lot.endsAt - b.lot.endsAt || a.lot.id - b.lot.id;
  const by = (f: (a: Row, b: Row) => number) => (a: Row, b: Row) => f(a, b) || tie(a, b);
  switch (sort) {
    case 'newly-listed':
      return (a, b) => b.lot.id - a.lot.id;
    case 'title-asc':
      return by((a, b) => collator.compare(titleKey(a.lot.title), titleKey(b.lot.title)));
    case 'title-desc':
      return by((a, b) => collator.compare(titleKey(b.lot.title), titleKey(a.lot.title)));
    case 'total-asc':
      return by((a, b) => a.total - b.total);
    case 'total-desc':
      return by((a, b) => b.total - a.total);
    case 'retail-pct-asc':
      return by((a, b) => (a.retailPct ?? Infinity) - (b.retailPct ?? Infinity));
    case 'retail-desc':
      return by((a, b) => (b.lot.estimatedRetailPrice ?? -1) - (a.lot.estimatedRetailPrice ?? -1));
    case 'bids-most':
      return by((a, b) => b.lot.bidCount - a.lot.bidCount);
    case 'bids-fewest':
      return by((a, b) => a.lot.bidCount - b.lot.bidCount);
    default:
      return tie;
  }
}

export interface Facets {
  categories: { value: string; label: string; count: number }[];
  conditions: { value: number; label: string; count: number }[];
  locations: { name: string; count: number }[];
}

export function computeFacets(lots: Iterable<Lot>, now: number): Facets {
  const cats = new Map<string, { value: string; label: string; count: number }>();
  const conds = new Map<number, { value: number; label: string; count: number }>();
  const locs = new Map<string, { name: string; count: number }>();
  for (const l of lots) {
    if (l.endsAt <= now) continue;
    if (l.category) {
      const c = cats.get(l.category.value) ?? cats.set(l.category.value, { ...l.category, count: 0 }).get(l.category.value)!;
      c.count++;
    }
    if (l.condition) {
      const c = conds.get(l.condition.value) ?? conds.set(l.condition.value, { ...l.condition, count: 0 }).get(l.condition.value)!;
      c.count++;
    }
    if (l.location) {
      const c = locs.get(l.location.name) ?? locs.set(l.location.name, { name: l.location.name, count: 0 }).get(l.location.name)!;
      c.count++;
    }
  }
  return {
    categories: [...cats.values()].sort((a, b) => a.label.localeCompare(b.label)),
    conditions: [...conds.values()].sort((a, b) => a.value - b.value),
    locations: [...locs.values()].sort((a, b) => b.count - a.count),
  };
}
