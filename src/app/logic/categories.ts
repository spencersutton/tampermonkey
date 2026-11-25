import type { CustomCategory } from '../../shared/keys';
import type { Lot } from '../../shared/lot';
import { collator } from '../../shared/sortKey';
import '../../shared/arrayToSet';
import {
  categoryIndex,
  categoryPath,
  compareCategoryNames,
  compileCategories,
  customCategoryValue,
  isCustomCategory,
  normalizeView,
  type Facet,
  type Facets,
  type SavedSearch,
  type ViewState,
} from './view';

/** Generate a short unique id for a new custom category. */
export function newCategoryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Unique site categories present in `lots`, sorted A–Z by label. */
export function siteCategoriesFromLots(lots: readonly Lot[]): { value: string; label: string }[] {
  const byValue = new Map<string, string>();
  for (const lot of lots) {
    if (!byValue.has(lot.category.value)) {
      byValue.set(lot.category.value, lot.category.label);
    }
  }
  return Array.from(byValue, ([value, label]) => ({ value, label })).toSorted((a, b) =>
    collator.compare(a.label, b.label),
  );
}

// ---------------------------------------------------------------------------
// Category tree grouping
// ---------------------------------------------------------------------------

/** A category filter row, with its child custom categories nested under it. */
export interface CategoryGroup {
  facet: Facet<string>;
  subs: CategoryGroup[];
}

/** Whether `target` is `node` or an ancestor of `node` via `parentOf`, preventing cycles. */
function isAncestorOrSelf(
  node: string,
  target: string,
  parentOf: (v: string) => string | undefined,
): boolean {
  let cur: string | undefined = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === target) {
      return true;
    }
    seen.add(cur);
    cur = parentOf(cur);
  }
  return false;
}

/** Nest custom categories under their declared parent site or custom category. */
export function groupCategories({ categories, siteCategories }: Facets): CategoryGroup[] {
  const all = new Map(
    [...siteCategories.map(f => ({ ...f, count: 0 })), ...categories].map(f => [f.value, f]),
  );
  const groups = new Map(
    all.entries().map(([value, facet]): [string, CategoryGroup] => [value, { facet, subs: [] }]),
  );
  const parentOf = (v: string) => all.get(v)?.parent;
  const top: CategoryGroup[] = [];
  for (const f of categories) {
    const group = groups.get(f.value)!;
    if (
      isCustomCategory(f.value) &&
      f.parent &&
      groups.has(f.parent) &&
      !isAncestorOrSelf(f.parent, f.value, parentOf)
    ) {
      groups.get(f.parent)!.subs.push(group);
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

// ---------------------------------------------------------------------------
// Category editor logic
// ---------------------------------------------------------------------------

/** A category being edited; `from` is its saved filter value (null if new). */
export interface CategoryDraft {
  key: number;
  id: string;
  from: string | null;
  name: string;
  parent: string | null;
  types: string[];
}

export const draftValue = (d: Pick<CategoryDraft, 'id'>) => customCategoryValue(d.id);

/** The category a draft saves as. */
export const clean = (
  d: Pick<CategoryDraft, 'id' | 'name' | 'parent' | 'types'>,
): CustomCategory => ({
  id: d.id,
  name: d.name.trim(),
  ...(d.parent ? { parent: d.parent } : {}),
  types: d.types,
});

/** Filter values of `value` and all its descendant drafts (for cycle prevention). */
export function descendantValues(
  value: string,
  drafts: readonly Pick<CategoryDraft, 'id' | 'parent'>[],
): Set<string> {
  const children = new Map<string, string[]>();
  for (const d of drafts) {
    if (d.parent) {
      children.getOrInsertComputed(d.parent, () => []).push(draftValue(d));
    }
  }
  const result = new Set<string>([value]);
  const stack = [value];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of children.get(cur) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        stack.push(child);
      }
    }
  }
  return result;
}

/** Remove `target` from `drafts`, reparenting its direct children to `target.parent`. */
export function removeDraft(drafts: CategoryDraft[], target: CategoryDraft): CategoryDraft[] {
  const targetVal = draftValue(target);
  return drafts
    .filter(x => x.key !== target.key)
    .map(x => (x.parent === targetVal ? { ...x, parent: target.parent } : x));
}

