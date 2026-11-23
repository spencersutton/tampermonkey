// oxlint-disable typescript/no-unsafe-type-assertion
import { useState } from 'preact/hooks';

import * as format from '../../../shared/format';
import { KEYS } from '../../../shared/keys';
import {
  categoryCollapseId,
  groupCategories,
  groupFacets,
  type CategoryGroup,
} from '../../logic/categories';
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
import { getSetting, useSetting } from '../../server/settings';
import { hasModifierKey } from '../dom';
import { Icon } from '../icons';
import { closed, hideItemType, modalActions, openClosed, setView } from '../state';
import { Collapsible } from './Collapsible';
import { NumberInput } from './NumberInput';

/** A checkbox per facet value with its lot count; checking none means no filter. */
function CheckList<T>(props: {
  facets: Facet<T>[];
  selected: T[];
  onChange: (next: T[]) => void;
  titleOf?: (v: T) => string | undefined;
  onHide?: ((v: T, e?: MouseEvent) => void) | undefined;
}) {
  const { facets, selected, onChange, titleOf, onHide } = props;
  const toggle = (v: T) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <>
      {facets.map(f => {
        const zero = f.count || selected.includes(f.value) ? '' : 'zero';
        if (onHide) {
          return (
            <div class={`check-row ${zero}`}>
              <label class="check" title={titleOf?.(f.value)}>
                <input
                  type="checkbox"
                  checked={selected.includes(f.value)}
                  onChange={() => toggle(f.value)}
                />
                <span>{f.label}</span>
              </label>
              <button
                type="button"
                class="icon-btn facet-hide"
                title={`Hide item type: ${f.label} (hold modifier key for this search only)`}
                aria-label={`Hide item type: ${f.label}`}
                onClick={e => onHide(f.value, e)}
              >
                <Icon name="visibilityOff" size={14} />
              </button>
              <span class="count">{format.num(f.count)}</span>
            </div>
          );
        }
        return (
          <label class={`check ${zero}`} title={titleOf?.(f.value)}>
            <input
              type="checkbox"
              checked={selected.includes(f.value)}
              onChange={() => toggle(f.value)}
            />
            <span>{f.label}</span>
            <span class="count">{format.num(f.count)}</span>
          </label>
        );
      })}
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
  onHide?: (v: string, e?: MouseEvent) => void;
}) {
  const { name, facets, selected, onChange, onHide } = props;
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
      <CheckList
        facets={[...picked, ...shown]}
        selected={selected}
        onChange={onChange}
        onHide={onHide}
      />
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

/** Recursive collapsible category menu: clicking a category shows only that category. */
function CategoryTreeNode(props: {
  group: CategoryGroup;
  selected: string[];
  onChange: (next: string[]) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: (next: Record<string, boolean>) => void;
}) {
  const { group, selected, onChange, collapsed, setCollapsed } = props;
  const isExact = (values: string[]) =>
    values.length > 0 &&
    selected.length === values.length &&
    values.every(v => selected.includes(v));

  const allFacets = groupFacets(group);
  const values = allFacets.map(f => f.value);
  const count = allFacets.reduce((sum, f) => sum + f.count, 0);
  const active = isExact(values);
  const hasActive = !active && values.some(v => selected.includes(v));

  if (group.subs.length === 0) {
    return (
      <button
        type="button"
        class={`cat-item cat-leaf ${active ? 'active' : ''} ${count || active ? '' : 'zero'}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onChange(active ? [] : values)}
      >
        <span class="cat-label">{group.facet.label}</span>
        <span class="count">{format.num(count)}</span>
      </button>
    );
  }

  const cid = categoryCollapseId(group.facet.value);
  const open = collapsed[cid] === false;
  const selectParent = () => {
    if (active) {
      onChange([]);
      if (open) {
        setCollapsed({ ...collapsed, [cid]: true });
      }
    } else {
      onChange(values);
      if (!open) {
        setCollapsed({ ...collapsed, [cid]: false });
      }
    }
  };

  let parentState = '';
  if (active) {
    parentState = 'active';
  } else if (hasActive) {
    parentState = 'has-active';
  }

  const ownActive = isExact([group.facet.value]);
  const showOwn = group.facet.count > 0 || ownActive;

  return (
    <div class="cat-group">
      <div class="cat-parent">
        <button
          type="button"
          class="cat-toggle"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${group.facet.label}`}
          onClick={() => setCollapsed({ ...collapsed, [cid]: open })}
        >
          <Icon name="expandMore" size={16} />
        </button>
        <button
          type="button"
          class={`cat-item ${parentState} ${count || active || hasActive ? '' : 'zero'}`}
          aria-current={active ? 'true' : undefined}
          onClick={selectParent}
        >
          <span class="cat-label">{group.facet.label}</span>
          <span class="count">{format.num(count)}</span>
        </button>
      </div>
      {open && (
        <div class="cat-subs">
          {group.subs.map(sub => (
            <CategoryTreeNode
              key={sub.facet.value}
              group={sub}
              selected={selected}
              onChange={onChange}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
            />
          ))}
          {showOwn && (
            <button
              type="button"
              class={`cat-item cat-leaf ${ownActive ? 'active' : ''} ${group.facet.count || ownActive ? '' : 'zero'}`}
              aria-current={ownActive ? 'true' : undefined}
              onClick={() => onChange(ownActive ? [] : [group.facet.value])}
            >
              <span class="cat-label">Other</span>
              <span class="count">{format.num(group.facet.count)}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Collapsible category menu: clicking a category shows only that category. */
function CategoryTree(props: {
  facets: Facets;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { facets, selected, onChange } = props;
  const [collapsed, setCollapsed] = useSetting(KEYS.collapsed);
  const groups = groupCategories(facets);
  const total = facets.categories.reduce((sum, f) => sum + f.count, 0);

  return (
    <div class="cat-tree" role="navigation" aria-label="Categories">
      <button
        type="button"
        class={`cat-item cat-leaf ${selected.length === 0 ? 'active' : ''}`}
        aria-current={selected.length === 0 ? 'true' : undefined}
        onClick={() => onChange([])}
      >
        <span class="cat-label">All categories</span>
        <span class="count">{format.num(total)}</span>
      </button>
      {groups.map(g => (
        <CategoryTreeNode
          key={g.facet.value}
          group={g}
          selected={selected}
          onChange={onChange}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />
      ))}
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
  const customCount = getSetting(KEYS.customCategories).length;
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
          facets={facets}
          selected={view.categories}
          onChange={categories => setView({ categories })}
        />
        <button type="button" class="btn-text cat-edit-btn" onClick={modalActions.editCategories}>
          <Icon name="edit" size={16} />{' '}
          {customCount ? `Edit custom categories (${customCount})` : 'Add custom categories'}
        </button>
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
            onHide={(t, e) => hideItemType(t, null, Boolean(e && hasModifierKey(e)))}
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
