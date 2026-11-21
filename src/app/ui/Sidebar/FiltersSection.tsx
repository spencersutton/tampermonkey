// oxlint-disable typescript/no-unsafe-type-assertion
import { useState } from 'preact/hooks';

import * as format from '../../../shared/format';
import { KEYS } from '../../../shared/keys';
import { categoryCollapseId, groupCategories, groupValues } from '../../logic/categories';
import { parseNum } from '../../logic/util';
import {
  DEFAULT_VIEW,
  ENDING,
  MINE,
  PRICE_BUCKETS,
  type Facet,
  type Facets,
  type ViewState,
} from '../../logic/view';
import { siteConditions } from '../../server/conditions';
import { useSetting } from '../../server/settings';
import { Icon } from '../icons';
import { closed, openClosed, setView } from '../state';
import { Collapsible } from './Collapsible';
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
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <>
      {facets.map(f => (
        <label
          class={`check ${f.count || selected.includes(f.value) ? '' : 'zero'}`}
          title={titleOf?.(f.value)}
        >
          <input
            type="checkbox"
            checked={selected.includes(f.value)}
            onChange={() => toggle(f.value)}
          />
          <span>{f.label}</span>
          <span class="count">{format.num(f.count)}</span>
        </label>
      ))}
    </>
  );
}

/**
 * A long facet (item types, brands): selected values first, then the most common, with a box to
 * find the rest.
 */
