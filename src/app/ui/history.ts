// Browser back/forward for the /tlx app. Delegates URL encoding/parsing and
// push-vs-replace decisions to logic/history.ts; this file only touches
// window.history, location and scroll.
import { batch, computed, effect } from '@preact/signals';

import { KEYS } from '../../shared/keys';
import { ms } from '../../shared/time';
import {
  isHistoryEntry,
  navFromUrl as parseNavUrl,
  navKey,
  navToUrl,
  nextHistoryAction,
  type NavState,
} from '../logic/history';
import { normalizeView } from '../logic/view';
import { setSetting } from '../server/settings';
import { closed, filteredOnly, filteredPattern, openId, page, storedView } from './state';

/** The state a /tlx URL describes, or null when it has no parameters. */
export const navFromUrl = (search = location.search) => parseNavUrl(search);

function record(nav: NavState) {
  const { mode, entry } = nextHistoryAction(history.state, nav);
  const url = navToUrl(nav, location.pathname);
  if (mode === 'push') {
    history.pushState(entry, '', url);
  } else {
    history.replaceState(entry, '', url);
  }
}

/** Scroll positions are saved this long after scrolling stops. */
const SCROLL_SAVE_DEBOUNCE = Duration.from({ milliseconds: 200 });

const current = computed((): NavState => ({
  view: storedView.value,
  page: page.value,
  openId: openId.value,
  closed: closed.value,
  filteredOnly: filteredOnly.value,
  filteredPattern: filteredPattern.value,
}));

function restore(nav: Omit<NavState, 'view'> & { view: unknown }) {
  batch(() => {
    setSetting(KEYS.view, normalizeView(nav.view));
    page.value = nav.page;
    openId.value = nav.openId;
    closed.value = nav.closed;
    filteredOnly.value = nav.filteredOnly;
    filteredPattern.value = nav.filteredPattern ?? null;
  });
}

/**
 * Keep browser history in step with the view, page, open lot and closed page: changes are recorded,
 * and back / forward restore the entry's state and put the scroll position back. Call once.
 */
export function startHistory() {
  history.scrollRestoration = 'manual';
  effect(() => {
    const nav = current.value;
    const cur: unknown = history.state;
    if (!isHistoryEntry(cur) || navKey(cur) !== navKey(nav)) {
      record(nav);
    }
  });

  window.addEventListener('popstate', e => {
    if (!isHistoryEntry(e.state)) {
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
        if (isHistoryEntry(history.state)) {
          history.replaceState({ ...history.state, scrollY: window.scrollY }, '');
        }
      }, ms(SCROLL_SAVE_DEBOUNCE));
    },
    { passive: true },
  );
}

/**
 * Close the open lot, by going back when opening it made the current entry, so back after closing
 * doesn't reopen it.
 */
export function closeLot() {
  const cur: unknown = history.state;
  if (isHistoryEntry(cur) && cur.kind === 'lot' && cur.openId === openId.peek()) {
    history.back();
  } else {
    openId.value = null;
  }
}
