// GM storage keys shared by the site enhancements and the /tlx catalog view.
export const KEYS = {
  hidden: 'hiddenLots', // { [lotId]: { title, href, ts } }
  words: 'filterWords', // string[]
  filterOn: 'filterEnabled', // boolean
  confirm: 'confirmBids', // boolean
  showHidden: 'showHidden', // boolean
  removeFiltered: 'removeFiltered', // boolean – drop filtered lots entirely instead of graying out
  collapsed: 'collapsedLists', // { words: boolean, hidden: boolean }
  syncMinutes: 'tlxSyncMinutes', // number – minimum minutes between full catalog pulls
  pickup: 'tlxPickup', // string | null – pickup location name; null = from account, else Raleigh
  view: 'tlxView', // persisted catalog view state (sort, filters)
  accountPickup: 'tlxAccountPickup', // { id, name, at } – pickup location from the account, cached a day
} as const;

export interface HiddenLot {
  title: string;
  href: string;
  ts: number;
}

export const DEFAULTS = {
  [KEYS.hidden]: {} as Record<string, HiddenLot>,
  [KEYS.words]: [] as string[],
  [KEYS.filterOn]: true,
  [KEYS.confirm]: true,
  [KEYS.showHidden]: false,
  [KEYS.removeFiltered]: false,
  [KEYS.collapsed]: { words: false, hidden: false } as Record<string, boolean>,
  [KEYS.syncMinutes]: 5,
  [KEYS.pickup]: null as string | null,
  [KEYS.view]: null as unknown,
  [KEYS.accountPickup]: null as { id: number | null; name: string | null; at: number } | null,
};

// Full catalog pulls are never allowed more often than this.
export const MIN_SYNC_MINUTES = 5;

export const lotHref = (auctionPeriod: string, id: number | string) => `/lots/${auctionPeriod}/${id}`;
