import * as format from '../../shared/format';
import { groupCategories, groupFacets, type CategoryGroup } from './categories';
import { ENDING, MINE, type Facets, type ViewState } from './view';
import '../../shared/arrayToSet';

export interface Chip {
  key: string;
  label: string;
  remove: Partial<ViewState>;
}

/** One chip per active filter, each removing just that selection. */
export function chipsFor(v: ViewState, facets: Facets, pickup: string): Chip[] {
  const labelOf = <T>(list: { value: T; label: string }[], value: T) =>
    list.find(f => f.value === value)?.label ?? String(value);
  const without = <T>(list: T[], value: T) => list.filter(x => x !== value);
  const money = (n: number) => `$${format.num(n)}`;
  const chips: Chip[] = [];
  if (v.search.trim()) {
    chips.push({ key: 'search', label: `“${v.search.trim()}”`, remove: { search: '' } });
  }
  // A parent category gets one chip only when all its subcategories are selected;
  // otherwise each selected subcategory gets its own.
  const pending = v.categories.toSet();
  const categoryChip = (value: string, label: string, values: string[]) => {
    for (const x of values) {
      pending.delete(x);
    }
    chips.push({
      key: `cat:${value}`,
      label,
      remove: { categories: v.categories.filter(x => !values.includes(x)) },
    });
  };
  const addGroup = (g: CategoryGroup) => {
    const { value } = g.facet;
    const full = labelOf([...facets.categories, ...facets.siteCategories], value);
    const values = groupFacets(g).map(f => f.value);
    if (!g.subs.length || values.every(x => pending.has(x))) {
      if (pending.has(value)) {
        categoryChip(value, full, values);
      }
      return;
    }
    if (pending.has(value)) {
      categoryChip(value, `${full} (other)`, [value]);
    }
    g.subs.forEach(addGroup);
  };
  groupCategories(facets).forEach(addGroup);
  // Selections no longer among the lots' categories.
  for (const c of pending) {
    categoryChip(c, labelOf(facets.categories, c), [c]);
  }
  for (const t of v.types) {
    chips.push({ key: `type:${t}`, label: t, remove: { types: without(v.types, t) } });
  }
  for (const t of v.excludedTypes) {
    chips.push({
      key: `exType:${t}`,
      label: `Hide: ${t}`,
      remove: { excludedTypes: without(v.excludedTypes, t) },
    });
  }
  for (const b of v.brands) {
    chips.push({
      key: `brand:${b}`,
      label: labelOf(facets.brands, b),
      remove: { brands: without(v.brands, b) },
    });
  }
  for (const a of v.attrs) {
    const group = facets.attrs.find(g => g.facets.some(f => f.value === a));
    const item = group?.facets.find(f => f.value === a);
    chips.push({
      key: `attr:${a}`,
      label: group && item ? `${group.label}: ${item.label}` : a,
      remove: { attrs: without(v.attrs, a) },
    });
  }
  for (const c of v.conditions) {
    chips.push({
      key: `cond:${c}`,
      label: labelOf(facets.conditions, c),
      remove: { conditions: without(v.conditions, c) },
    });
  }
  for (const l of v.locations) {
    chips.push({ key: `loc:${l}`, label: l, remove: { locations: without(v.locations, l) } });
  }
  if (v.reachable) {
    chips.push({ key: 'reach', label: `Available at ${pickup}`, remove: { reachable: false } });
  }
  if (v.priceMin != null || v.priceMax != null) {
    let label = `Bid ${money(v.priceMin ?? 0)} – ${money(v.priceMax ?? 0)}`;
    if (v.priceMin == null) {
      label = `Bid ≤ ${money(v.priceMax ?? 0)}`;
    } else if (v.priceMax == null) {
      label = `Bid ≥ ${money(v.priceMin)}`;
    }
    chips.push({ key: 'price', label, remove: { priceMin: null, priceMax: null } });
  }
  if (v.totalMax != null) {
    chips.push({ key: 'total', label: `Total ≤ ${money(v.totalMax)}`, remove: { totalMax: null } });
  }
  if (v.retailMin != null) {
    chips.push({
      key: 'retail',
      label: `Retail ≥ ${money(v.retailMin)}`,
      remove: { retailMin: null },
    });
  }
  if (v.ending) {
    chips.push({
      key: 'ending',
      label: `Ending ${ENDING[v.ending].label.toLowerCase()}`,
      remove: { ending: '' },
    });
  }
  if (v.mine) {
    chips.push({ key: 'mine', label: MINE[v.mine].label, remove: { mine: '' } });
  }
  return chips;
}
