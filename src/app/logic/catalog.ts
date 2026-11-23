import { DAY } from '../../shared/constants';
import { dollars } from '../../shared/cost';
import * as format from '../../shared/format';
import { MAX_TYPE_LENGTH } from '../../shared/itemtype';
import { lotHref, type HiddenLot } from '../../shared/keys';
import { endsAtMs } from '../../shared/lot';
import { collator } from '../../shared/sortKey';
import type { Lot, PastClose } from '../types';
import type { ViewState } from './view';
import '../../shared/arrayToSet';

export interface PendingTypeEdit {
  lotIds: number[];
  itemType: string;
  seq: number;
}

/** Merge a catalog delta or full reply into the existing lot map. */
export function mergeCatalogLots(
  cur: ReadonlyMap<number, Lot>,
  reply: { full: boolean; ids: number[] | null; lots: Lot[] },
  typeEdits: Iterable<PendingTypeEdit>,
): Map<number, Lot> | null {
  if (!reply.full && !reply.lots.length && (!reply.ids || reply.ids.length === cur.size)) {
    return null;
  }
  const next = new Map(reply.full ? [] : cur);
  if (reply.ids) {
    const keep = reply.ids.toSet();
    next.forEach((_, id) => keep.has(id) || next.delete(id));
  }
  for (const fresh of reply.lots) {
    const mine = cur.get(fresh.id);
    // Keep newer live prices, but take server-owned metadata from the poll.
    if (mine && mine.version > fresh.version) {
      next.set(fresh.id, {
        ...mine,
        firstSeenAt: fresh.firstSeenAt,
        itemType: fresh.itemType,
        pastCloses: fresh.pastCloses,
        groupId: fresh.groupId,
      });
    } else {
      next.set(fresh.id, fresh);
    }
  }
  for (const edit of typeEdits) {
    for (const id of edit.lotIds) {
      const lot = next.get(id);
      if (lot) {
        next.set(id, { ...lot, itemType: edit.itemType });
      }
    }
  }
  return next;
}

/** Merge brand/model fields from catalog lots into the brand/model caches. */
export function mergeBrandModels(
  curBrands: ReadonlyMap<number, string | null>,
  curModels: ReadonlyMap<number, string | null>,
  incoming: Lot[],
): { brands: Map<number, string | null>; models: Map<number, string | null> } {
  const brands = new Map(curBrands);
  const models = new Map(curModels);
  for (const lot of incoming) {
    if (lot.brand !== undefined) {
      brands.set(lot.id, lot.brand?.trim() || null);
    }
    if (lot.model !== undefined) {
      models.set(lot.id, lot.model?.trim() || null);
    }
  }
  return { brands, models };
}

/** Median of a list of prices. */
const median = (xs: number[]) => {
  const s = xs.sortBy(x => x);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * What a lot's past closes say it usually goes for: the median of the recent ones that sold,
 * counting only those in the same condition when there are any.
 */
export function pastPrice(
  lot: Lot,
): { median: number; count: number; sameCondition: boolean } | null {
  const sold = lot.pastCloses?.recent.filter(c => c.sold) ?? [];
  const same = sold.filter(c => c.condition === lot.condition.display_name);
  const use = same.length ? same : sold;
  if (!use.length) {
    return null;
  }
  return {
    median: median(use.map(c => c.price)),
    count: use.length,
    sameCondition: same.length > 0,
  };
}

const STRIPPED_DESC_LINE = /^\s*(?:quantity|brand|model)\s*:.*$/i;

/** Remove boilerplate Quantity/Brand/Model lines from a lot description and tidy blank lines. */
export function cleanDescription(description: string): string {
  return description
    .split(/\r?\n/)
    .filter(line => !STRIPPED_DESC_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One past close as a line of text. */
export const pastCloseText = (c: PastClose) =>
  `${c.sold ? dollars(c.price) : 'no sale'}${c.final ? '' : ' (last seen)'} · ${c.condition ?? 'Unknown'} · ${format.shortDate(c.endsAt)}`;

/** Validate an item type name before saving. */
export function itemTypeError(name: string): string | null {
  if (!name.trim()) {
    return 'Item type is required';
  }
  return name.length > MAX_TYPE_LENGTH ? `Use at most ${MAX_TYPE_LENGTH} characters` : null;
}

/** Sorted distinct item types currently in the catalog. */
export function itemTypeSuggestions(lots: Iterable<Lot>): string[] {
  return Iterator.from(lots)
    .flatMap(l => (l.itemType ? [l.itemType] : []))
    .toSet()
    .toArray()
    .toSorted(collator.compare);
}

/** Before any visit was recorded, lots with more than this left are taken to be new. */
const FIRST_VISIT_NEW_LEFT = 2 * DAY;

/**
 * With no previous visit, start just before the earliest-seen lot that still has over
 * FIRST_VISIT_NEW_LEFT to go.
 */
export function firstVisitSince(lots: Iterable<Lot>, now: number): number {
  const newAfter = now + FIRST_VISIT_NEW_LEFT;
  const first = Iterator.from(lots)
    .filter(l => endsAtMs(l) > newAfter)
    .reduce<number | null>((min, l) => Math.min(min ?? Infinity, l.firstSeenAt ?? 0), null);
  if (first == null) {
    return now;
  }
  return Math.max(0, first - 1);
}

/** Next view state after excluding an item type from the grid. */
export function hideItemTypeView(view: ViewState, type: string): ViewState {
  const key = type.toLowerCase();
  let excludedTypes = view.excludedTypes;
  if (!excludedTypes.includes(key)) {
    excludedTypes = [...excludedTypes, key];
  }
  const types = view.types.filter(t => t !== key);
  return { ...view, types, excludedTypes };
}

/** Add an item type to the global filter list, normalized to lowercase and deduplicated. */
export function addFilterType(filterTypes: string[], type: string): string[] {
  const key = type.trim().toLowerCase();
  if (!key || filterTypes.includes(key)) {
    return filterTypes;
  }
  return [...filterTypes, key];
}

/** Toggle a lot in the hidden-lots map. */
export function toggleHiddenLot(
  hidden: Record<string, HiddenLot>,
  lot: Lot,
  now = Date.now(),
): Record<string, HiddenLot> {
  const { [lot.id]: wasHidden, ...rest } = hidden;
  if (wasHidden) {
    return rest;
  }
  return {
    ...rest,
    [lot.id]: { title: lot.title, href: lotHref(lot.auction_period, lot.id), ts: now },
  };
}

/** Add a search to the recent-searches list, deduplicated case-insensitively and capped. */
export function rememberSearchList(recent: string[], text: string, limit = 8): string[] | null {
  const q = text.trim();
  if (!q) {
    return null;
  }
  const rest = recent.filter(s => s.toLowerCase() !== q.toLowerCase());
  return [q, ...rest].slice(0, limit);
}

/**
 * Filter similar lots to those still open and different from `currentId`, preferring catalog
 * copies.
 */
export function openSimilarLots(
  similar: Lot[],
  currentId: number,
  lookup: (id: number) => Lot | undefined,
  now: number,
): Lot[] {
  return similar.map(l => lookup(l.id) ?? l).filter(l => l.id !== currentId && endsAtMs(l) > now);
}
