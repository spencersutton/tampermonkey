// Settings keys (server-only for SERVER_KEYS, otherwise browser-local).
import type { SavedSearch } from '../app/logic/view';
import { DEFAULT_SYNC_MINUTES, DEFAULT_TITLE_LINES, SITE } from './constants';

export const KEYS = {
  hidden: 'hiddenLots', // { [lotId]: { title, href, ts } }
  words: 'filterWords', // string[]
  filterOn: 'filterEnabled', // boolean
  showHidden: 'showHidden', // boolean
  removeFiltered: 'removeFiltered', // boolean – drop filtered lots entirely instead of graying out
  collapsed: 'collapsedLists', // { words: boolean, hidden: boolean }
  syncMinutes: 'tlxSyncMinutes', // number – minimum minutes between full catalog pulls
  view: 'tlxView', // persisted catalog view state (sort, filters)
  savedSearches: 'tlxSavedSearches', // SavedSearch[] (see app/view.ts)
  accountPickup: 'tlxAccountPickup', // { id, name, at } – pickup location from the account, cached a day
  titleLines: 'tlxTitleLines', // number – lines of a lot title shown in the grid before it's cut off; 0 = no limit
  lastVisit: 'tlxLastVisit', // epoch ms | null – when the catalog was last opened; lots first seen since the visit before get a "New" badge
  recentSearches: 'tlxRecentSearches', // string[] – searches typed in this browser, most recent first
} as const;

/**
 * Settings the web app keeps on the tlx server, so every device using it shares them. The rest stay
 * per browser.
 */
export const SERVER_KEYS = [
  KEYS.hidden,
  KEYS.words,
  KEYS.filterOn,
  KEYS.showHidden,
  KEYS.removeFiltered,
  KEYS.syncMinutes, // the server's own pull interval
  KEYS.savedSearches,
  KEYS.lastVisit,
] as const;

export interface HiddenLot {
  title: string;
  href: string;
  ts: number;
}

/** Value returned for each setting when nothing has been saved yet. */
export const DEFAULTS = {
  [KEYS.hidden]: {} as Record<string, HiddenLot>,
  [KEYS.words]: [] as string[],
  [KEYS.filterOn]: true,
  [KEYS.showHidden]: false,
  [KEYS.removeFiltered]: false,
  [KEYS.collapsed]: { words: false, hidden: false } as Record<string, boolean>,
  [KEYS.syncMinutes]: DEFAULT_SYNC_MINUTES,
  [KEYS.view]: null as unknown,
  [KEYS.savedSearches]: [] as SavedSearch[],
  [KEYS.accountPickup]: null as { id: number | null; name: string | null; at: number } | null,
  [KEYS.titleLines]: DEFAULT_TITLE_LINES,
  [KEYS.lastVisit]: null as number | null,
  [KEYS.recentSearches]: [] as string[],
};

/** A lot's page on the real site (absolute, since the web app runs on another origin). */
export const lotHref = (auctionPeriod: string, id: number) => `${SITE}/lots/${auctionPeriod}/${id}`;

/** A link saved with a hidden lot as an absolute URL on the site (older ones were saved as paths). */
export const siteUrl = (href: string) => new URL(href, `${SITE}/`).href;
