import * as format from '../../../shared/format';
import { KEYS } from '../../../shared/keys';
import {
  categoryCollapseId,
  collapsedCategoriesUpdate,
  expandableCategories,
  groupCategories,
  groupFacets,
  type CategoryGroup,
} from '../../logic/categories';
import { plural } from '../../logic/util';
import type { Facet, Facets } from '../../logic/view';
import { getSetting, setSetting, useSetting } from '../../server/settings';
import { Icon } from '../icons';
import '../../../shared/arrayToSet';

export function setAllCategoriesCollapsed(facets: Facets, value: boolean) {
  setSetting(KEYS.collapsed, collapsedCategoriesUpdate(getSetting(KEYS.collapsed), facets, value));
}

/** Category checkboxes, with expandable site and custom category parents. */
export function CategoryList({
  facets,
  selected,
  onChange,
  onOnly = onChange,
}: {
  facets: Facets;
  selected: string[];
  onChange: (next: string[]) => void;
  /** "Show only" on a row: these categories alone (default: just selects them). */
  onOnly?: (next: string[]) => void;
}) {
  const [collapsed, setCollapsed] = useSetting(KEYS.collapsed);
  const groups = groupCategories(facets);
  const ids = groups.flatMap(expandableCategories);
  return (
    <>
      <div class="category-expand-actions">
        <button
          type="button"
          class="btn-text"
          disabled={!ids.length}
          title="Expand all categories (Alt+Shift+E)"
          aria-keyshortcuts="Alt+Shift+E"
          onClick={() => setAllCategoriesCollapsed(facets, false)}
        >
          Expand all
        </button>
        <button
          type="button"
          class="btn-text"
          disabled={!ids.length}
          title="Collapse all categories (Alt+Shift+C)"
          aria-keyshortcuts="Alt+Shift+C"
          onClick={() => setAllCategoriesCollapsed(facets, true)}
        >
          Collapse all
        </button>
      </div>
      {groups.map(group => (
        <CategoryGroupRow
          key={group.facet.value}
          group={group}
          selected={selected}
          onChange={onChange}
          onOnly={onOnly}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />
      ))}
    </>
  );
}

export function CategoryGroupRow({
  group,
  selected,
  onChange,
  onOnly = onChange,
  collapsed,
  setCollapsed,
}: {
  group: CategoryGroup;
  selected: string[];
  onChange: (next: string[]) => void;
  /** "Show only" on a row: these categories alone (default: just selects them). */
  onOnly?: (next: string[]) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: (next: Record<string, boolean>) => void;
}) {
  const { facet, subs } = group;
  const toggle = () =>
    onChange(
      selected.includes(facet.value)
        ? selected.filter(v => v !== facet.value)
        : [...selected, facet.value],
    );
  if (!subs.length) {
    return (
      <CheckRow
        facet={facet}
        checked={selected.includes(facet.value)}
        onChange={toggle}
        onOnly={() => onOnly([facet.value])}
      />
    );
  }
  const rows = groupFacets(group);
  const values = rows.map(r => r.value);
  const all = values.every(v => selected.includes(v));
  const some = values.some(v => selected.includes(v));
  // Subcategory lists start closed; `collapsed[id] === false` means opened.
  const id = categoryCollapseId(facet.value);
  const open = collapsed[id] === false;
  const total = rows.sumBy(r => r.count);
  const onlyLabel = `Show only ${facet.label} and its subcategories`;
  return (
    <div class="check-group">
      <div class="check-parent">
        <label class="check">
          <input
            type="checkbox"
            checked={all}
            indeterminate={some && !all}
            onChange={() =>
              onChange(
                all
                  ? selected.filter(v => !values.includes(v))
                  : [...selected, ...values].toUnique(),
              )
            }
          />
          <span>{facet.label}</span>
        </label>
        <button
          type="button"
          class="check-expand"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${facet.label} subcategories (${plural(total, 'lot')})`}
          onClick={() => setCollapsed({ ...collapsed, [id]: open })}
        >
          <Icon name="expandMore" size={18} />
          <span class="count">{format.num(total)}</span>
        </button>
        <button
          type="button"
          class="icon-btn check-only"
          title={onlyLabel}
          aria-label={onlyLabel}
          onClick={() => onOnly(values)}
        >
          <Icon name="focus" size={16} />
        </button>
      </div>
      {open && (
        <div class="check-subs">
          <CheckRow
            facet={{ ...facet, label: 'Other' }}
            checked={selected.includes(facet.value)}
            onChange={toggle}
            onOnly={() => onOnly([facet.value])}
            onlyLabel={`Show only lots directly in ${facet.label}`}
          />
          {subs.map(sub => (
            <CategoryGroupRow
              key={sub.facet.value}
              group={sub}
              selected={selected}
              onChange={onChange}
              onOnly={onOnly}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckRow({
  facet,
  checked,
  onChange,
  onOnly,
  onlyLabel,
}: {
  facet: Facet<string>;
  checked: boolean;
  onChange: () => void;
  onOnly: () => void;
  onlyLabel?: string;
}) {
  const label = onlyLabel ?? `Show only ${facet.label}`;
  return (
    <div class="check-category">
      <label class="check">
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span>{facet.label}</span>
        <span class="count">{format.num(facet.count)}</span>
      </label>
      <button
        type="button"
        class="icon-btn check-only"
        title={label}
        aria-label={label}
        onClick={onOnly}
      >
        <Icon name="focus" size={16} />
      </button>
    </div>
  );
}
