// Browser back/forward for the /tlx app. Each change of view, page or open lot
// becomes a history entry, and popping an entry restores it. The state is also
// written into the URL (/tlx?search=foo&sort=price-low&page=2&lot=123) so a
// view can be bookmarked or shared; only values that differ from the defaults appear.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { DEFAULT_VIEW, normalizeView, type ViewState } from './view';

/** What a history entry restores. */
export interface NavState {
  view: ViewState;
  page: number;
  openId: number | null;
}

/**
 * A history entry. `kind` says what made it: 'lot' opened a lot over the list
 * (so closing the lot can just go back), 'search' typed in the search box (so
 * further typing replaces it rather than adding an entry per pause).
 */
interface Entry extends NavState {
  tlx: true;
  kind: 'lot' | 'search' | 'other';
  scrollY?: number;
}

const LISTS = ['categories', 'conditions', 'locations'] as const;
const NUMBERS = ['priceMin', 'priceMax', 'totalMax', 'retailMin'] as const;
/** URL parameter for each list field. */
const LIST_PARAM = { categories: 'category', conditions: 'condition', locations: 'location' } as const;

/** The URL (path and query) that shows `nav`. */
export function navToUrl({ view, page, openId }: NavState): string {
  const q = new URLSearchParams();
  const put = (k: string, v: string | number | null | undefined, def?: unknown) => v != null && v !== '' && v !== def && q.append(k, String(v));
  put('search', view.search.trim());
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
    sort: q.get('sort') ?? undefined,
    categories: q.getAll('category'),
    conditions: q.getAll('condition').map(Number).filter(Number.isFinite),
    locations: q.getAll('location'),
    reachable: q.has('reachable') && q.get('reachable') !== '0',
    ...Object.fromEntries(NUMBERS.map((f) => [f, num(f)])),
    ending: q.get('ending') ?? undefined,
    mine: q.get('mine') ?? undefined,
  });
  const page = num('page');
  return { view, page: page && page >= 1 ? Math.floor(page) : 1, openId: num('lot') };
}

const isEntry = (s: unknown): s is Entry => !!s && typeof s === 'object' && (s as Entry).tlx === true;
const navKey = (n: NavState) => JSON.stringify([n.view, n.page, n.openId]);
const sameView = (a: ViewState, b: ViewState) => JSON.stringify(a) === JSON.stringify(b);

/** Push a new entry for `nav`, or replace the current one when the change doesn't deserve its own. */
function record(nav: NavState) {
  const prev: unknown = history.state;
  const entry: Entry = { tlx: true, ...nav, kind: 'other' };
  if (!isEntry(prev)) {
    history.replaceState(entry, '', navToUrl(nav));
    return;
  }
  if (sameView(prev.view, nav.view) && prev.page === nav.page && nav.openId != null) {
    if (prev.openId != null) {
      // Moving between listings inside the popup: one entry for the whole visit.
      history.replaceState({ ...entry, kind: prev.kind, scrollY: prev.scrollY }, '', navToUrl(nav));
      return;
    }
    entry.kind = 'lot';
  } else if (prev.openId === nav.openId && prev.view.search !== nav.view.search && sameView({ ...prev.view, search: '' }, { ...nav.view, search: '' })) {
    entry.kind = 'search';
    if (prev.kind === 'search') {
      history.replaceState({ ...entry, scrollY: prev.scrollY }, '', navToUrl(nav));
      return;
    }
  }
  history.pushState(entry, '', navToUrl(nav));
}

/**
 * Keep browser history in step with `nav`: changes are recorded, and back /
 * forward call `restore` with the entry's state and put the scroll position
 * back. Returns `closeLot`, which closes the open lot by going back when
 * opening it made the current entry, so back after closing doesn't reopen it.
 */
export function useHistory(nav: NavState, restore: (nav: NavState) => void, close: () => void) {
  const key = navKey(nav);
  const latest = useRef({ key, restore });
  latest.current = { key, restore };
  const pendingScroll = useRef<number | null>(null);

  useLayoutEffect(() => {
    const cur: unknown = history.state;
    if (!isEntry(cur) || navKey(cur) !== key) {
      record(nav);
    }
    if (pendingScroll.current != null) {
      window.scrollTo(0, pendingScroll.current);
      pendingScroll.current = null;
    }
  }, [key]);

  useEffect(() => {
    history.scrollRestoration = 'manual';
    const onPop = (e: PopStateEvent) => {
      if (!isEntry(e.state)) {
        return;
      }
      if (navKey(e.state) === latest.current.key) {
        window.scrollTo(0, e.state.scrollY ?? 0);
      } else {
        pendingScroll.current = e.state.scrollY ?? 0;
        latest.current.restore(e.state);
      }
    };
    // Remember each entry's scroll position, debounced (browsers rate-limit replaceState).
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (isEntry(history.state)) {
          history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
        }
      }, 200);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, []);

  return function closeLot() {
    const cur: unknown = history.state;
    if (isEntry(cur) && cur.kind === 'lot' && cur.openId === nav.openId) {
      history.back();
    } else {
      close();
    }
  };
}
