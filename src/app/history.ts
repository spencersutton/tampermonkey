// Browser back/forward for the /tlx app. Each change of view, page or open lot
// becomes a history entry (the URL stays /tlx), and popping an entry restores it.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { ViewState } from './view';

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

const isEntry = (s: unknown): s is Entry => !!s && typeof s === 'object' && (s as Entry).tlx === true;
const navKey = (n: NavState) => JSON.stringify([n.view, n.page, n.openId]);
const sameView = (a: ViewState, b: ViewState) => JSON.stringify(a) === JSON.stringify(b);

/** Push a new entry for `nav`, or replace the current one when the change doesn't deserve its own. */
function record(nav: NavState) {
  const prev: unknown = history.state;
  const entry: Entry = { tlx: true, ...nav, kind: 'other' };
  if (!isEntry(prev)) {
    history.replaceState(entry, '');
    return;
  }
  if (sameView(prev.view, nav.view) && prev.page === nav.page && nav.openId != null) {
    if (prev.openId != null) {
      // Moving between listings inside the popup: one entry for the whole visit.
      history.replaceState({ ...entry, kind: prev.kind, scrollY: prev.scrollY }, '');
      return;
    }
    entry.kind = 'lot';
  } else if (prev.openId === nav.openId && prev.view.search !== nav.view.search && sameView({ ...prev.view, search: '' }, { ...nav.view, search: '' })) {
    entry.kind = 'search';
    if (prev.kind === 'search') {
      history.replaceState({ ...entry, scrollY: prev.scrollY }, '');
      return;
    }
  }
  history.pushState(entry, '');
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
