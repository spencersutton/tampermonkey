// Dropdown filters above the grid, like a shop's attribute filters: "Brand ▾",
// then one per tag group ("Finish ▾", "Color ▾", "Tags ▾"). Each lists its
// values among the current results with counts; tag attributes add "None" for
// lots without that attribute. A menu shows only when it has something to
// narrow by (or a selection).
import { useState } from 'preact/hooks';

import * as format from '../../shared/format';
import {
  hasFilterMenusFor,
  orderFilterOptions,
  showBrandMenu,
  toggleFilterOption,
  type FilterOption,
} from '../logic/filterOptions';
import { Icon } from './icons';
import { setView, sidebarFacets, storedView } from './state';

/** Menus with this many values or more get a box to filter them. */
const FIND_AT = 10;

/** Whether any filter menu shows. */
export function hasFilterMenus(): boolean {
  return hasFilterMenusFor(sidebarFacets.value, storedView.value);
}

export function FilterMenus() {
  const view = storedView.value;
  const facets = sidebarFacets.value;
  const brands = showBrandMenu(facets.brands, view.brands);
  return (
    <div class="tag-menus" aria-label="Filter by brand and attribute">
      {brands && (
        <FilterMenu
          label="Brand"
          facets={facets.brands.map(f => ({ ...f, values: [f.value] }))}
          selected={view.brands}
          onToggle={b => setView({ brands: toggleFilterOption(view.brands, b) })}
          onClear={() => setView({ brands: [] })}
        />
      )}
    </div>
  );
}

function FilterMenu({
  label,
  facets,
  selected,
  onToggle,
  onClear,
  isNone = () => false,
  valueLabel = f => f.label,
}: {
  label: string;
  facets: FilterOption[];
  /** Selected values; may include other menus' values. */
  selected: string[];
  onToggle: (values: string[]) => void;
  onClear: () => void;
  /** Whether a value is the "None" entry, listed last. */
  isNone?: (value: string) => boolean;
  valueLabel?: (f: FilterOption) => string;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const isSelected = (f: FilterOption) => f.values.some(value => selected.includes(value));
  const picked = facets.filter(isSelected).length;
  const needle = find.trim().toLowerCase();
  // Most lots first, or by value when every value is a number ("Size ▾": 8, 10, 12.5); "None" last.
  const ordered = orderFilterOptions(facets, isNone, valueLabel);
  const shown = ordered.filter(
    f => !needle || isSelected(f) || valueLabel(f).toLowerCase().includes(needle),
  );

  // Close on a click elsewhere or Esc while open. A new callback each render re-attaches with the
  // current state; Preact runs the returned cleanup first.
  const watch = (el: HTMLDivElement | null) => {
    if (!el || !open) {
      return;
    }
    const doc = el.ownerDocument;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node && el.contains(e.target))) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        el.querySelector('button')?.focus();
      }
    };
    doc.addEventListener('pointerdown', onPointer);
    doc.addEventListener('keydown', onKey, true);
    return () => {
      doc.removeEventListener('pointerdown', onPointer);
      doc.removeEventListener('keydown', onKey, true);
    };
  };

  return (
    <div class={`tag-menu ${picked ? 'on' : ''}`} ref={watch}>
      <button
        type="button"
        class="tag-menu-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => {
          setOpen(!open);
          setFind('');
        }}
      >
        {label}
        {picked > 0 && <span class="tag-menu-n">{picked}</span>}
        <Icon name="expandMore" size={18} />
      </button>
      {open && (
        <div class="tag-menu-panel" role="group" aria-label={label}>
          {facets.length >= FIND_AT && (
            <input
              type="search"
              class="tag-menu-find"
              placeholder={`Find ${label.toLowerCase()}`}
              aria-label={`Find ${label.toLowerCase()}`}
              value={find}
              onInput={e => setFind(e.currentTarget.value)}
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
          )}
          {shown.map(f => {
            const none = isNone(f.value);
            return (
              <label
                class={`check ${none ? 'tag-none' : ''} ${f.count || isSelected(f) ? '' : 'zero'}`}
                key={f.value}
                title={none ? `Lots without a ${label.toLowerCase()} tag` : undefined}
              >
                <input
                  type="checkbox"
                  checked={isSelected(f)}
                  onChange={() => onToggle(f.values)}
                />
                <span>{none ? 'None' : valueLabel(f)}</span>
                <span class="count">{format.num(f.count)}</span>
              </label>
            );
          })}
          {!shown.length && <p class="muted tag-menu-empty">No matches</p>}
          {picked > 0 && (
            <button type="button" class="btn-text" onClick={onClear}>
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
