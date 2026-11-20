// Above the grid, as on a shop's results page: the spelling correction used
// for a search that matched nothing, a removable chip per active filter, and
// the item types among the results to narrow by in one click.
import * as format from '../../shared/format';
import { chipsFor, type Chip } from '../logic/refinements';
import { DEFAULT_VIEW } from '../logic/view';
import { FilterMenus, hasFilterMenus } from './FilterMenus';
import { Icon } from './icons';
import { filterFacets, gridView, pickupName, setView, sidebarFacets, storedView } from './state';

const MAX_TYPE_PILLS = 10;

export function Refinements() {
  const view = storedView.value;
  const result = gridView.value;
  const chips = chipsFor(view, filterFacets.value, pickupName.value);
  const isCategory = (c: Chip) => c.key.startsWith('cat:');
  const isExcludedType = (c: Chip) => c.key.startsWith('exType:');
  const catChips = chips.filter(isCategory);
  const exTypeChips = chips.filter(isExcludedType);
  const otherChips = chips.filter(c => !isCategory(c) && !isExcludedType(c));
  const chipButton = (c: Chip) => (
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
  );
  const types = view.types.length ? [] : sidebarFacets.value.types.slice(0, MAX_TYPE_PILLS);
  const showTypes = result.rows.length > 0 && types.length > 1;
  const showMenus = hasFilterMenus();
  if (!result.correctedSearch && !chips.length && !showTypes && !showMenus) {
    return null;
  }
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
      {catChips.length > 0 && (
        // Hiding categories can select dozens, so they share one row that scrolls sideways.
        <div class="chips chips-scroll" aria-label="Category filters">
          {catChips.map(chipButton)}
        </div>
      )}
      {exTypeChips.length > 0 && (
        // Hiding item types can accumulate dozens, so they share one row that scrolls sideways.
        <div class="chips chips-scroll" aria-label="Hidden item types">
          {exTypeChips.map(chipButton)}
        </div>
      )}
      {(otherChips.length > 0 || chips.length > 1) && (
        <div class="chips" aria-label="Active filters">
          {otherChips.map(chipButton)}
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
          {types.map(t => (
            <button
              type="button"
              key={t.value}
              class="type-pill"
              onClick={() => setView({ types: [t.value] })}
            >
              {t.label} <span class="count">{format.num(t.count)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
