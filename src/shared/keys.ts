// Settings keys (localStorage, and the server for SYNCED_KEYS).
import type { SavedSearch } from '../app/view';

export const KEYS = {
  hidden: 'hiddenLots', // { [lotId]: { title, href, ts } }
  words: 'filterWords', // string[]
  filterOn: 'filterEnabled', // boolean
  showHidden: 'showHidden', // boolean
  removeFiltered: 'removeFiltered', // boolean – drop filtered lots entirely instead of graying out
  collapsed: 'collapsedLists', // { words: boolean, hidden: boolean }
  syncMinutes: 'tlxSyncMinutes', // number – minimum minutes between full catalog pulls
  pickup: 'tlxPickup', // string | null – pickup location name; null = from account, else Raleigh
  view: 'tlxView', // persisted catalog view state (sort, filters)
  savedSearches: 'tlxSavedSearches', // SavedSearch[] (see app/view.ts)
  accountPickup: 'tlxAccountPickup', // { id, name, at } – pickup location from the account, cached a day
  customCategories: 'tlxCustomCategories', // CustomCategory[] – title regexes that move lots into a category of their own
  sortTypes: 'tlxSortTypes', // string[] – title regexes for kinds of item; the words matched lead the title when sorting
  titleLines: 'tlxTitleLines', // number – lines of a lot title shown in the grid before it's cut off; 0 = no limit
} as const;

/** Settings the web app keeps on the tlx server, so every device using it shares them. The rest stay per browser. */
export const SYNCED_KEYS = [
  KEYS.hidden,
  KEYS.words,
  KEYS.filterOn,
  KEYS.showHidden,
  KEYS.removeFiltered,
  KEYS.syncMinutes, // the server's own pull interval
  KEYS.pickup,
  KEYS.savedSearches,
  KEYS.customCategories,
  KEYS.sortTypes,
] as const;

export interface HiddenLot {
  title: string;
  href: string;
  ts: number;
}

/**
 * A category of my own: lots whose title matches `pattern` (same rules as the
 * regex filters) go in it instead of their site category. With `within` (a
 * site category value), only lots in that site category are taken.
 */
export interface CustomCategory {
  name: string;
  pattern: string;
  within?: string;
}

// Full catalog pulls default to every 5 minutes and are never allowed more often than every minute.
export const DEFAULT_SYNC_MINUTES = 5;
export const MIN_SYNC_MINUTES = 1;

// Grid cards show titles in full unless they run past this many lines.
export const DEFAULT_TITLE_LINES = 6;

/** Value returned for each setting when nothing has been saved yet. */
export const DEFAULTS = {
  [KEYS.hidden]: {} as Record<string, HiddenLot>,
  [KEYS.words]: [] as string[],
  [KEYS.filterOn]: true,
  [KEYS.showHidden]: false,
  [KEYS.removeFiltered]: false,
  [KEYS.collapsed]: { words: false, hidden: false } as Record<string, boolean>,
  [KEYS.syncMinutes]: DEFAULT_SYNC_MINUTES,
  [KEYS.pickup]: null as string | null,
  [KEYS.view]: null as unknown,
  [KEYS.savedSearches]: [] as SavedSearch[],
  [KEYS.accountPickup]: null as { id: number | null; name: string | null; at: number } | null,
  [KEYS.customCategories]: [] as CustomCategory[],
  // "1/3 HP Continuous Feed Garbage Disposal" sorts as "Garbage Disposal Continuous Feed 1/3 HP".
  [KEYS.sortTypes]: ['garbage disposals?'] as string[],
  [KEYS.titleLines]: DEFAULT_TITLE_LINES,
};

/** A lot's page on the real site (absolute, since the web app runs on another origin). */
export const lotHref = (auctionPeriod: string, id: number | string) => `https://triangleliquidators.com/lots/${auctionPeriod}/${id}`;

/** A link saved with a hidden lot as an absolute URL on the site (older ones were saved as paths). */
export const siteUrl = (href: string) => new URL(href, 'https://triangleliquidators.com/').href;
