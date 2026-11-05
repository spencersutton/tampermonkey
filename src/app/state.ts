// App-wide UI state as signals, the values derived from it, and the actions
// that change it. Components read and call these directly instead of passing
// state and callbacks down.
import { batch, computed, effect, signal, untracked } from '@preact/signals';
import { KEYS, lotHref, siteUrl } from '../shared/keys';
import { nameMatchPct } from '../shared/names';
import { fetchPickupLocation, type ClosedSection } from './api';
import { isAuthenticated } from './auth';
import type { BidRequest } from './bid';
import { getLot, lots, rev } from './catalog';
import { getSetting, setSetting } from './settings';
import { settingsSynced } from './source';
import type { Lot } from './types';
import { clock, DAY, MINUTE } from './util';
import { computeFacets, computeView, initialView, makeRow, savedSearchStats, type ViewState } from './view';

/** How many batches of lots the grid shows; grows as the end of it scrolls into view. */
export const page = signal(1);
export const openId = signal<number | null>(null);
/** The Won / Lost page, shown in place of the grid. */
export const closed = signal<ClosedSection | null>(null);
export const sidebarOpen = signal(false);
/** Ids of the lot cards on screen or close to it, sorted. */
export const onScreen = signal<number[]>([]);
/** The saved search opened last, and when it had been viewed before that. */
export const highlight = signal<{ id: string; since: number } | null>(null);

export type Modal =
    | { kind: 'bid'; req: BidRequest }
    | { kind: 'categories' }
    | { kind: 'typeCategory'; lot: Lot } // making the lot's item type a category
    | { kind: 'itemType'; lot: Lot };
/** The popup over everything else, including the lot popup. */
export const modal = signal<Modal | null>(null);

/** Name of the account's pickup location (fetched at most once a day while logged in). */
export const accountPickupName = computed(() => {
    const acct = getSetting(KEYS.accountPickup);
    if (acct?.name || acct?.id == null) {
        return acct?.name ?? null;
    }
    // The account may only give the location's id; find its name among the lots.
    return lots.value.values().find((l) => l.location?.id === acct.id)?.location?.name ?? null;
});
export const pickupName = computed(() => getSetting(KEYS.pickup) || accountPickupName.value || 'Raleigh');

export const storedView = computed(() => initialView(getSetting(KEYS.view), getSetting(KEYS.defaultFilters)));
export const exclusionRules = computed(() => ({
    words: getSetting(KEYS.words),
    filterOn: getSetting(KEYS.filterOn),
    removeFiltered: getSetting(KEYS.removeFiltered),
    hidden: getSetting(KEYS.hidden),
    showHidden: getSetting(KEYS.showHidden),
    customCategories: getSetting(KEYS.customCategories),
    nameMatch: nameMatchPct(getSetting(KEYS.nameMatch)),
}));

// Closed lots drop out on a 30 s clock; countdowns tick on their own.
/** The grid: lots through the view's filters and sort, recomputed on every lot update. */
export const gridView = computed(() => {
    void rev.value;
    return computeView(lots.value.values(), storedView.value, pickupName.value, exclusionRules.value, clock(30_000));
});
/** Filter options and their counts; these don't follow live price updates. */
export const filterFacets = computed(() => computeFacets(lots.value.values(), clock(30_000), getSetting(KEYS.customCategories)));
export const searchStats = computed(() => {
    void rev.value;
    return savedSearchStats(lots.value.values(), getSetting(KEYS.savedSearches), pickupName.value, exclusionRules.value, clock(30_000));
});
/** New lots across all saved searches. */
export const totalNew = computed(() => searchStats.value.values().reduce((n, s) => n + s.fresh, 0));

export const rowOf = (lot: Lot) => makeRow(lot, pickupName.value, exclusionRules.value);

export function setView(patch: Partial<ViewState>) {
    batch(() => {
        setSetting(KEYS.view, { ...storedView.value, ...patch });
        page.value = 1;
        closed.value = null; // changing the filters goes back to the grid
    });
}

export const openLot = (lot: Lot) => void (openId.value = lot.id);

/** Open a hidden lot: in the popup when it's in the catalog, else on the site. */
export function openHidden(id: number) {
    if (getLot(id)) {
        openId.value = id;
    } else {
        window.open(siteUrl(getSetting(KEYS.hidden)[id]?.href ?? '/'), '_blank', 'noopener');
    }
}

/** Show the Won / Lost page, or the grid again for null. */
export function openClosed(section: ClosedSection | null) {
    batch(() => {
        closed.value = section;
        sidebarOpen.value = false;
    });
    window.scrollTo(0, 0);
}

export function toggleHide(lot: Lot) {
    const { [lot.id]: wasHidden, ...rest } = getSetting(KEYS.hidden);
    setSetting(KEYS.hidden, wasHidden ? rest : { ...rest, [lot.id]: { title: lot.title, href: lotHref(lot.auctionPeriod, lot.id), ts: Date.now() } });
}

export const startBid = (req: BidRequest) => void (modal.value = { kind: 'bid', req });
export const addType = (lot: Lot) => void (modal.value = { kind: 'typeCategory', lot });
export const editType = (lot: Lot) => void (modal.value = { kind: 'itemType', lot });
export const editCategories = () => void (modal.value = { kind: 'categories' });

/** Close `m` if it is still the open popup (a late close mustn't close a newer one). */
export function closeModal(m: Modal) {
    if (modal.peek() === m) {
        modal.value = null;
    }
}

/** Coming back to the tab after it was hidden this long counts as a new visit. */
const VISIT_GAP = 30 * MINUTE;
/** Before any visit was recorded, lots with more than this left are taken to be new. */
const FIRST_VISIT_NEW_LEFT = 2 * DAY;

/**
 * Lots first seen after this count as new: the start of the previous visit
 * (a page load, or the tab coming back after VISIT_GAP hidden), shared by all
 * devices. null until the synced settings have arrived.
 */
export const visitSince = signal<number | null>(null);

function trackVisits() {
    const visit = () => {
        const now = Date.now();
        visitSince.value = getSetting(KEYS.lastVisit) ?? firstVisitSince(now);
        setSetting(KEYS.lastVisit, now);
    };
    let hiddenAt = 0;
    void settingsSynced.then(() => {
        visit();
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                hiddenAt = Date.now();
            } else if (hiddenAt && Date.now() - hiddenAt >= VISIT_GAP) {
                visit();
            }
        });
    });
}

/** With no previous visit, start just before the earliest-seen lot that still has over FIRST_VISIT_NEW_LEFT to go. */
function firstVisitSince(now: number): number {
    const first = lots
        .peek()
        .values()
        .filter((l) => l.endsAt - now > FIRST_VISIT_NEW_LEFT)
        .reduce((min, l) => Math.min(min, l.firstSeenAt ?? 0), Infinity);
    return first === Infinity ? now : Math.max(0, first - 1);
}

/** Start the app-wide effects; call once. */
export function startApp() {
    trackVisits();

    effect(() => {
        if (!isAuthenticated()) {
            return;
        }
        const acct = untracked(() => getSetting(KEYS.accountPickup));
        if (!(acct && Date.now() - acct.at < DAY)) {
            fetchPickupLocation().then(
                (p) => setSetting(KEYS.accountPickup, { id: p?.id ?? null, name: p?.name ?? null, at: Date.now() }),
                () => { },
            );
        }
    });

    effect(() => {
        document.title = totalNew.value ? `(${totalNew.value}) TL Catalog` : 'TL Catalog';
    });
}
