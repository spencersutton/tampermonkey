// Browser back/forward for the /tlx app. Each change of view or open lot
// becomes a history entry, and popping an entry restores it, with as many
// pages of lots as were scrolled into the grid. The state is also
// written into the URL (/tlx?search=foo&sort=price-low&page=2&lot=123) so a
// view can be bookmarked or shared; only values that differ from the defaults appear.
import { batch, computed, effect } from '@preact/signals';
import { KEYS } from '../shared/keys';
import type { ClosedSection } from './api';
import { setSetting } from './settings';
import { closed, openId, page, storedView } from './state';
import { DEFAULT_VIEW, normalizeView, type ViewState } from './view';

/** What a history entry restores. */
interface NavState {
  view: ViewState;
  page: number;
  openId: number | null;
  closed: ClosedSection | null; // the Won / Lost page shown instead of the grid
}

/**
 * A history entry. `kind` says what made it: 'lot' opened a lot over the list
 * (so closing the lot can just go back), 'search' typed in the search box (so
 * further typing replaces it rather than adding an entry per pause).
 */
interface Entry extends Omit<NavState, 'view'> {
  view: Omit<ViewState, 'newSince'> & { newSince: string | null };
  tlx: true;
  kind: 'lot' | 'search' | 'other';
  scrollY?: number;
}

const LISTS = ['categories', 'conditions', 'locations'] as const;
const NUMBERS = ['priceMin', 'priceMax', 'totalMax', 'retailMin'] as const;
/** URL parameter for each list field. */
const LIST_PARAM = { categories: 'category', conditions: 'condition', locations: 'location' } as const;

/** The URL (path and query) that shows `nav`. */
function navToUrl({ view, page, openId, closed }: NavState): string {
  const q = new URLSearchParams();
  const put = (k: string, v: string | number | null | undefined, def?: unknown) => v != null && v !== '' && v !== def && q.append(k, String(v));
  put('search', view.search.trim());
  put('regex', view.searchRegex ? 1 : null);
  put('noCategories', view.noCategories ? 1 : null);
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
  const qs = q.toString();
  return location.pathname + (qs ? `?${qs}` : '');
}

/** The state a /tlx URL describes, or null when it has no parameters. */
export function navFromUrl(search = location.search): NavState | null {
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
    sort: q.get('sort') ?? undefined,
    categories: q.getAll('category'),
    noCategories: q.get('noCategories') === '1',
    conditions: q.getAll('condition').map(Number).filter(Number.isFinite),
    locations: q.getAll('location'),
    reachable: q.has('reachable') && q.get('reachable') !== '0',
    ...Object.fromEntries(NUMBERS.map((f) => [f, num(f)])),
    ending: q.get('ending') ?? undefined,
    mine: q.get('mine') ?? undefined,
  });
  const page = num('page');
  const closed = q.get('closed');
  return {
    view,
    page: page && page >= 1 ? Math.floor(page) : 1,
    openId: num('lot'),
    closed: closed === 'won' || closed === 'lost' ? closed : null,
  };
}

const isEntry = (s: unknown): s is Entry => !!s && typeof s === 'object' && (s as Entry).tlx === true;
const navKey = (n: Omit<NavState, 'view'> & { view: unknown }) => JSON.stringify([n.view, n.page, n.openId, n.closed]);
/** Same view on the same page (the grid, or one of the closed-lot pages). */
const sameView = (a: Pick<NavState, 'closed'> & { view: unknown }, b: Pick<NavState, 'closed'> & { view: unknown }) =>
  a.closed === b.closed && JSON.stringify(a.view) === JSON.stringify(b.view);

/** Push a new entry for `nav`, or replace the current one when the change doesn't deserve its own. */
function record(nav: NavState) {
  const prev: unknown = history.state;
  const entry: Entry = { tlx: true, ...nav, view: { ...nav.view, newSince: nav.view.newSince?.toString() ?? null }, kind: 'other' };
  if (!isEntry(prev)) {
    history.replaceState(entry, '', navToUrl(nav));
    return;
  }
  if (sameView(prev, nav) && prev.openId === nav.openId) {
    // More lots scrolled into the grid: still the same entry.
    history.replaceState({ ...entry, kind: prev.kind, scrollY: prev.scrollY }, '', navToUrl(nav));
    return;
  }
  if (sameView(prev, nav) && prev.page === nav.page && nav.openId != null) {
    if (prev.openId != null) {
      // Moving between listings inside the popup: one entry for the whole visit.
      history.replaceState({ ...entry, kind: prev.kind, scrollY: prev.scrollY }, '', navToUrl(nav));
      return;
    }
    entry.kind = 'lot';
  } else if (
    prev.openId === nav.openId &&
    prev.view.search !== nav.view.search &&
    sameView({ ...prev, view: { ...prev.view, search: '' } }, { ...nav, view: { ...nav.view, search: '' } })
  ) {
    entry.kind = 'search';
    if (prev.kind === 'search') {
      history.replaceState({ ...entry, scrollY: prev.scrollY }, '', navToUrl(nav));
      return;
    }
  }
  history.pushState(entry, '', navToUrl(nav));
}

const current = computed((): NavState => ({ view: storedView.value, page: page.value, openId: openId.value, closed: closed.value }));

function restore(nav: Omit<NavState, 'view'> & { view: unknown }) {
  batch(() => {
    setSetting(KEYS.view, normalizeView(nav.view));
    page.value = nav.page;
    openId.value = nav.openId;
    closed.value = nav.closed;
  });
}

/**
 * Keep browser history in step with the view, page, open lot and closed page:
 * changes are recorded, and back / forward restore the entry's state and put
 * the scroll position back. Call once.
 */
export function startHistory() {
  history.scrollRestoration = 'manual';
  effect(() => {
    const nav = current.value;
    const cur: unknown = history.state;
    if (!isEntry(cur) || navKey(cur) !== navKey(nav)) {
      record(nav);
    }
  });

  window.addEventListener('popstate', (e) => {
    if (!isEntry(e.state)) {
      return;
    }
    const y = e.state.scrollY ?? 0;
    if (navKey(e.state) === navKey(current.peek())) {
      window.scrollTo(0, y);
    } else {
      restore(e.state);
      // Once the restored page has rendered.
      requestAnimationFrame(() => window.scrollTo(0, y));
    }
  });

  // Remember each entry's scroll position, debounced (browsers rate-limit replaceState).
  let t: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (isEntry(history.state)) {
          history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
        }
      }, 200);
    },
    { passive: true },
  );
}

/** Close the open lot, by going back when opening it made the current entry, so back after closing doesn't reopen it. */
export function closeLot() {
  const cur: unknown = history.state;
  if (isEntry(cur) && cur.kind === 'lot' && cur.openId === openId.peek()) {
    history.back();
  } else {
    openId.value = null;
  }
}
