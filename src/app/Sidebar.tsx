import type { ComponentChildren, InputHTMLAttributes } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { compileFilter } from '../shared/filters';
import { DEFAULT_SYNC_MINUTES, DEFAULT_TITLE_LINES, KEYS, MIN_SYNC_MINUTES, siteUrl } from '../shared/keys';
import { DEFAULT_NAME_MATCH, nameMatchPct } from '../shared/names';
import { AccountSettings } from './auth';
import { siteConditions } from './conditions';
import { getSetting, setSetting } from './settings';
import { closed, modalActions, openClosed, openHidden, setView } from './state';
import { Icon } from './icons';
import { fmtCount, openHandler, parseNum, plural } from './util';
import { collator } from '../shared/sortKey';
import {
  activeFilterCount,
  defaultFilterView,
  DEFAULT_VIEW,
  ENDING,
  isCustomCategory,
  MINE,
  sameDefaultFilters,
  sameFilters,
  type Facet,
  type Facets,
  type SavedSearch,
  type SavedSearchStats,
  type ViewState,
} from './view';

interface Props {
  view: ViewState;
  facets: Facets;
  matchCounts: Map<string, number>;
  pickup: string;
  accountPickup: string | null;
  authed: boolean;
  saved: SavedSearchesProps;
}

/** Left sidebar: saved searches, filters, hide/regex filters and settings. */
export function Sidebar(props: Props) {
  return (
    <div class="sidebar-inner">
      <SavedSearchesSection {...props.saved} />
      <FiltersSection {...props} />
      <HideFilterSection matchCounts={props.matchCounts} />
      <SettingsSection pickup={props.pickup} accountPickup={props.accountPickup} locations={props.facets.locations.map((l) => l.value)} />
    </div>
  );
}

/** Section whose open/closed state is remembered across sessions. */
function Collapsible({ id, title, children }: { id: string; title: ComponentChildren; children: ComponentChildren }) {
  const collapsed = getSetting(KEYS.collapsed);
  const setCollapsed = (value: ReturnType<typeof getSetting<typeof KEYS.collapsed>>) => setSetting(KEYS.collapsed, value);
  const open = !collapsed?.[id];
  return (
    <div class="collapsible">
      <button type="button" class="collapse-head" aria-expanded={open} onClick={() => setCollapsed({ ...collapsed, [id]: open })}>
        <span>{title}</span>
        <Icon name="expandMore" size={20} />
      </button>
      {open && <div class="collapse-body">{children}</div>}
    </div>
  );
}

/** A checkbox per facet value with its lot count; checking none means no filter. */
function CheckList<T>(props: { facets: Facet<T>[]; selected: T[]; onChange: (next: T[]) => void; titleOf?: (v: T) => string | undefined }) {
  const { facets, selected, onChange, titleOf } = props;
  const toggle = (v: T) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <>
      {facets.map((f) => (
        <label class="check" title={titleOf?.(f.value)}>
          <input type="checkbox" checked={selected.includes(f.value)} onChange={() => toggle(f.value)} />
          <span>{f.label}</span>
          <span class="count">{fmtCount(f.count)}</span>
        </label>
      ))}
    </>
  );
}

/** A category filter row, with the custom categories named "<it> - <sub>" nested under it. */
interface CategoryGroup {
  facet: Facet<string>;
  subs: CategoryGroup[];
}

/** Separator between a site category's name and a subcategory's in custom category names. */
const SUB = ' - ';

