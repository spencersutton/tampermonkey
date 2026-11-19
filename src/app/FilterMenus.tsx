// Dropdown filters above the grid, like a shop's attribute filters: "Brand ▾",
// then one per tag group ("Finish ▾", "Color ▾", "Tags ▾"). Each lists its
// values among the current results with counts; tag attributes add "None" for
// lots without that attribute. A menu shows only when it has something to
// narrow by (or a selection).
import { useState } from 'preact/hooks';

import { groupLabel, isNoneTag, parseTag, tagGroup } from '../shared/tags';
import { tagMenuOptions, toggleFilterOption, type FilterOption } from './filterOptions';
import { Icon } from './icons';
import { filterFacets, gridView, setView, sidebarFacets, storedView } from './state';
import { numericOrder } from './util';
import type { Facet } from './view';

/** Menus with this many values or more get a box to filter them. */
const FIND_AT = 10;

/** Tag facets by group, plain tags ('') last and attributes alphabetically. */
function groups(tags: Facet<string>[]): [string, Facet<string>[]][] {
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
function tagGroups(tags: Facet<string>[], selected: string[]) {
  return groups(tags).filter(([, facets]) =>
    facets.some(f => (f.count > 0 && !isNoneTag(f.value)) || selected.includes(f.value)),
  );
}

/** Whether any filter menu shows. */
export function hasFilterMenus(): boolean {
  const view = storedView.value;
  const facets = sidebarFacets.value;
  return showBrandMenu(facets.brands, view.brands) || tagGroups(facets.tags, view.tags).length > 0;
}

export function FilterMenus() {
  const view = storedView.value;
  const facets = sidebarFacets.value;
  const tags = tagGroups(facets.tags, view.tags);
  const brands = showBrandMenu(facets.brands, view.brands);
  if (!brands && !tags.length) {
    return null;
  }
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
      {tags.map(([group, list]) => {
        // The attribute name as tags write it ("Battery system"); the group itself is lowercase.
        const written = list.find(f => !isNoneTag(f.value))?.label;
        return (
          <FilterMenu
            key={`tag:${group}`}
            label={groupLabel((written && parseTag(written).name) || group)}
            facets={tagMenuOptions(
              list,
              gridView.value.facetCounts.numericTag,
              filterFacets.value.tags,
            )}
            selected={view.tags}
            isNone={isNoneTag}
            valueLabel={f => parseTag(f.label).value}
            onToggle={t => setView({ tags: toggleFilterOption(view.tags, t) })}
            onClear={() => setView({ tags: view.tags.filter(t => tagGroup(t) !== group) })}
          />
        );
      })}
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
  const values = facets.filter(f => !isNone(f.value));
  const ordered = [
    ...(numericOrder(values, valueLabel) ?? values),
    ...facets.filter(f => isNone(f.value)),
  ];
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
                <span class="count">{f.count.toLocaleString()}</span>
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