/** What's wrong with a category editor row, if anything. */
export function categoryDraftError(d: CategoryDraft, drafts: CategoryDraft[]): string | null {
  const name = d.name.trim();
  if (!name) {
    return 'Name is required';
  }
  const parent = d.parent ?? null;
  if (
    drafts.some(
      o =>
        o !== d &&
        (o.parent ?? null) === parent &&
        o.name.trim().toLowerCase() === name.toLowerCase(),
    )
  ) {
    return 'Another category under this parent has this name';
  }
  if (parent && descendantValues(draftValue(d), drafts).has(parent)) {
    return 'Category cannot be nested under itself';
  }
  return null;
}

export type EditorRow =
  | { kind: 'site'; value: string; label: string }
  | { kind: 'draft'; draft: CategoryDraft; depth: number };

/** Flatten drafts into visual tree order, grouping site-parented categories under site headers. */
export function buildEditorTree(
  drafts: readonly CategoryDraft[],
  siteCategories: readonly { value: string; label: string }[],
): EditorRow[] {
  const siteLabels = new Map(siteCategories.map(s => [s.value, s.label]));
  const byValue = new Map(drafts.map(d => [draftValue(d), d]));
  const parentOf = (v: string) => byValue.get(v)?.parent ?? undefined;

  const customChildren = new Map<string, CategoryDraft[]>();
  const siteChildren = new Map<string, CategoryDraft[]>();
  const rootDrafts: CategoryDraft[] = [];

  for (const d of drafts) {
    const val = draftValue(d);
    const p = d.parent;
    if (p && byValue.has(p) && !isAncestorOrSelf(p, val, parentOf)) {
      customChildren.getOrInsertComputed(p, () => []).push(d);
    } else if (p && !isCustomCategory(p)) {
      siteChildren.getOrInsertComputed(p, () => []).push(d);
    } else {
      rootDrafts.push(d);
    }
  }

  const sortDrafts = (list: CategoryDraft[]) =>
    list.toSorted((a, b) => compareCategoryNames(a.name, b.name) || a.key - b.key);

  const rows: EditorRow[] = [];
  const emitDraft = (d: CategoryDraft, depth: number) => {
    rows.push({ kind: 'draft', draft: d, depth });
    const kids = customChildren.get(draftValue(d));
    if (kids) {
      for (const kid of sortDrafts(kids)) {
        emitDraft(kid, depth + 1);
      }
    }
  };

  type TopItem =
    | { kind: 'site'; value: string; label: string; kids: CategoryDraft[] }
    | { kind: 'draft'; label: string; draft: CategoryDraft };

  const top: TopItem[] = [
    ...Array.from(siteChildren, ([value, kids]) => ({
      kind: 'site' as const,
      value,
      label: siteLabels.get(value) ?? value,
      kids,
    })),
    ...rootDrafts.map(draft => ({
      kind: 'draft' as const,
      label: draft.name,
      draft,
    })),
  ].toSorted((a, b) => compareCategoryNames(a.label, b.label));

  for (const item of top) {
    if (item.kind === 'site') {
      rows.push({ kind: 'site', value: item.value, label: item.label });
      for (const kid of sortDrafts(item.kids)) {
        emitDraft(kid, 1);
      }
    } else {
      emitDraft(item.draft, 0);
    }
  }
  return rows;
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

/**
 * Build the rename/delete map (keyed by custom category value) from initial categories and final
 * drafts.
 */
export function buildCategoryRenames(
  initial: CustomCategory[],
  drafts: CategoryDraft[],
): Map<string, string | null> {
  const renames = new Map<string, string | null>(initial.map(c => [customCategoryValue(c), null]));
  for (const d of drafts) {
    if (d.from != null) {
      renames.set(d.from, draftValue(d));
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
  parent: string | null = null,
): string | null {
  if (mode === 'add') {
    return existing ? null : 'Pick a category';
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Name is required';
  }
  if (
    cats.some(
      c =>
        (c.parent ?? null) === (parent ?? null) && c.name.toLowerCase() === trimmed.toLowerCase(),
    )
  ) {
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
function without(
  c: CustomCategory,
  types: string[],
  parentsInUse: ReadonlySet<string>,
): CustomCategory[] {
  const rest = c.types.filter(t => !types.includes(t));
  return rest.length || parentsInUse.has(customCategoryValue(c)) ? [{ ...c, types: rest }] : [];
}

/** Root site category value of `cat`, or null if top-level custom. */
export function rootSiteCategory(
  cat: CustomCategory,
  cats: readonly CustomCategory[],
): string | null {
  const byValue = new Map(cats.map(c => [customCategoryValue(c), c]));
  const seen = new Set([customCategoryValue(cat)]);
  let parent = cat.parent;
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const p = byValue.get(parent);
    if (!p) {
      return isCustomCategory(parent) ? null : parent;
    }
    parent = p.parent;
  }
  return null;
}

/** Categories nested under the lot's site category first, then A–Z by full path. */
export function sortCategoryChoices(
  cats: CustomCategory[],
  siteValue: string,
  siteLabels?: ReadonlyMap<string, string>,
): CustomCategory[] {
  const near = (c: CustomCategory) => rootSiteCategory(c, cats) === siteValue;
  return cats.toSorted(
    (a, b) =>
      +near(b) - +near(a) ||
      collator.compare(categoryPath(a, cats, siteLabels), categoryPath(b, cats, siteLabels)),
  );
}

export function defaultCategoryName(type: string): string {
  return categoryName(type);
}

export function defaultCategoryParent(
  current: CustomCategory | undefined,
  siteValue: string,
): string | null {
  return current ? customCategoryValue(current) : siteValue || null;
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
  parent = null,
  type,
  extra,
  lots,
}: {
  cats: CustomCategory[];
  mode: 'new' | 'add';
  existing: CustomCategory | undefined;
  name: string;
  parent?: string | null;
  type: string;
  extra: string[];
  lots: Lot[];
}) {
  const types = [type, ...extra];
  const losing = cats.filter(c => c !== existing && loses(c, types));
  const parentsInUse = new Set<string>();
  for (const c of cats) {
    if ((!losing.includes(c) || c.types.some(t => !types.includes(t))) && c.parent) {
      parentsInUse.add(c.parent);
    }
  }
  if (mode === 'new' && parent) {
    parentsInUse.add(parent);
  }
  const next = cats.flatMap(c => {
    if (c === existing) {
      return [{ ...c, types: [...c.types, ...types].toUnique() }];
    }
    return losing.includes(c) ? without(c, types, parentsInUse) : [c];
  });
  if (mode === 'new') {
    next.push({
      id: newCategoryId(),
      name: name.trim(),
      ...(parent ? { parent } : {}),
      types,
    });
  }
  let target = -1;
  if (existing) {
    const existingVal = customCategoryValue(existing);
    target = next.findIndex(c => customCategoryValue(c) === existingVal);
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
  savedSearches: SavedSearch[];
}

export interface CategorySettingsUpdates {
  lastCategory?: string | null;
  view?: ViewState;
  savedSearches?: SavedSearch[];
}

const toFilterValue = (v: string) => (isCustomCategory(v) ? v : customCategoryValue(v));

/** Compute setting updates needed when custom categories are renamed or removed. */
export function computeCategoryUpdates(
  categories: CustomCategory[],
  renames: ReadonlyMap<string, string | null>,
  snapshot: CategorySettingsSnapshot,
): CategorySettingsUpdates {
  const values = categories.map(customCategoryValue).toSet();
  const byValue = new Map<string, string | null>(
    snapshot.customCategories
      .map(customCategoryValue)
      .filter(v => !values.has(v))
      .map(v => [v, null] as const),
  );
  for (const [from, to] of renames) {
    const fromVal = toFilterValue(from);
    const toVal = to == null ? null : toFilterValue(to);
    if (fromVal !== toVal) {
      byValue.set(fromVal, toVal);
    }
  }
  if (!byValue.size) {
    return {};
  }

  const updates: CategorySettingsUpdates = {};
  if (snapshot.lastCategory != null) {
    const lastVal = toFilterValue(snapshot.lastCategory);
    if (byValue.has(lastVal)) {
      updates.lastCategory = byValue.get(lastVal) ?? null;
    }
  }

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

  updates.savedSearches = snapshot.savedSearches.map(s => ({
    ...s,
    view: { ...s.view, categories: fix(normalizeView(s.view).categories) },
  }));

  return updates;
}
