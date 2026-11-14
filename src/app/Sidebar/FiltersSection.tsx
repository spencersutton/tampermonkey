// oxlint-disable typescript/no-unsafe-type-assertion
import { KEYS } from '../../shared/keys';
import { siteConditions } from '../conditions';
import { Icon } from '../icons';
import { getSetting } from '../settings';
import { closed, modalActions, openClosed, setView } from '../state';
import { fmtCount, parseNum } from '../util';
import {
  activeFilterCount,
  defaultFilterView,
  DEFAULT_VIEW,
  ENDING,
  MINE,
  sameDefaultFilters,
  sameFilters,
  type Facet,
  type Facets,
  type ViewState,
} from '../view';
import { CategoryList } from './CategoryList';
import { Collapsible } from './Collapsible';
import { saveFilterDefaults } from './filterShortcuts';
import { NumberInput } from './NumberInput';

/** A checkbox per facet value with its lot count; checking none means no filter. */
function CheckList<T>(props: {
  facets: Facet<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  titleOf?: (v: T) => string | undefined;
}) {
  const { facets, selected, onChange, titleOf } = props;
  const toggle = (v: T) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <>
      {facets.map((f) => (
        <label class="check" title={titleOf?.(f.value)}>
          <input
            type="checkbox"
            checked={selected.includes(f.value)}
            onChange={() => toggle(f.value)}
          />
          <span>{f.label}</span>
          <span class="count">{fmtCount(f.count)}</span>
        </label>
      ))}
    </>
  );
}

/** Dollar amount; empty means no limit (null). */
function PriceField(props: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <NumberInput {...props} parse={parseNum} type="text" inputMode="decimal" placeholder="$" />
  );
}

interface Props {
  view: ViewState;
  facets: Facets;
  pickup: string;
  authed: boolean;
}

/** Search, category, condition, location, price, ending and "my lots" filters. */
export function FiltersSection({ view, facets, pickup, authed }: Props) {
  const n = activeFilterCount(view);
  const defaults = getSetting(KEYS.defaultFilters);
  const reset = defaultFilterView(defaults, view.sort);
  const canDefault =
    view.newSince != null ||
    !sameDefaultFilters(view, defaults) ||
    !sameFilters(
      {
        ...view,
        categories: reset.categories,
        noCategories: reset.noCategories,
        conditions: reset.conditions,
      },
      reset,
    );
  const conditions = siteConditions();
  const custom = getSetting(KEYS.customCategories);
  const customCount = custom.length;
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Filters</h2>
        <button type="button" class="btn-text" onClick={() => setView(DEFAULT_VIEW)}>
          Clear
        </button>
        {canDefault && (
          <button type="button" class="btn-text" onClick={() => setView(reset)}>
            Default{n > 0 ? ` (${n})` : ''}
          </button>
        )}
      </div>

      <label class="field">
        <span>My lots</span>
        {/* Picking one of my lots clears the other filters so none of them hide it. */}
        <select
          value={view.mine}
          onChange={(e) => {
            const mine = e.currentTarget.value as ViewState['mine'];
            setView(mine ? { ...DEFAULT_VIEW, sort: view.sort, mine } : { mine });
          }}
        >
          {Object.entries(MINE).map(([k, { label }]) => (
            <option value={k} disabled={Boolean(k) && !authed}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div class="closed-links">
        <span class="muted">Closed:</span>
        {(['won', 'lost'] as const).map((s) => (
          <button
            type="button"
            class={`btn-text ${closed.value === s ? 'on' : ''}`}
            aria-pressed={closed.value === s}
            disabled={!authed}
            onClick={() => openClosed(s)}
          >
            {s === 'won' ? 'Won' : 'Lost'}
          </button>
        ))}
      </div>

      <label class="field">
        <span>Ending</span>
        <select
          value={view.ending}
          onChange={(e) => setView({ ending: e.currentTarget.value as ViewState['ending'] })}
        >
          {Object.entries(ENDING).map(([k, { label }]) => (
            <option value={k}>{label}</option>
          ))}
        </select>
      </label>

      <Collapsible id="f-location" title="Location">
        <CheckList
          facets={facets.locations}
          selected={view.locations}
          onChange={(locations) => setView({ locations })}
        />
        <label class="check">
          <input
            type="checkbox"
            checked={view.reachable}
            onChange={() => setView({ reachable: !view.reachable })}
          />
          <span>Available at {pickup} (incl. transfers)</span>
        </label>
      </Collapsible>

      <Collapsible id="f-category" title="Category">
        {view.noCategories && (
          <div>
            <p class="muted">No categories selected.</p>
            <button
              type="button"
              class="btn-text"
              onClick={() => setView({ categories: [], noCategories: false })}
            >
              Show all categories
            </button>
          </div>
        )}
        <CategoryList
          facets={facets}
          selected={view.categories}
          onChange={(categories) => setView({ categories, noCategories: false })}
        />
        <button type="button" class="btn-text cat-edit-btn" onClick={modalActions.editCategories}>
          <Icon name="edit" size={16} />{' '}
          {customCount ? `Edit custom categories (${customCount})` : 'Add custom categories'}
        </button>
      </Collapsible>

      <Collapsible id="f-condition" title="Condition">
        <CheckList
          facets={facets.conditions}
          selected={view.conditions}
          onChange={(conditions) => setView({ conditions })}
          titleOf={(v) => conditions.get(v)?.description}
        />
        {conditions.size > 0 && (
          <details class="about-conditions">
            <summary>About conditions</summary>
            <dl>
              {[...conditions.values()].map((c) => (
                <div>
                  <dt>{c.label}</dt>
                  <dd>{c.description}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </Collapsible>

      <button
        type="button"
        class="btn-text default-filters-btn"
        aria-keyshortcuts="Alt+Shift+D"
        disabled={sameDefaultFilters(view, defaults)}
        onClick={saveFilterDefaults}
        title="Save the current category and condition selections as defaults (Alt+Shift+D)"
      >
        Save category &amp; condition defaults
      </button>

      <Collapsible id="f-price" title="Price">
        <div class="field-row">
          <PriceField
            label="Bid min"
            value={view.priceMin}
            onChange={(priceMin) => setView({ priceMin })}
          />
          <PriceField
            label="Bid max"
            value={view.priceMax}
            onChange={(priceMax) => setView({ priceMax })}
          />
        </div>
        <div class="field-row">
          <PriceField
            label="Max est. total"
            value={view.totalMax}
            onChange={(totalMax) => setView({ totalMax })}
          />
          <PriceField
            label="Min retail"
            value={view.retailMin}
            onChange={(retailMin) => setView({ retailMin })}
          />
        </div>
      </Collapsible>
    </section>
  );
}
