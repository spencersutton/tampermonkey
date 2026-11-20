import { dequal } from 'dequal';

import type { CustomCategory, DefaultFilters } from '../../shared/keys';
import { collator } from '../../shared/sortKey';
import type { Lot } from '../types';
import {
  categoryIndex,
  compileCategories,
  customCategoryValue,
  isCustomCategory,
  normalizeView,
  type Facet,
  type Facets,
  type SavedSearch,
  type ViewState,
} from './view';
import '../../shared/arrayToSet';

// ---------------------------------------------------------------------------
// Category tree grouping
// ---------------------------------------------------------------------------

/** A category filter row, with the custom categories named "<it> - <sub>" nested under it. */
export interface CategoryGroup {
  facet: Facet<string>;
  subs: CategoryGroup[];
}

/** Separator between a site category's name and a subcategory's in custom category names. */
const SUB = ' - ';

/** Nest custom categories under the longest matching site or custom category name. */
export function groupCategories({ categories, siteCategories }: Facets): CategoryGroup[] {
  const all = new Map(
    [...siteCategories.map(f => ({ ...f, count: 0 })), ...categories].map(f => [f.value, f]),
  );
  const parents = all
    .values()
    .toArray()
    .sortBy(f => f.label.length)
    .toReversed();
  const groups = new Map(
    all.entries().map(([value, facet]): [string, CategoryGroup] => [value, { facet, subs: [] }]),
  );
  const top: CategoryGroup[] = [];
  for (const f of categories) {
    const p = isCustomCategory(f.value)
      ? parents.find(s => f.label.startsWith(s.label + SUB))
      : undefined;
    const group = groups.get(f.value)!;
    if (p) {
      group.facet = { ...f, label: f.label.slice(p.label.length + SUB.length) };
      groups.get(p.value)!.subs.push(group);
    } else {
      top.push(group);
    }
  }
  // A site category whose lots all moved into subcategories still heads them.
  for (const p of siteCategories) {
    const group = groups.get(p.value)!;
    if (group.subs.length && !top.includes(group)) {
      top.push(group);
    }
  }
  const sort = (rows: CategoryGroup[]): CategoryGroup[] =>
    rows
      .toSorted((a, b) => collator.compare(a.facet.label, b.facet.label))
      .map(g => ({ ...g, subs: sort(g.subs) }));
  return sort(top);
}

/** A group's own category and all its subcategories, nested ones included. */
export const groupFacets = (g: CategoryGroup): Facet<string>[] => [
  g.facet,
  ...g.subs.flatMap(groupFacets),
];

export const categoryCollapseId = (value: string) => `cat:${value}`;

export const expandableCategories = (g: CategoryGroup): string[] =>
  g.subs.length ? [categoryCollapseId(g.facet.value), ...g.subs.flatMap(expandableCategories)] : [];

