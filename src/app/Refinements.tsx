// Above the grid, as on a shop's results page: the spelling correction used
// for a search that matched nothing, a removable chip per active filter, and
// the item types among the results to narrow by in one click.
import { tagLabel } from '../shared/tags';
import { FilterMenus, hasFilterMenus } from './FilterMenus';
import { Icon } from './icons';
import { groupCategories, groupFacets, type CategoryGroup } from './Sidebar/CategoryList';
import { filterFacets, gridView, pickupName, setView, sidebarFacets, storedView } from './state';
import { fmtCount } from './util';
import { DEFAULT_VIEW, ENDING, MINE, type ViewState } from './view';

interface Chip {
  key: string;
  label: string;
  remove: Partial<ViewState>;
}

const MAX_TYPE_PILLS = 10;

/** One chip per active filter, each removing just that selection. */
function chipsFor(v: ViewState, pickup: string): Chip[] {
  const facets = filterFacets.value;
  const labelOf = <T,>(list: { value: T; label: string }[], value: T) =>
    list.find((f) => f.value === value)?.label ?? String(value);
  const without = <T,>(list: T[], value: T) => list.filter((x) => x !== value);
  const money = (n: number) => `$${fmtCount(n)}`;
  const chips: Chip[] = [];
  if (v.search.trim()) {
    chips.push({ key: 'search', label: `“${v.search.trim()}”`, remove: { search: '' } });
  }
  if (v.noCategories) {
    chips.push({
      key: 'nocat',
      label: 'No categories',
      remove: { categories: [], noCategories: false },
    });
  }
  // Hiding a category selects all the others, so when most are selected show a chip per
  // excluded category instead; removing one puts that category back.
  const selected = new Set(v.categories);
  const known = facets.categories.map((f) => f.value);
  const excluding =
    !v.noCategories &&
    known.length > 1 &&
    known.filter((x) => selected.has(x)).length > known.length / 2;
  // A parent category gets one chip only when it and all its subcategories are in the set;
  // otherwise each subcategory gets its own.
  const pending = new Set(excluding ? known.filter((x) => !selected.has(x)) : v.categories);
  const categoryChip = (value: string, label: string, values: string[]) => {
    const taken = values.filter((x) => pending.has(x));
    for (const x of taken) pending.delete(x);
    chips.push(
      excluding
        ? {
            key: `notcat:${value}`,
            label: `Not ${label}`,
            remove: {
              // Back to no category filter once nothing is excluded.
              categories: known.every((x) => selected.has(x) || taken.includes(x))
                ? []
                : [...v.categories, ...taken],
            },
          }
        : {
            key: `cat:${value}`,
            label,
            remove: { categories: v.categories.filter((x) => !values.includes(x)) },
          },
    );
  };
  const addGroup = (g: CategoryGroup) => {
    const { value } = g.facet;
    const full = labelOf([...facets.categories, ...facets.siteCategories], value);
    // When excluding, a site category with no lots of its own isn't among the known ones and
    // can't be excluded, so it mustn't stop its fully excluded subcategories sharing one chip.
    const values = groupFacets(g)
      .map((f) => f.value)
      .filter((x) => !excluding || known.includes(x));
    if (!g.subs.length || values.every((x) => pending.has(x))) {
      if (values.length && values.every((x) => pending.has(x))) {
        categoryChip(value, full, values);
      }
      return;
    }
    if (pending.has(value)) categoryChip(value, `${full} (other)`, [value]);
    g.subs.forEach(addGroup);
  };
  groupCategories(facets).forEach(addGroup);
  // Selections no longer among the lots' categories.
  for (const c of pending) categoryChip(c, labelOf(facets.categories, c), [c]);
  for (const t of v.types) {
    chips.push({ key: `type:${t}`, label: t, remove: { types: without(v.types, t) } });
  }
  for (const b of v.brands) {
    chips.push({
      key: `brand:${b}`,
      label: labelOf(facets.brands, b),
      remove: { brands: without(v.brands, b) },
    });
  }
  for (const t of v.tags) {
    chips.push({
      key: `tag:${t}`,
      label: tagLabel(labelOf(facets.tags, t)),
      remove: { tags: without(v.tags, t) },
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
    if (v.priceMin == null) label = `Bid ≤ ${money(v.priceMax ?? 0)}`;
    else if (v.priceMax == null) label = `Bid ≥ ${money(v.priceMin)}`;
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

export function Refinements() {
  const view = storedView.value;
  const result = gridView.value;
  const chips = chipsFor(view, pickupName.value);
  const types = view.types.length ? [] : sidebarFacets.value.types.slice(0, MAX_TYPE_PILLS);
  const showTypes = result.rows.length > 0 && types.length > 1;
  const showMenus = hasFilterMenus();
  if (!result.correctedSearch && !chips.length && !showTypes && !showMenus) return null;
  return (
    <div class="refinements">
      {result.correctedSearch && (
        <p class="did-you-mean" role="status">
          No lots match <strong>“{view.search.trim()}”</strong>. Showing results for{' '}
          <button
            type="button"
            class="btn-text"
            title="Search for this instead"
            onClick={() => setView({ search: result.correctedSearch ?? '' })}
          >
            “{result.correctedSearch}”
          </button>
          .
        </p>
      )}
      {chips.length > 0 && (
        <div class="chips" aria-label="Active filters">
          {chips.map((c) => (
            <button
              type="button"
              key={c.key}
              class="chip"
              title={`Remove filter: ${c.label}`}
              onClick={() => setView(c.remove)}
            >
              <span>{c.label}</span>
              <Icon name="close" size={14} />
            </button>
          ))}
          {chips.length > 1 && (
            <button
              type="button"
              class="btn-text chips-clear"
              onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort })}
            >
              Clear all
            </button>
          )}
        </div>
      )}
      {showMenus && <FilterMenus />}
      {showTypes && (
        <div class="type-pills" aria-label="Narrow by item type">
          <span class="muted">Item type:</span>
          {types.map((t) => (
            <button
              type="button"
              key={t.value}
              class="type-pill"
              onClick={() => setView({ types: [t.value] })}
            >
              {t.label} <span class="count">{fmtCount(t.count)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
