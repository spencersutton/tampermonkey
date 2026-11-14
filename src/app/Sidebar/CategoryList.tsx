import { KEYS } from '../../shared/keys';
import { collator } from '../../shared/sortKey';
import { Icon } from '../icons';
import { getSetting, setSetting } from '../settings';
import { fmtCount, plural } from '../util';
import { isCustomCategory, type Facet, type Facets } from '../view';

/** A category filter row, with the custom categories named "<it> - <sub>" nested under it. */
interface CategoryGroup {
  facet: Facet<string>;
  subs: CategoryGroup[];
}

/** Separator between a site category's name and a subcategory's in custom category names. */
const SUB = ' - ';

/** Nest custom categories under the longest matching site or custom category name. */
export function groupCategories({ categories, siteCategories }: Facets): CategoryGroup[] {
  const all = new Map(
    [...siteCategories.map((f) => ({ ...f, count: 0 })), ...categories].map((f) => [f.value, f]),
  );
  const parents = [...all.values()].toSorted((a, b) => b.label.length - a.label.length);
  const groups = new Map(
    [...all].map(([value, facet]): [string, CategoryGroup] => [value, { facet, subs: [] }]),
  );
  const top: CategoryGroup[] = [];
  for (const f of categories) {
    const p = isCustomCategory(f.value)
      ? parents.find((s) => f.label.startsWith(s.label + SUB))
      : undefined;
    const group = groups.get(f.value)!;
    if (p) {
      group.facet = { ...f, label: f.label.slice(p.label.length + SUB.length) };
      groups.get(p.value)!.subs.push(group);
    } else {
      top.push(group);
    }
  }
  // A site category whose lots all moved into subcategories still heads them.
  for (const p of siteCategories) {
    const group = groups.get(p.value)!;
    if (group.subs.length && !top.includes(group)) {
      top.push(group);
    }
  }
  const sort = (rows: CategoryGroup[]): CategoryGroup[] =>
    rows
      .toSorted((a, b) => collator.compare(a.facet.label, b.facet.label))
      .map((g) => ({ ...g, subs: sort(g.subs) }));
  return sort(top);
}

const groupFacets = (g: CategoryGroup): Facet<string>[] => [
  g.facet,
  ...g.subs.flatMap(groupFacets),
];
const categoryCollapseId = (value: string) => `cat:${value}`;
const expandableCategories = (g: CategoryGroup): string[] =>
  g.subs.length ? [categoryCollapseId(g.facet.value), ...g.subs.flatMap(expandableCategories)] : [];

export function setAllCategoriesCollapsed(facets: Facets, value: boolean) {
  const next = { ...getSetting(KEYS.collapsed) };
  for (const id of groupCategories(facets).flatMap(expandableCategories)) {
    next[id] = value;
  }
  if (!value) next['f-category'] = false;
  setSetting(KEYS.collapsed, next);
}

/** Category checkboxes, with expandable site and custom category parents. */
export function CategoryList({
  facets,
  selected,
  onChange,
}: {
  facets: Facets;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const collapsed = getSetting(KEYS.collapsed);
  const setCollapsed = (value: ReturnType<typeof getSetting<typeof KEYS.collapsed>>) =>
    setSetting(KEYS.collapsed, value);
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
      {groups.map((group) => (
        <CategoryGroupRow
          key={group.facet.value}
          group={group}
          selected={selected}
          onChange={onChange}
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
  collapsed,
  setCollapsed,
}: {
  group: CategoryGroup;
  selected: string[];
  onChange: (next: string[]) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: (next: Record<string, boolean>) => void;
}) {
  const { facet, subs } = group;
  const toggle = () =>
    onChange(
      selected.includes(facet.value)
        ? selected.filter((v) => v !== facet.value)
        : [...selected, facet.value],
    );
  if (!subs.length) {
    return (
      <CheckRow
        facet={facet}
        checked={selected.includes(facet.value)}
        onChange={toggle}
        onOnly={() => onChange([facet.value])}
      />
    );
  }
  const rows = groupFacets(group);
  const values = rows.map((r) => r.value);
  const all = values.every((v) => selected.includes(v));
  const some = values.some((v) => selected.includes(v));
  // Subcategory lists start closed; `collapsed[id] === false` means opened.
  const id = categoryCollapseId(facet.value);
  const open = collapsed[id] === false;
  const total = rows.reduce((n, r) => n + r.count, 0);
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
                  ? selected.filter((v) => !values.includes(v))
                  : [...new Set([...selected, ...values])],
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
          <span class="count">{fmtCount(total)}</span>
        </button>
        <button
          type="button"
          class="icon-btn check-only"
          title={onlyLabel}
          aria-label={onlyLabel}
          onClick={() => onChange(values)}
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
            onOnly={() => onChange([facet.value])}
            onlyLabel={`Show only lots directly in ${facet.label}`}
          />
          {subs.map((sub) => (
            <CategoryGroupRow
              key={sub.facet.value}
              group={sub}
              selected={selected}
              onChange={onChange}
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
        <span class="count">{fmtCount(facet.count)}</span>
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