/** Nest custom categories under the longest matching site or custom category name. */
function groupCategories({ categories, siteCategories }: Facets): CategoryGroup[] {
  const all = new Map([...siteCategories.map((f) => ({ ...f, count: 0 })), ...categories].map((f) => [f.value, f]));
  const parents = [...all.values()].sort((a, b) => b.label.length - a.label.length);
  const groups = new Map([...all].map(([value, facet]): [string, CategoryGroup] => [value, { facet, subs: [] }]));
  const top: CategoryGroup[] = [];
  for (const f of categories) {
    const p = isCustomCategory(f.value) ? parents.find((s) => f.label.startsWith(s.label + SUB)) : undefined;
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
    rows.sort((a, b) => collator.compare(a.facet.label, b.facet.label)).map((g) => ({ ...g, subs: sort(g.subs) }));
  return sort(top);
}

const groupFacets = (g: CategoryGroup): Facet<string>[] => [g.facet, ...g.subs.flatMap(groupFacets)];
const categoryCollapseId = (value: string) => `cat:${value}`;
const expandableCategories = (g: CategoryGroup): string[] =>
  g.subs.length ? [categoryCollapseId(g.facet.value), ...g.subs.flatMap(expandableCategories)] : [];

/** Category checkboxes, with expandable site and custom category parents. */
function CategoryList({ facets, selected, onChange }: { facets: Facets; selected: string[]; onChange: (next: string[]) => void }) {
  const collapsed = getSetting(KEYS.collapsed);
  const setCollapsed = (value: ReturnType<typeof getSetting<typeof KEYS.collapsed>>) => setSetting(KEYS.collapsed, value);
  const groups = groupCategories(facets);
  const ids = groups.flatMap(expandableCategories);
  const setAllCollapsed = (value: boolean) => {
    const next = { ...collapsed };
    for (const id of ids) {
      next[id] = value;
    }
    setCollapsed(next);
  };
  return (
    <>
      <div class="category-expand-actions">
        <button type="button" class="btn-text" disabled={!ids.length} onClick={() => setAllCollapsed(false)}>
          Expand all
        </button>
        <button type="button" class="btn-text" disabled={!ids.length} onClick={() => setAllCollapsed(true)}>
          Collapse all
        </button>
      </div>
      {groups.map((group) => (
        <CategoryGroupRow key={group.facet.value} group={group} selected={selected} onChange={onChange} collapsed={collapsed ?? {}} setCollapsed={setCollapsed} />
      ))}
    </>
  );
}

function CategoryGroupRow({ group, selected, onChange, collapsed, setCollapsed }: {
  group: CategoryGroup;
  selected: string[];
  onChange: (next: string[]) => void;
  collapsed: Record<string, boolean>;
  setCollapsed: (next: Record<string, boolean>) => void;
}) {
  const { facet, subs } = group;
  const toggle = () => onChange(selected.includes(facet.value) ? selected.filter((v) => v !== facet.value) : [...selected, facet.value]);
  if (!subs.length) {
    return <CheckRow facet={facet} checked={selected.includes(facet.value)} onChange={toggle} onOnly={() => onChange([facet.value])} />;
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
            onChange={() => onChange(all ? selected.filter((v) => !values.includes(v)) : [...new Set([...selected, ...values])])}
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
        <button type="button" class="icon-btn check-only" title={onlyLabel} aria-label={onlyLabel} onClick={() => onChange(values)}>
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
            <CategoryGroupRow key={sub.facet.value} group={sub} selected={selected} onChange={onChange} collapsed={collapsed} setCollapsed={setCollapsed} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckRow({ facet, checked, onChange, onOnly, onlyLabel }: {
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
      <button type="button" class="icon-btn check-only" title={label} aria-label={label} onClick={onOnly}>
        <Icon name="focus" size={16} />
      </button>
    </div>
  );
}

type NumberInputProps<T> = {
  label: string;
  value: T;
  parse: (text: string) => T;
  onChange: (v: T) => void;
} & Omit<InputHTMLAttributes, 'label' | 'value' | 'onChange'>;

/** Number input that commits on blur or Enter; `parse` turns the typed text into the value. */
function NumberInput<T extends number | null>(props: NumberInputProps<T>) {
  return <NumberInputDraft key={String(props.value)} {...props} />;
}

function NumberInputDraft<T extends number | null>({ label, value, parse, onChange, ...input }: NumberInputProps<T>) {
  const format = (v: T) => (v == null ? '' : String(v));
  const [text, setText] = useState(format(value));
  const commit = () => {
    const v = parse(text);
    setText(format(v));
    if (v !== value) {
      onChange(v);
    }
  };
  return (
    <label class="field">
      <span>{label}</span>
      <input {...input} value={text} onInput={(e) => setText(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

/** Dollar amount; empty means no limit (null). */
function PriceField(props: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return <NumberInput {...props} parse={parseNum} type="text" inputMode="decimal" placeholder="$" />;
}

/** Search, category, condition, location, price, ending and "my lots" filters. */
function FiltersSection({ view, facets, pickup, authed }: Props) {
  const n = activeFilterCount(view);
  const defaults = getSetting(KEYS.defaultFilters);
  const setDefaults = (value: ReturnType<typeof getSetting<typeof KEYS.defaultFilters>>) => setSetting(KEYS.defaultFilters, value);
  const reset = defaultFilterView(defaults, view.sort);
  const canDefault =
    view.newSince != null || !sameDefaultFilters(view, defaults) || !sameFilters({ ...view, categories: reset.categories, noCategories: reset.noCategories, conditions: reset.conditions }, reset);
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
            <option value={k} disabled={!!k && !authed}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div class="closed-links">
        <span class="muted">Closed:</span>
        {(['won', 'lost'] as const).map((s) => (
          <button type="button" class={`btn-text ${closed.value === s ? 'on' : ''}`} aria-pressed={closed.value === s} disabled={!authed} onClick={() => openClosed(s)}>
            {s === 'won' ? 'Won' : 'Lost'}
          </button>
        ))}
      </div>

      <label class="field">
        <span>Ending</span>
        <select value={view.ending} onChange={(e) => setView({ ending: e.currentTarget.value as ViewState['ending'] })}>
          {Object.entries(ENDING).map(([k, { label }]) => (
            <option value={k}>{label}</option>
          ))}
        </select>
      </label>

      <Collapsible id="f-location" title="Location">
        <CheckList facets={facets.locations} selected={view.locations} onChange={(locations) => setView({ locations })} />
        <label class="check">
          <input type="checkbox" checked={view.reachable} onChange={() => setView({ reachable: !view.reachable })} />
          <span>Available at {pickup} (incl. transfers)</span>
        </label>
      </Collapsible>

      <Collapsible id="f-category" title="Category">
        {view.noCategories && (
          <div>
            <p class="muted">No categories selected.</p>
            <button type="button" class="btn-text" onClick={() => setView({ categories: [], noCategories: false })}>
              Show all categories
            </button>
          </div>
        )}
        <CategoryList facets={facets} selected={view.categories} onChange={(categories) => setView({ categories, noCategories: false })} />
        <button type="button" class="btn-text cat-edit-btn" onClick={modalActions.editCategories}>
          <Icon name="edit" size={16} /> {customCount ? `Edit custom categories (${customCount})` : 'Add custom categories'}
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
        disabled={sameDefaultFilters(view, defaults)}
        onClick={() => setDefaults({ categories: [...view.categories], conditions: [...view.conditions], ...(view.noCategories ? { noCategories: true } : {}) })}
        title="Save the current category and condition selections as defaults"
      >
        Save category &amp; condition defaults
      </button>

      <Collapsible id="f-price" title="Price">
        <div class="field-row">
          <PriceField label="Bid min" value={view.priceMin} onChange={(priceMin) => setView({ priceMin })} />
          <PriceField label="Bid max" value={view.priceMax} onChange={(priceMax) => setView({ priceMax })} />
        </div>
        <div class="field-row">
          <PriceField label="Max est. total" value={view.totalMax} onChange={(totalMax) => setView({ totalMax })} />
          <PriceField label="Min retail" value={view.retailMin} onChange={(retailMin) => setView({ retailMin })} />
        </div>
      </Collapsible>
    </section>
  );
}

/** Saves the edited text; returns an error message to keep the editor open. */
type SaveFn = (text: string) => string | void;

const selectText = (box: HTMLInputElement | HTMLTextAreaElement | null) => box?.select();

/**
 * Inline text editors, one open at a time (identified by an id). Enter or
 * blur saves the trimmed text (empty just closes), Escape cancels.
 */
function useInlineEdit() {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Which editor is open, updated synchronously: Enter closes the editor, and
  // removing the focused box then fires a blur whose handler still sees the
  // old state – this keeps that second save from running.
  const open = useRef<string | null>(null);

  const start = (id: string, initial: string) => {
    open.current = id;
    setEditing(id);
    setText(initial);
    setError(null);
  };
  const close = () => {
    open.current = null;
    setEditing(null);
    setError(null);
  };
  const save = (id: string, onSave: SaveFn) => {
    if (open.current !== id) {
      return;
    }
    const next = text.trim();
    const err = next ? onSave(next) : undefined;
    if (err) {
      setError(err);
    } else {
      close();
    }
  };
  /** Props for the editor's input or textarea. */
  const boxProps = (id: string, onSave: SaveFn) => ({
    ref: selectText,
    value: text,
    onInput: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
      setText(e.currentTarget.value.replace(/\n/g, ''));
      setError(null);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save(id, onSave);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    onBlur: () => save(id, onSave),
  });
  return { editing, text, error, start, save, boxProps };
}

// Each "alternative|" is its own inline-block, so long alternations wrap
// between alternatives (with "|" ending the line) rather than mid-word.
function PatternText({ pattern }: { pattern: string }) {
  const parts = pattern.split('|');
  return (
    <span class="pattern">
      {parts.map((p, i) => (
        <span class="seg">{i < parts.length - 1 ? `${p}|` : p}</span>
      ))}
    </span>
  );
}

interface FilterRowProps {
  pattern: string;
  count: number;
  onRemove: () => void;
  onSave: (next: string) => void;
}

// One regex per line: remove button, pattern (click to edit), match count.
function FilterRow({ pattern, count, onRemove, onSave }: FilterRowProps) {
  const edit = useInlineEdit();
  const editing = edit.editing != null;
  const ok = !!compileFilter(pattern);
  const save: SaveFn = (next) => {
    if (next === pattern) {
      return;
    }
    if (!compileFilter(next)) {
      return 'Invalid regex';
    }
    onSave(next);
    return;
  };

  return (
    <li class={`filter-row ${ok ? '' : 'filter-error'}`}>
      <button type="button" class="filter-remove" aria-label={`Remove ${pattern}`} title="Remove filter" onClick={onRemove}>
        <Icon name="cancel" size={16} />
      </button>
      {editing ? (
        <div class="filter-edit">
          <textarea
            class={edit.error ? 'has-error' : ''}
            aria-label="Edit filter regex"
            spellcheck={false}
            rows={Math.min(6, Math.max(1, Math.ceil(edit.text.length / 26)))}
            {...edit.boxProps('pattern', save)}
          />
          <span class={edit.error ? 'error small' : 'muted small'}>{edit.error ?? 'Enter to save · Esc to cancel'}</span>
        </div>
      ) : (
        <button
          type="button"
          class="filter-pattern"
          title={ok ? `/\\b(?:${pattern})\\b/i – click to edit` : 'Invalid regex – ignored. Click to edit'}
          onClick={() => edit.start('pattern', pattern)}
        >
          <PatternText pattern={pattern} />
        </button>
      )}
      {ok && !editing && (
        <span class="count">
          {fmtCount(count)}
        </span>
      )}
    </li>
  );
}

/** Labeled on/off switch. */
function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="switch-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

/** Regex title filters and the list of manually hidden lots. */
function HideFilterSection({ matchCounts }: { matchCounts: Map<string, number> }) {
  const words = getSetting(KEYS.words);
  const setWords = (value: ReturnType<typeof getSetting<typeof KEYS.words>>) => setSetting(KEYS.words, value);
  const filterOn = getSetting(KEYS.filterOn);
  const setFilterOn = (value: ReturnType<typeof getSetting<typeof KEYS.filterOn>>) => setSetting(KEYS.filterOn, value);
  const removeFiltered = getSetting(KEYS.removeFiltered);
  const setRemoveFiltered = (value: ReturnType<typeof getSetting<typeof KEYS.removeFiltered>>) => setSetting(KEYS.removeFiltered, value);
  const showHidden = getSetting(KEYS.showHidden);
  const setShowHidden = (value: ReturnType<typeof getSetting<typeof KEYS.showHidden>>) => setSetting(KEYS.showHidden, value);
  const hiddenLots = getSetting(KEYS.hidden);
  const setHiddenLots = (value: ReturnType<typeof getSetting<typeof KEYS.hidden>>) => setSetting(KEYS.hidden, value);
  const [input, setInput] = useState('');
  const add = () => {
    setWords([...new Set([...words, input])]);
    setInput('');
  };
  const unhide = (id: string) => {
    const { [id]: _, ...rest } = hiddenLots;
    setHiddenLots(rest);
  };
  const hidden = Object.entries(hiddenLots).sort((a, b) => b[1].ts - a[1].ts);

  return (
    <section class="panel">
      <h2>Hide &amp; filter</h2>
      <div class="add-filter">
        <input
          type="text"
          placeholder="Regex, e.g. batter(y|ies)"
          aria-label="Add filter regex"
          autocomplete="off"
          spellcheck={false}
          value={input}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" class="btn-text" onClick={add}>
          Add
        </button>
      </div>
      <p class="muted small">Case-insensitive, whole words: \b(?:pattern)\b. Commas add several.</p>

      <Collapsible id="words" title={`Filter patterns (${words.length})`}>
        <ul class="filter-list">
          {words.sort().map((w) => (
            <FilterRow
              key={w}
              pattern={w}
              count={matchCounts.get(w) ?? 0}
              onRemove={() => setWords(words.filter((x) => x !== w))}
              onSave={(next) => setWords([...new Set(words.map((x) => (x === w ? next : x)))])}
            />
          ))}
        </ul>
      </Collapsible>

      <Switch label="Apply filters" checked={filterOn} onChange={setFilterOn} />
      <Switch label="Remove filtered lots instead of graying out" checked={removeFiltered} onChange={setRemoveFiltered} />
      <Switch label="Show hidden lots" checked={showHidden} onChange={setShowHidden} />

      <Collapsible id="hidden" title={`Hidden lots (${hidden.length})`}>
        <ul class="hidden-list">
          {hidden.map(([id, info]) => (
            <li>
              <a href={siteUrl(info.href)} title={info.title} onClick={openHandler(() => openHidden(Number(id)))}>
                {info.title || `Lot ${id}`}
              </a>
              <button type="button" class="icon-btn" title="Unhide" aria-label={`Unhide ${info.title}`} onClick={() => unhide(id)}>
                <Icon name="visibility" size={18} />
              </button>
            </li>
          ))}
        </ul>
        {hidden.length > 0 && (
          <button type="button" class="btn-text" onClick={() => confirm('Unhide all hidden lots?') && setHiddenLots({})}>
            Unhide all
          </button>
        )}
      </Collapsible>
    </section>
  );
}

/** Choices for how alike two titles must be to count as the same item. */
const NAME_MATCH_CHOICES = [100, 95, 90, 85, 80, 75, 70, 60];

/** Pickup location, full-refresh interval, title lines, name matching and the account. */
function SettingsSection({ pickup, accountPickup, locations }: { pickup: string; accountPickup: string | null; locations: string[] }) {
  const minutes = getSetting(KEYS.syncMinutes);
  const setMinutes = (value: ReturnType<typeof getSetting<typeof KEYS.syncMinutes>>) => setSetting(KEYS.syncMinutes, value);
  const override = getSetting(KEYS.pickup);
  const setOverride = (value: ReturnType<typeof getSetting<typeof KEYS.pickup>>) => setSetting(KEYS.pickup, value);
  const titleLines = getSetting(KEYS.titleLines);
  const setTitleLines = (value: ReturnType<typeof getSetting<typeof KEYS.titleLines>>) => setSetting(KEYS.titleLines, value);
  const nameMatch = getSetting(KEYS.nameMatch);
  const setNameMatch = (value: ReturnType<typeof getSetting<typeof KEYS.nameMatch>>) => setSetting(KEYS.nameMatch, value);
  const pct = nameMatchPct(nameMatch);
  return (
    <section class="panel">
      <Collapsible id="settings" title={<h2>Settings</h2>}>
        <NumberInput
          label={`Full catalog refresh at most every (minutes, min ${MIN_SYNC_MINUTES})`}
          value={minutes}
          parse={(text) => Math.max(MIN_SYNC_MINUTES, Math.round(parseNum(text) ?? DEFAULT_SYNC_MINUTES))}
          onChange={setMinutes}
          type="number"
          min={MIN_SYNC_MINUTES}
          step={1}
        />
        <NumberInput
          label="Lot title lines in the grid (0 = show in full)"
          value={titleLines}
          parse={(text) => Math.max(0, Math.round(parseNum(text) ?? DEFAULT_TITLE_LINES))}
          onChange={setTitleLines}
          type="number"
          min={0}
          step={1}
        />
        <label class="field" title="Brand and model take precedence when both listings have both. Otherwise titles use this threshold for duplicates, relisted lots and past prices. In title matching, a number only one title has (size, pack count, Qty) never matches.">
          <span>Same item when titles share</span>
          <select value={pct} onChange={(e) => setNameMatch(Number(e.currentTarget.value))}>
            {[...new Set([...NAME_MATCH_CHOICES, pct])].sort((a, b) => b - a).map((n) => (
              <option value={n}>
                {n === 100 ? 'All words (any case, punctuation, order)' : `${n}% of words`}
                {n === DEFAULT_NAME_MATCH ? ' – default' : ''}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Pickup location (for transfer fees)</span>
          <select value={override ?? ''} onChange={(e) => setOverride(e.currentTarget.value || null)}>
            <option value="">Account default ({accountPickup ?? 'Raleigh'})</option>
            {[...new Set([...locations, pickup])].map((o) => (
              <option value={o}>{o}</option>
            ))}
          </select>
        </label>
        <AccountSettings />
      </Collapsible>
    </section>
  );
}

interface SavedSearchesProps {
  searches: SavedSearch[];
  stats: Map<string, SavedSearchStats>;
  activeId: string | null;
  canSave: boolean; // current view has filters and isn't already saved
  suggestedName: string;
  onSave: (name: string) => void;
  onOpen: (s: SavedSearch, newOnly: boolean) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

/** Saved searches with total/new counts, plus save, rename and delete. */
function SavedSearchesSection({ searches, stats, activeId, canSave, suggestedName, onSave, onOpen, onDelete, onRename }: SavedSearchesProps) {
  // Editor ids: 'new' names a new saved search; otherwise it's the id being renamed.
  const edit = useInlineEdit();
  const naming = edit.editing === 'new';
  const saveNew: SaveFn = (name) => onSave(name);

  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Saved searches</h2>
        {!naming && (
          <button
            type="button"
            class="btn-text"
            disabled={!canSave}
            onClick={() => edit.start('new', suggestedName)}
            title={canSave ? 'Save the current filters' : 'Set some filters first, or this search is already saved'}
          >
            Save current
          </button>
        )}
      </div>
      {naming && (
        <div class="add-filter">
          <input type="text" aria-label="Name for saved search" {...edit.boxProps('new', saveNew)} />
          <button type="button" class="btn-text" onMouseDown={(e) => e.preventDefault()} onClick={() => edit.save('new', saveNew)}>
            Save
          </button>
        </div>
      )}
      {searches.length === 0 && !naming && (
        <p class="muted small">Set filters or a search, then save them here. New listings that match show up as a count after each catalog refresh.</p>
      )}
      <ul class="filter-list">
        {searches.map((s) => {
          const st = stats.get(s.id) ?? { total: 0, fresh: 0 };
          return (
            <li class={`filter-row saved-row ${s.id === activeId ? 'active' : ''}`}>
              <button
                type="button"
                class="filter-remove"
                aria-label={`Delete ${s.name}`}
                title="Delete saved search"
                onClick={() => confirm(`Delete saved search “${s.name}”?`) && onDelete(s.id)}
              >
                <Icon name="cancel" size={16} />
              </button>
              {edit.editing === s.id ? (
                <input class="rename" type="text" aria-label="Rename saved search" {...edit.boxProps(s.id, (name) => onRename(s.id, name))} />
              ) : (
                <button
                  type="button"
                  class="saved-name"
                  title="Click to open · double-click to rename"
                  onClick={() => onOpen(s, false)}
                  onDblClick={() => edit.start(s.id, s.name)}
                >
                  {s.name}
                </button>
              )}
              {st.fresh > 0 && (
                <button type="button" class="pill pill-new" title="Show only the new matches" onClick={() => onOpen(s, true)}>
                  {fmtCount(st.fresh)} new
                </button>
              )}
              <span class="count" title="Open lots matching, not counting hidden or regex-filtered lots">
                {fmtCount(st.total)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
