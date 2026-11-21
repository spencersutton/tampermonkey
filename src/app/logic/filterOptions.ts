import { numericOrder } from './util';
import type { Facet } from './view';

export interface FilterOption extends Facet<string> {
  values: string[];
}

export function toggleFilterOption(selected: string[], values: string[]): string[] {
  return values.some(value => selected.includes(value))
    ? selected.filter(value => !values.includes(value))
    : [...selected, ...values];
}

/** Whether the brand menu shows: more than one brand among the results, or one picked. */
export function showBrandMenu(brands: Facet<string>[], selected: string[]): boolean {
  return selected.length > 0 || brands.filter(f => f.count > 0).length > 1;
}

/** Whether any filter menu shows for the given view selections and sidebar facets. */
export function hasFilterMenusFor(
  facets: { brands: Facet<string>[] },
  selected: { brands: string[] },
): boolean {
  return showBrandMenu(facets.brands, selected.brands);
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
