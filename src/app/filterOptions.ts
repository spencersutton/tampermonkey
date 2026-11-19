import { isNoneTag, parseTag, toLower } from '../shared/tags';
import { numericLabel } from './util';
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
  return [...options.values()];
}

export function toggleFilterOption(selected: string[], values: string[]): string[] {
  return values.some(value => selected.includes(value))
    ? selected.filter(value => !values.includes(value))
    : [...selected, ...values];
}
