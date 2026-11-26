// Above the grid, as on a shop's results page: the spelling correction used
// for a search that matched nothing, a removable chip per active filter,
// contextual attribute dropdowns, and the item types among the results.
import { useEffect, useRef, useState } from 'preact/hooks';

import * as format from '../../shared/format';
import { chipsFor, type Chip } from '../logic/refinements';
import { DEFAULT_VIEW, type AttrFacetGroup } from '../logic/view';
import { Icon } from './icons';
import {
  filteredOnly,
  filteredPattern,
  gridView,
  pickupName,
  setView,
  sidebarFacets,
  storedView,
} from './state';

const MAX_TYPE_PILLS = 10;

function AttrMenu({
  group,
  selected,
  onToggle,
  onClear,
}: {
  group: AttrFacetGroup;
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div class={`attr-menu ${selected.length ? 'on' : ''}`} ref={root}>
      <button
        type="button"
        class="attr-menu-btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(o => !o)}
      >
        <span>{group.label}</span>
        {selected.length > 0 && <span class="attr-menu-n">{selected.length}</span>}
        <Icon name="expandMore" size={16} />
      </button>
      {open && (
        <div class="attr-menu-panel" role="group" aria-label={group.label}>
          {group.facets.map(f => {
            const checked = selected.includes(f.value);
            return (
              <label key={f.value} class={`check ${f.count || checked ? '' : 'zero'}`}>
                <input type="checkbox" checked={checked} onChange={() => onToggle(f.value)} />
                <span>{f.label}</span>
                <span class="count">{format.num(f.count)}</span>
              </label>
            );
          })}
          {selected.length > 0 && (
            <button type="button" class="btn-text" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Refinements() {
  const view = storedView.value;
  const result = gridView.value;
  const facets = sidebarFacets.value;
  const activePattern = filteredOnly.value ? filteredPattern.value : null;
  const chips = chipsFor(view, facets, pickupName.value);
  const isCategory = (c: Chip) => c.key.startsWith('cat:');
  const isExcludedType = (c: Chip) => c.key.startsWith('exType:');
  const catChips = chips.filter(isCategory);
  const exTypeChips = chips.filter(isExcludedType);
  const otherChips = chips.filter(c => !isCategory(c) && !isExcludedType(c));
  const totalChips = chips.length + (activePattern != null ? 1 : 0);
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
  const types = view.types.length ? [] : facets.types.slice(0, MAX_TYPE_PILLS);
  const showTypes = result.rows.length > 0 && types.length > 1;
  const showAttrs = facets.attrs.length > 0;
  if (!result.correctedSearch && !totalChips && !showTypes && !showAttrs) {
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
      {(otherChips.length > 0 || activePattern != null || totalChips > 1) && (
        <div class="chips" aria-label="Active filters">
          {activePattern != null && (
            <button
              type="button"
              key="filteredPattern"
              class="chip"
              title={`Show all filtered lots (clear /${activePattern}/)`}
              onClick={() => (filteredPattern.value = null)}
            >
              <span>Filter: /{activePattern}/</span>
              <Icon name="close" size={14} />
            </button>
          )}
          {otherChips.map(chipButton)}
          {totalChips > 1 && (
            <button
              type="button"
              class="btn-text chips-clear"
              onClick={() => {
                filteredPattern.value = null;
                setView({ ...DEFAULT_VIEW, sort: view.sort });
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
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
      {showAttrs && (
        <div class="attr-menus" aria-label="Filter by attribute">
          {facets.attrs.map(group => {
            const prefix = `${group.key}:`;
            const selected = view.attrs.filter(a => a.startsWith(prefix));
            const rest = view.attrs.filter(a => !a.startsWith(prefix));
            return (
              <AttrMenu
                key={group.key}
                group={group}
                selected={selected}
                onToggle={v => {
                  let attrs = [...view.attrs, v];
                  if (selected.includes(v)) {
                    attrs = view.attrs.filter(x => x !== v);
                  }
                  setView({ attrs });
                }}
                onClear={() => setView({ attrs: rest })}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
