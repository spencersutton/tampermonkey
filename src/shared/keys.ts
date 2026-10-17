// GM storage keys for the /tlx catalog view.
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
} as const;

export interface HiddenLot {
  title: string;
  href: string;
  ts: number;
}

/** A category of my own: lots whose title matches `pattern` (same rules as the regex filters) go in it instead of their site category. */
export interface CustomCategory {
  name: string;
  pattern: string;
}

// Full catalog pulls default to every 5 minutes and are never allowed more often than every minute.
export const DEFAULT_SYNC_MINUTES = 5;
export const MIN_SYNC_MINUTES = 1;

/** Value returned for each GM storage key when nothing has been saved yet. */
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
  [KEYS.savedSearches]: [] as unknown[],
  [KEYS.accountPickup]: null as { id: number | null; name: string | null; at: number } | null,
  [KEYS.customCategories]: [] as CustomCategory[],
};

/** Path of a lot's page on the real site. */
export const lotHref = (auctionPeriod: string, id: number | string) => `/lots/${auctionPeriod}/${id}`;