export function collapsedCategoriesUpdate(
  current: Record<string, boolean>,
  facets: Facets,
  value: boolean,
): Record<string, boolean> {
  const next = { ...current };
  for (const id of groupCategories(facets).flatMap(expandableCategories)) {
    next[id] = value;
  }
  if (!value) {
    next['f-category'] = false;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Category editor logic
// ---------------------------------------------------------------------------

/** A category being edited; `from` is its saved name (null if new), so renames can follow it. */
export interface CategoryDraft {
  key: number;
  from: string | null;
  name: string;
  types: string[];
}

/** The category a draft saves as. */
export const clean = (d: Pick<CategoryDraft, 'name' | 'types'>): CustomCategory => ({
  name: d.name.trim(),
  types: d.types,
});

/** What's wrong with a category editor row, if anything. */
export function categoryDraftError(d: CategoryDraft, drafts: CategoryDraft[]): string | null {
  const name = d.name.trim();
  if (!name) {
    return 'Name is required';
  }
  if (drafts.some(o => o !== d && o.name.trim().toLowerCase() === name.toLowerCase())) {
    return 'Another category has this name';
  }
  if (!d.types.length && !drafts.some(o => o !== d && o.name.trim().startsWith(`${name} - `))) {
    return 'Add item types';
  }
  return null;
}

/** Which category draft takes each open lot. */
export function assignLotsToDrafts(drafts: CategoryDraft[], lots: Lot[]): Map<number, Lot[]> {
  const cats = drafts.map(clean);
  const compiled = compileCategories(cats);
  const taken = new Map<number, Lot[]>(drafts.map(d => [d.key, []]));
  for (const lot of lots) {
    const owner = categoryIndex(lot, compiled);
    if (owner >= 0) {
      taken.get(drafts[owner]!.key)!.push(lot);
    }
  }
  return taken;
}

/** Count open lots per item type. */
export function countItemTypes(lots: Lot[]): Map<string, number> {
  const by = new Map<string, number>();
  for (const l of lots) {
    if (l.itemType) {
      by.set(l.itemType, (by.get(l.itemType) ?? 0) + 1);
    }
  }
  return by;
}

/** Build the rename/delete map from initial categories and final drafts. */
export function buildCategoryRenames(
  initial: CustomCategory[],
  drafts: CategoryDraft[],
): Map<string, string | null> {
  const renames = new Map<string, string | null>(initial.map(c => [c.name, null]));
  for (const d of drafts) {
    if (d.from != null) {
      renames.set(d.from, d.name.trim());
    }
  }
  return renames;
}

export const normalizeType = (type: string) => type.trim().toLowerCase().replace(/\s+/g, ' ');

/** Parse comma-separated item types, skipping duplicates already in `existing`. */
export function parseAddedTypes(raw: string, existing: string[]): string[] {
  const seen = existing.map(normalizeType).toSet();
  const fresh = raw
    .split(',')
    .map(normalizeType)
    .filter(t => t && !seen.has(t));
  return fresh.length ? [...existing, ...fresh].toUnique() : existing;
}

// ---------------------------------------------------------------------------
// Type-to-category dialog logic
// ---------------------------------------------------------------------------

/** Similar types offered as checkboxes. */
const SIMILAR_LIMIT = 12;

/** "drill bit set" -> "Drill Bit Sets" */
export function categoryName(type: string): string {
  const words = type.split(' ');
  const last = words.pop()!;
  let many = `${last}s`;
  if (/(ss|x|z|ch|sh)$/.test(last)) {
    many = `${last}es`;
  } else if (last.endsWith('s')) {
    many = last;
  } else if (/[^aeiou]y$/.test(last)) {
    many = `${last.slice(0, -1)}ies`;
  }
  return [...words, many].map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function categoryError(
  mode: 'new' | 'add',
  existing: CustomCategory | undefined,
  name: string,
  cats: CustomCategory[],
): string | null {
  if (mode === 'add') {
    return existing ? null : 'Pick a category';
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Name is required';
  }
  if (cats.some(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
    return 'There’s already a category with this name – use “Add to existing”';
  }
  return null;
}

/** Words of a type worth comparing ("of", "and" and the like don't count). */
const typeWords = (t: string) =>
  t.split(/[\s/-]+/).filter(w => w.length > 2 && !['and', 'for', 'with'].includes(w));

/** Whether saving takes any of `types` from `c`. */
const loses = (c: CustomCategory, types: string[]) => c.types.some(t => types.includes(t));

/** `c` without `types`, retaining empty parents of child categories. */
function without(c: CustomCategory, types: string[], names: string[] = []): CustomCategory[] {
  const rest = c.types.filter(t => !types.includes(t));
  return rest.length || names.some(name => name.startsWith(`${c.name} - `))
    ? [{ ...c, types: rest }]
    : [];
}

/** Categories nested under the lot's site category first, then A–Z. */
export function sortCategoryChoices(cats: CustomCategory[], siteLabel: string): CustomCategory[] {
  const near = (c: CustomCategory) => c.name.startsWith(`${siteLabel} - `);
  return cats.toSorted((a, b) => +near(b) - +near(a) || collator.compare(a.name, b.name));
}

export function defaultCategoryName(
  type: string,
  currentCategoryName: string | undefined,
  siteLabel: string,
): string {
  const parent = currentCategoryName ?? siteLabel;
  return parent ? `${parent} - ${categoryName(type)}` : categoryName(type);
}

/** Other item types sharing a word with `type`, those sharing its head word first. */
export function findSimilarTypes(lots: Lot[], type: string) {
  const words = typeWords(type);
  const head = words.at(-1);
  const counts = Map.groupBy(
    lots.filter(
      l => l.itemType && l.itemType !== type && typeWords(l.itemType).some(w => words.includes(w)),
    ),
    l => l.itemType!,
  );
  return counts
    .entries()
    .map(([t, ls]) => ({ t, count: ls.length, head: typeWords(t).at(-1) === head }))
    .toArray()
    .toSorted((a, b) => +b.head - +a.head || b.count - a.count || a.t.localeCompare(b.t))
    .slice(0, SIMILAR_LIMIT);
}

/** Compute the resulting custom categories and matched lots for TypeCategory. */
export function planTypeCategory({
  cats,
  mode,
  existing,
  name,
  type,
  extra,
  lots,
}: {
  cats: CustomCategory[];
  mode: 'new' | 'add';
  existing: CustomCategory | undefined;
  name: string;
  type: string;
  extra: string[];
  lots: Lot[];
}) {
  const types = [type, ...extra];
  const losing = cats.filter(c => c !== existing && loses(c, types));
  const names = [
    ...cats
      .filter(c => !losing.includes(c) || c.types.some(t => !types.includes(t)))
      .map(c => c.name),
    ...(mode === 'new' ? [name.trim()] : []),
  ];
  const next = cats.flatMap(c => {
    if (c === existing) {
      return [{ ...c, types: [...c.types, ...types].toUnique() }];
    }
    return losing.includes(c) ? without(c, types, names) : [c];
  });
  if (mode === 'new') {
    next.push({ name: name.trim(), types });
  }
  let target = -1;
  if (existing) {
    target = next.findIndex(c => c.name === existing.name);
  } else if (mode === 'new') {
    target = next.length - 1;
  }
  const compiled = compileCategories(next);
  const taken = target < 0 ? [] : lots.filter(l => categoryIndex(l, compiled) === target);
  return { next, target, taken, losing, types };
}

// ---------------------------------------------------------------------------
// Propagating category renames/deletes across saved settings
// ---------------------------------------------------------------------------

export interface CategorySettingsSnapshot {
  customCategories: CustomCategory[];
  lastCategory: string | null;
  view: unknown;
  defaultFilters: DefaultFilters;
  savedSearches: SavedSearch[];
}

export interface CategorySettingsUpdates {
  lastCategory?: string | null;
  view?: ViewState;
  defaultFilters?: DefaultFilters;
  savedSearches?: SavedSearch[];
}

/** Compute setting updates needed when custom categories are renamed or removed. */
export function computeCategoryUpdates(
  categories: CustomCategory[],
  renames: ReadonlyMap<string, string | null>,
  snapshot: CategorySettingsSnapshot,
): CategorySettingsUpdates {
  const names = categories.map(c => c.name).toSet();
  const changes = new Map<string, string | null>(
    snapshot.customCategories.filter(c => !names.has(c.name)).map(c => [c.name, null] as const),
  );
  for (const [from, to] of renames) {
    if (from !== to) {
      changes.set(from, to);
    }
  }
  if (!changes.size) {
    return {};
  }

  const updates: CategorySettingsUpdates = {};
  if (snapshot.lastCategory != null && changes.has(snapshot.lastCategory)) {
    updates.lastCategory = changes.get(snapshot.lastCategory) ?? null;
  }

  const byValue = new Map(
    changes
      .entries()
      .map(([from, to]) => [
        customCategoryValue(from),
        to == null ? null : customCategoryValue(to),
      ]),
  );
  const fix = (cats: string[]) =>
    cats.flatMap(v => {
      const next = byValue.get(v);
      if (next === undefined) {
        return [v];
      }
      return next === null ? [] : [next];
    });

  if (snapshot.view != null) {
    const view = normalizeView(snapshot.view);
    updates.view = { ...view, categories: fix(view.categories) };
  }

  const defaultCategories = fix(snapshot.defaultFilters.categories);
  if (!dequal(defaultCategories, snapshot.defaultFilters.categories)) {
    updates.defaultFilters = { ...snapshot.defaultFilters, categories: defaultCategories };
  }

  updates.savedSearches = snapshot.savedSearches.map(s => ({
    ...s,
    view: { ...s.view, categories: fix(normalizeView(s.view).categories) },
  }));

  return updates;
}
