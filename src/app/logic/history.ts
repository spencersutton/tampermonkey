import { DEFAULT_VIEW, normalizeView, type ViewState } from './view';

/** Closed lots you won or lost, as the site's control panel lists them. */
export type ClosedSection = 'won' | 'lost';

/** What a history entry restores. */
export interface NavState {
  view: ViewState;
  page: number;
  openId: number | null;
  closed: ClosedSection | null; // the Won / Lost page shown instead of the grid
  filteredOnly: boolean;
  filteredPattern?: string | null;
}

/**
 * A history entry. `kind` says what made it: 'lot' opened a lot over the list (so closing the lot
 * can just go back), 'search' typed in the search box (so further typing replaces it rather than
 * adding an entry per pause).
 */
export interface HistoryEntry extends NavState {
  tlx: true;
  kind: 'lot' | 'search' | 'other';
  scrollY?: number | undefined;
}

const LISTS = [
  'categories',
  'types',
  'excludedTypes',
  'brands',
  'attrs',
  'conditions',
  'locations',
] as const;
const NUMBERS = ['priceMin', 'priceMax', 'totalMax', 'retailMin'] as const;
/** URL parameter for each list field. */
const LIST_PARAM = {
  categories: 'category',
  types: 'type',
  excludedTypes: 'excludeType',
  brands: 'brand',
  attrs: 'attr',
  conditions: 'condition',
  locations: 'location',
} as const;

/** The URL (path and query) that shows `nav`. */
export function navToUrl(
  { view, page, openId, closed, filteredOnly, filteredPattern }: NavState,
  pathname = '/',
): string {
  const q = new URLSearchParams();
  const put = (k: string, v: Nullable<string | number>, def?: unknown) =>
    v != null && v !== '' && v !== def && q.append(k, String(v));
  put('search', view.search.trim());
  put('regex', view.searchRegex ? 1 : null);
  put('desc', view.searchDescriptions ? 1 : null);
  put('sort', view.sort, DEFAULT_VIEW.sort);
  for (const f of LISTS) {
    view[f].forEach((v: string | number) => put(LIST_PARAM[f], v));
  }
  put('reachable', view.reachable ? 1 : null);
  for (const f of NUMBERS) {
    put(f, view[f]);
  }
  put('ending', view.ending);
  put('mine', view.mine);
  put('page', page, 1);
  put('lot', openId);
  put('closed', closed);
  put('filtered', filteredOnly ? 1 : null);
  put('filteredPattern', filteredOnly ? filteredPattern : null);
  const qs = q.toString();
  return pathname + (qs ? `?${qs}` : '');
}

/** The state a /tlx URL describes, or null when it has no parameters. */
export function navFromUrl(search: string): NavState | null {
  const q = new URLSearchParams(search);
  if (![...q.keys()].length) {
    return null;
  }
  const num = (k: string) => {
    const v = q.get(k);
    return v != null && v.trim() !== '' && Number.isFinite(+v) ? +v : null;
  };
  const view = normalizeView({
    search: q.get('search') ?? '',
    searchRegex: q.has('regex') && q.get('regex') !== '0',
    searchDescriptions: q.has('desc') && q.get('desc') !== '0',
    sort: q.get('sort') ?? undefined,
    categories: q.getAll('category'),
    types: q.getAll('type'),
    excludedTypes: q.getAll('excludeType'),
    brands: q.getAll('brand'),
    attrs: q.getAll('attr'),
    conditions: q.getAll('condition').map(Number).filter(Number.isFinite),
    locations: q.getAll('location'),
    reachable: q.has('reachable') && q.get('reachable') !== '0',
    ...Object.fromEntries(NUMBERS.map(f => [f, num(f)])),
    ending: q.get('ending') ?? undefined,
    mine: q.get('mine') ?? undefined,
  });
  const page = num('page');
  const closed = q.get('closed');
  const filteredOnly = closed !== 'won' && closed !== 'lost' && q.get('filtered') === '1';
  return {
    view,
    page: page && page >= 1 ? Math.floor(page) : 1,
    openId: num('lot'),
    closed: closed === 'won' || closed === 'lost' ? closed : null,
    filteredOnly,
    filteredPattern: filteredOnly ? q.get('filteredPattern') || null : null,
  };
}

export const isHistoryEntry = (s: unknown): s is HistoryEntry =>
  s !== null && typeof s === 'object' && 'tlx' in s && s.tlx === true;

export const navKey = (n: Omit<NavState, 'view'> & { view: unknown }) =>
  JSON.stringify([n.view, n.page, n.openId, n.closed, n.filteredOnly, n.filteredPattern ?? null]);

/** Same view on the same page (the grid, or one of the closed-lot pages). */
export const sameView = (
  a: Pick<NavState, 'closed' | 'filteredOnly' | 'filteredPattern'> & { view: unknown },
  b: Pick<NavState, 'closed' | 'filteredOnly' | 'filteredPattern'> & { view: unknown },
) =>
  a.closed === b.closed &&
  a.filteredOnly === b.filteredOnly &&
  (a.filteredPattern ?? null) === (b.filteredPattern ?? null) &&
  JSON.stringify(a.view) === JSON.stringify(b.view);

/** Decide whether a navigation change should push or replace the current history entry. */
export function nextHistoryAction(
  prev: unknown,
  nav: NavState,
): { mode: 'push' | 'replace'; entry: HistoryEntry } {
  const entry: HistoryEntry = {
    tlx: true,
    ...nav,
    kind: 'other',
  };
  if (!isHistoryEntry(prev)) {
    return { mode: 'replace', entry };
  }
  if (sameView(prev, nav) && prev.openId === nav.openId) {
    // More lots scrolled into the grid: still the same entry.
    return { mode: 'replace', entry: { ...entry, kind: prev.kind, scrollY: prev.scrollY } };
  }
  if (sameView(prev, nav) && prev.page === nav.page && nav.openId != null) {
    if (prev.openId != null) {
      // Moving between listings inside the popup: one entry for the whole visit.
      return { mode: 'replace', entry: { ...entry, kind: prev.kind, scrollY: prev.scrollY } };
    }
    entry.kind = 'lot';
  } else if (
    prev.openId === nav.openId &&
    prev.view.search !== nav.view.search &&
    sameView(
      { ...prev, view: { ...prev.view, search: '' } },
      { ...nav, view: { ...nav.view, search: '' } },
    )
  ) {
    entry.kind = 'search';
    if (prev.kind === 'search') {
      return { mode: 'replace', entry: { ...entry, scrollY: prev.scrollY } };
    }
  }
  return { mode: 'push', entry };
}