function FacetList(props: {
  name: string; // plural noun, e.g. "brands"
  facets: Facet<string>[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { name, facets, selected, onChange } = props;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const INITIAL = 8;
  const q = query.trim().toLowerCase();
  const picked = facets.filter(f => selected.includes(f.value));
  const rest = facets.filter(
    f => !selected.includes(f.value) && (!q || f.label.toLowerCase().includes(q)),
  );
  const shown = expanded || q ? rest : rest.slice(0, Math.max(0, INITIAL - picked.length));
  return (
    <>
      {facets.length > INITIAL && (
        <input
          class="facet-find"
          type="search"
          placeholder={`Find ${name}`}
          aria-label={`Find ${name}`}
          value={query}
          onInput={e => setQuery(e.currentTarget.value)}
        />
      )}
      <CheckList facets={[...picked, ...shown]} selected={selected} onChange={onChange} />
      {q && !rest.length && (
        <p class="muted small">
          No {name} match “{query.trim()}”.
        </p>
      )}
      {!q && rest.length > shown.length && (
        <button type="button" class="btn-text" onClick={() => setExpanded(true)}>
          Show {format.num(rest.length - shown.length)} more
        </button>
      )}
      {!q && expanded && rest.length > INITIAL && (
        <button type="button" class="btn-text" onClick={() => setExpanded(false)}>
          Show fewer
        </button>
      )}
    </>
  );
}

/** Collapsible, scrollable list of hidden item types, searchable once it grows long. */
function ExcludedTypeList(props: {
  excludedTypes: string[];
  onUnhide: (type: string) => void;
  onShowAll: () => void;
}) {
  const { excludedTypes, onUnhide, onShowAll } = props;
  const [collapsed, setCollapsed] = useSetting(KEYS.collapsed);
  const [query, setQuery] = useState('');
  const open = !collapsed['f-excluded-types'];
  const q = query.trim().toLowerCase();
  const sorted = excludedTypes.toSorted();
  const shown = q ? sorted.filter(t => t.toLowerCase().includes(q)) : sorted;
  return (
    <div class="excluded-types">
      <div class="excluded-types-head">
        <button
          type="button"
          class="excluded-types-toggle"
          aria-expanded={open}
          onClick={() => setCollapsed({ ...collapsed, 'f-excluded-types': open })}
        >
          <Icon name="expandMore" size={16} />
          <span class="muted small">Hidden ({excludedTypes.length})</span>
        </button>
        <button type="button" class="btn-text" onClick={onShowAll}>
          Show all
        </button>
      </div>
      {open && (
        <>
          {excludedTypes.length > 8 && (
            <input
              class="facet-find"
              type="search"
              placeholder="Find hidden types"
              aria-label="Find hidden item types"
              value={query}
              onInput={e => setQuery(e.currentTarget.value)}
            />
          )}
          {shown.length > 0 ? (
            <ul class="filter-list excluded-types-list">
              {shown.map(t => (
                <li key={t} class="filter-row">
                  <button
                    type="button"
                    class="filter-remove"
                    aria-label={`Unhide item type ${t}`}
                    title={`Unhide item type: ${t}`}
                    onClick={() => onUnhide(t)}
                  >
                    <Icon name="cancel" size={16} />
                  </button>
                  <span class="filter-pattern">{t}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="muted small">No hidden item types match “{query.trim()}”.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Two-level collapsible category tree: parents toggle all subcategories at once. */
function CategoryTree(props: {
  facets: Facet<string>[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { facets, selected, onChange } = props;
  const [collapsed, setCollapsed] = useSetting(KEYS.collapsed);
  const groups = groupCategories(facets);

  return (
    <div class="cat-tree">
      {groups.map(g => {
        const values = groupValues(g);
        const selectedCount = values.filter(v => selected.includes(v)).length;
        const allSelected = values.length > 0 && selectedCount === values.length;
        const someSelected = selectedCount > 0 && !allSelected;
        const toggleGroup = () => {
          if (allSelected) {
            onChange(selected.filter(v => !values.includes(v)));
          } else {
            onChange([...new Set([...selected, ...values])]);
          }
        };

        if (g.subs.length === 0) {
          return (
            <label key={g.id} class={`check cat-leaf ${g.count || allSelected ? '' : 'zero'}`}>
              <input type="checkbox" checked={allSelected} onChange={toggleGroup} />
              <span>{g.label}</span>
              <span class="count">{format.num(g.count)}</span>
            </label>
          );
        }

        const cid = categoryCollapseId(g.id);
        const open = collapsed[cid] === false;
        return (
          <div key={g.id} class="cat-group">
            <div class="cat-parent">
              <button
                type="button"
                class="cat-toggle"
                aria-expanded={open}
                aria-label={`${open ? 'Collapse' : 'Expand'} ${g.label}`}
                onClick={() => setCollapsed({ ...collapsed, [cid]: open })}
              >
                <Icon name="expandMore" size={16} />
              </button>
              <label class={`check ${g.count || selectedCount > 0 ? '' : 'zero'}`}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => {
                    if (el) {
                      el.indeterminate = someSelected;
                    }
                  }}
                  onChange={toggleGroup}
                />
                <span>{g.label}</span>
                <span class="count">{format.num(g.count)}</span>
              </label>
            </div>
            {open && (
              <div class="cat-subs">
                <CheckList facets={g.subs} selected={selected} onChange={onChange} />
              </div>
            )}
          </div>
        );
      })}
    </div>
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
  const conditions = siteConditions();
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Filters</h2>
        <button type="button" class="btn-text" onClick={() => setView(DEFAULT_VIEW)}>
          Clear
        </button>
      </div>

      <label class="field">
        <span>My lots</span>
        {/* Picking one of my lots clears the other filters so none of them hide it. */}
        <select
          value={view.mine}
          onChange={e => {
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
        {(['won', 'lost'] as const).map(s => (
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
          onChange={e => setView({ ending: e.currentTarget.value as ViewState['ending'] })}
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
          onChange={locations => setView({ locations })}
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
        <CategoryTree
          facets={facets.categories}
          selected={view.categories}
          onChange={categories => setView({ categories })}
        />
      </Collapsible>

      {(facets.types.length > 0 || view.types.length > 0 || view.excludedTypes.length > 0) && (
        <Collapsible id="f-type" title="Item type">
          <FacetList
            name="item types"
            facets={facets.types}
            selected={view.types}
            onChange={types =>
              setView({
                types,
                excludedTypes: view.excludedTypes.filter(t => !types.includes(t)),
              })
            }
          />
          {view.excludedTypes.length > 0 && (
            <ExcludedTypeList
              excludedTypes={view.excludedTypes}
              onUnhide={t => setView({ excludedTypes: view.excludedTypes.filter(x => x !== t) })}
              onShowAll={() => setView({ excludedTypes: [] })}
            />
          )}
        </Collapsible>
      )}

      {(facets.brands.length > 0 || view.brands.length > 0) && (
        <Collapsible id="f-brand" title="Brand">
          <FacetList
            name="brands"
            facets={facets.brands}
            selected={view.brands}
            onChange={brands => setView({ brands })}
          />
        </Collapsible>
      )}

      <Collapsible id="f-condition" title="Condition">
        <CheckList
          facets={facets.conditions}
          selected={view.conditions}
          onChange={conditions => setView({ conditions })}
          titleOf={v => conditions.get(v)?.description}
        />
        {conditions.size > 0 && (
          <details class="about-conditions">
            <summary>About conditions</summary>
            <dl>
              {conditions
                .values()
                .map(c => (
                  <div>
                    <dt>{c.label}</dt>
                    <dd>{c.description}</dd>
                  </div>
                ))
                .toArray()}
            </dl>
          </details>
        )}
      </Collapsible>

      <Collapsible id="f-price" title="Price">
        <div class="price-buckets" role="group" aria-label="Current bid ranges">
          {facets.prices.map(f => {
            const b = PRICE_BUCKETS[f.value]!;
            const on = view.priceMin === b.min && view.priceMax === b.max;
            return (
              <button
                type="button"
                class={`price-bucket ${on ? 'on' : ''} ${f.count || on ? '' : 'zero'}`}
                aria-pressed={on}
                onClick={() =>
                  setView(
                    on ? { priceMin: null, priceMax: null } : { priceMin: b.min, priceMax: b.max },
                  )
                }
              >
                <span>{f.label}</span>
                <span class="count">{format.num(f.count)}</span>
              </button>
            );
          })}
        </div>
        <div class="field-row">
          <PriceField
            label="Bid min"
            value={view.priceMin}
            onChange={priceMin => setView({ priceMin })}
          />
          <PriceField
            label="Bid max"
            value={view.priceMax}
            onChange={priceMax => setView({ priceMax })}
          />
        </div>
        <div class="field-row">
          <PriceField
            label="Max est. total"
            value={view.totalMax}
            onChange={totalMax => setView({ totalMax })}
          />
          <PriceField
            label="Min retail"
            value={view.retailMin}
            onChange={retailMin => setView({ retailMin })}
          />
        </div>
      </Collapsible>
    </section>
  );
}
