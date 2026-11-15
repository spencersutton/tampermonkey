// A dropdown per tag group above the grid ("Finish ▾", "Color ▾", "Tags ▾"),
// listing that group's values among the current results with counts, like a
// shop's attribute filters. Only groups with results (or a selection) show.
import { useState } from 'preact/hooks';

import { groupLabel, parseTag, tagGroup } from '../shared/tags';
import { Icon } from './icons';
import { setView, sidebarFacets, storedView } from './state';
import { fmtCount } from './util';
import type { Facet } from './view';

/** Tag facets by group, plain tags ('') last and attributes alphabetically. */
function groups(tags: Facet<string>[]): [string, Facet<string>[]][] {
  return [...Map.groupBy(tags, (f) => tagGroup(f.value))].toSorted(
    ([a], [b]) => +!a - +!b || a.localeCompare(b),
  );
}

export function TagMenus() {
  const view = storedView.value;
  const list = groups(sidebarFacets.value.tags).filter(([, facets]) =>
    facets.some((f) => f.count > 0 || view.tags.includes(f.value)),
  );
  if (!list.length) return null;
  return (
    <div class="tag-menus" aria-label="Filter by attribute">
      {list.map(([group, facets]) => (
        <TagMenu key={group} group={group} facets={facets} selected={view.tags} />
      ))}
    </div>
  );
}

function TagMenu({
  group,
  facets,
  selected,
}: {
  group: string;
  facets: Facet<string>[];
  selected: string[];
}) {
  const [open, setOpen] = useState(false);
  const label = groupLabel(group);
  const picked = facets.filter((f) => selected.includes(f.value)).length;
  const toggle = (tag: string) =>
    setView({
      tags: selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag],
    });
  const clear = () => setView({ tags: selected.filter((t) => tagGroup(t) !== group) });

  // Close on a click elsewhere or Esc while open. A new callback each render re-attaches with the
  // current state; Preact runs the returned cleanup first.
  const watch = (el: HTMLDivElement | null) => {
    if (!el || !open) return;
    const doc = el.ownerDocument;
    const onPointer = (e: PointerEvent) => {
      if (!(e.target instanceof Node && el.contains(e.target))) setOpen(false);
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
        onClick={() => setOpen(!open)}
      >
        {label}
        {picked > 0 && <span class="tag-menu-n">{picked}</span>}
        <Icon name="expandMore" size={18} />
      </button>
      {open && (
        <div class="tag-menu-panel" role="group" aria-label={label}>
          {facets.map((f) => (
            <label
              class={`check ${f.count || selected.includes(f.value) ? '' : 'zero'}`}
              key={f.value}
            >
              <input
                type="checkbox"
                checked={selected.includes(f.value)}
                onChange={() => toggle(f.value)}
              />
              <span>{parseTag(f.value).value}</span>
              <span class="count">{fmtCount(f.count)}</span>
            </label>
          ))}
          {picked > 0 && (
            <button type="button" class="btn-text" onClick={clear}>
              Clear {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
