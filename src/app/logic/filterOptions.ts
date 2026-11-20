import { isNoneTag, parseTag, tagGroup, toLower } from '../../shared/tags';
import { numericLabel, numericOrder } from './util';
import type { Facet } from './view';

export interface FilterOption extends Facet<string> {
  values: string[];
}

export function numericTagKey(tag: string): string | null {
  const { name, value } = parseTag(tag);
  const label = numericLabel(value);
  return label == null ? null : toLower(name ? `${name}: ${label}` : label);
}

/** Merge numeric spellings only when every non-"None" value in this menu is numeric. */
export function tagMenuOptions(
  facets: Facet<string>[],
  numericCounts: Map<string, number>,
  allFacets: Facet<string>[] = facets,
): FilterOption[] {
  const values = facets.filter(f => !isNoneTag(f.value));
  if (!values.length || values.some(f => numericTagKey(f.value) == null)) {
    return facets.map(f => ({ ...f, values: [f.value] }));
  }
  const options = new Map<string, FilterOption>();
  for (const facet of facets) {
    const key = numericTagKey(facet.value) ?? facet.value;
    const existing = options.get(key);
    if (existing) {
      existing.values.push(facet.value);
    } else {
      const { name, value } = parseTag(facet.label);
      const label = numericLabel(value);
      let display = facet.label;
      if (label != null) {
        display = name ? `${name}: ${label}` : label;
      }
      options.set(key, {
        value: key,
        label: display,
        count: label == null ? facet.count : (numericCounts.get(key) ?? 0),
        values: [facet.value],
      });
    }
  }
  // Keep equivalent spellings selected even if another filter currently hides their lots.
  for (const facet of allFacets) {
    const key = numericTagKey(facet.value);
    const option = key == null ? undefined : options.get(key);
    if (option && !option.values.includes(facet.value)) {
      option.values.push(facet.value);
    }
  }
  return options.values().toArray();
}

export function toggleFilterOption(selected: string[], values: string[]): string[] {
  return values.some(value => selected.includes(value))
    ? selected.filter(value => !values.includes(value))
    : [...selected, ...values];
}

/** Tag facets by group, plain tags ('') last and attributes alphabetically. */
function groupedTagFacets(tags: Facet<string>[]): [string, Facet<string>[]][] {
  return Map.groupBy(tags, f => tagGroup(f.value))
    .entries()
    .toArray()
    .toSorted(([a], [b]) => +!a - +!b || a.localeCompare(b));
}

/** Whether the brand menu shows: more than one brand among the results, or one picked. */
export function showBrandMenu(brands: Facet<string>[], selected: string[]): boolean {
  return selected.length > 0 || brands.filter(f => f.count > 0).length > 1;
}

/** Tag groups with values among the results, or a selection. */
export function tagGroups(tags: Facet<string>[], selected: string[]) {
  return groupedTagFacets(tags).filter(([, facets]) =>
    facets.some(f => (f.count > 0 && !isNoneTag(f.value)) || selected.includes(f.value)),
  );
}

/** Whether any filter menu shows for the given view selections and sidebar facets. */
export function hasFilterMenusFor(
  facets: { brands: Facet<string>[]; tags: Facet<string>[] },
  selected: { brands: string[]; tags: string[] },
): boolean {
  return (
    showBrandMenu(facets.brands, selected.brands) ||
    tagGroups(facets.tags, selected.tags).length > 0
  );
}

/** Order filter menu options: numerically when all non-None values are numbers, with "None" last. */
export function orderFilterOptions(
  facets: FilterOption[],
  isNone: (value: string) => boolean,
  valueLabel: (f: FilterOption) => string,
): FilterOption[] {
  const values = facets.filter(f => !isNone(f.value));
  return [...(numericOrder(values, valueLabel) ?? values), ...facets.filter(f => isNone(f.value))];
}
