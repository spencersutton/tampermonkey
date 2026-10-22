import type { ComponentChildren, InputHTMLAttributes } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { compileFilter } from '../shared/filters';
import { DEFAULT_SYNC_MINUTES, DEFAULT_TITLE_LINES, KEYS, MIN_SYNC_MINUTES, siteUrl } from '../shared/keys';
import { source } from '@source';
import { useSetting } from './gm';
import { Icon } from './icons';
import { fmtCount, openHandler, parseNum } from './util';
import { activeFilterCount, DEFAULT_VIEW, ENDING, MINE, type Facet, type Facets, type SavedSearch, type SavedSearchStats, type ViewState } from './view';

interface Props {
  view: ViewState;
  setView: (patch: Partial<ViewState>) => void;
  facets: Facets;
  matchCounts: Map<string, number>;
  pickup: string;
  accountPickup: string | null;
  authed: boolean;
  onOpenHidden: (id: number) => void;
  onEditCategories: () => void;
  onEditSortRules: () => void;
  saved: SavedSearchesProps;
}

/** Left sidebar: saved searches, filters, hide/regex filters and settings. */
export function Sidebar(props: Props) {
  return (
    <div class="sidebar-inner">
      <SavedSearchesSection {...props.saved} />
      <FiltersSection {...props} />
      <HideFilterSection matchCounts={props.matchCounts} onOpenHidden={props.onOpenHidden} />
      <SettingsSection
        pickup={props.pickup}
        accountPickup={props.accountPickup}
        locations={props.facets.locations.map((l) => l.value)}
        onEditSortRules={props.onEditSortRules}
      />
    </div>
  );
}

/** Section whose open/closed state is remembered across sessions. */
function Collapsible({ id, title, children }: { id: string; title: ComponentChildren; children: ComponentChildren }) {
  const [collapsed, setCollapsed] = useSetting(KEYS.collapsed);
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
function CheckList<T>({ facets, selected, onChange }: { facets: Facet<T>[]; selected: T[]; onChange: (next: T[]) => void }) {
  const toggle = (v: T) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <>
      {facets.map((f) => (
        <label class="check">
          <input type="checkbox" checked={selected.includes(f.value)} onChange={() => toggle(f.value)} />
          <span>{f.label}</span>
          <span class="count">{fmtCount(f.count)}</span>
        </label>
      ))}
    </>
  );
}

type NumberInputProps<T> = {
  label: string;
  value: T;
  parse: (text: string) => T;
  onChange: (v: T) => void;
} & Omit<InputHTMLAttributes, 'label' | 'value' | 'onChange'>;

/** Number input that commits on blur or Enter; `parse` turns the typed text into the value. */
function NumberInput<T extends number | null>({ label, value, parse, onChange, ...input }: NumberInputProps<T>) {
  const format = (v: T) => (v == null ? '' : String(v));
  const [text, setText] = useState(format(value));
  useEffect(() => setText(format(value)), [value]);
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
function FiltersSection({ view, setView, facets, pickup, authed, onEditCategories }: Props) {
  const n = activeFilterCount(view);
  const [custom] = useSetting(KEYS.customCategories);
  const customCount = custom.length;
  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Filters</h2>
        {n > 0 && (
          <button type="button" class="btn-text" onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort })}>
            Clear ({n})
          </button>
        )}
      </div>

      <label class="field">
        <span>My lots</span>
        <select value={view.mine} onChange={(e) => setView({ mine: e.currentTarget.value as ViewState['mine'] })}>
          {Object.entries(MINE).map(([k, { label }]) => (
            <option value={k} disabled={!!k && !authed}>
              {label}
            </option>
          ))}
        </select>
      </label>

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
        <CheckList facets={facets.categories} selected={view.categories} onChange={(categories) => setView({ categories })} />
        <button type="button" class="btn-text cat-edit-btn" onClick={onEditCategories}>
          <Icon name="edit" size={16} /> {customCount ? `Edit custom categories (${customCount})` : 'Add custom categories'}
        </button>
      </Collapsible>

      <Collapsible id="f-condition" title="Condition">
        <CheckList facets={facets.conditions} selected={view.conditions} onChange={(conditions) => setView({ conditions })} />
      </Collapsible>

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

/**
 * Inline text editors, one open at a time (identified by an id). Enter or
 * blur saves the trimmed text (empty just closes), Escape cancels.
 */
function useInlineEdit() {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Which editor is open, updated synchronously: Enter closes the editor, and
  // removing the focused box then fires a blur whose handler still sees the
  // old state – this keeps that second save from running.
  const open = useRef<string | null>(null);

  useEffect(() => {
    if (editing != null) {
      box.current?.select();
    }
  }, [editing]);

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
    ref: box,
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

// One filter per line: remove button, pattern (click to edit), match count.
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
      {ok && !editing && <span class="count">{fmtCount(count)}</span>}
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
function HideFilterSection({ matchCounts, onOpenHidden }: { matchCounts: Map<string, number>; onOpenHidden: (id: number) => void }) {
  const [words, setWords] = useSetting(KEYS.words);
  const [filterOn, setFilterOn] = useSetting(KEYS.filterOn);
  const [removeFiltered, setRemoveFiltered] = useSetting(KEYS.removeFiltered);
  const [showHidden, setShowHidden] = useSetting(KEYS.showHidden);
  const [hiddenLots, setHiddenLots] = useSetting(KEYS.hidden);
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);

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
      <div class={`add-filter ${err ? 'has-error' : ''}`}>
        <input
          type="text"
          placeholder="Regex, e.g. batter(y|ies)"
          aria-label="Add filter regex"
          autocomplete="off"
          spellcheck={false}
          value={input}
          onInput={(e) => {
            setInput(e.currentTarget.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button type="button" class="btn-text" onClick={add}>
          Add
        </button>
      </div>
      {err ? <p class="error small">{err}</p> : <p class="muted small">Case-insensitive, whole words: \b(?:pattern)\b. Commas add several.</p>}

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
              <a href={siteUrl(info.href)} title={info.title} onClick={openHandler(() => onOpenHidden(Number(id)))}>
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

/** Pickup location and full-refresh interval settings, plus the build's own (the server address in the server build). */
function SettingsSection({
  pickup,
  accountPickup,
  locations,
  onEditSortRules,
}: {
  pickup: string;
  accountPickup: string | null;
  locations: string[];
  onEditSortRules: () => void;
}) {
  const [minutes, setMinutes] = useSetting(KEYS.syncMinutes);
  const [sortRules] = useSetting(KEYS.sortRules);
  const [override, setOverride] = useSetting(KEYS.pickup);
  const [titleLines, setTitleLines] = useSetting(KEYS.titleLines);
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
        <label class="field">
          <span>Pickup location (for transfer fees)</span>
          <select value={override ?? ''} onChange={(e) => setOverride(e.currentTarget.value || null)}>
            <option value="">Account default ({accountPickup ?? 'Raleigh'})</option>
            {[...new Set([...locations, pickup])].map((o) => (
              <option value={o}>{o}</option>
            ))}
          </select>
        </label>
        <button type="button" class="btn-text cat-edit-btn" onClick={onEditSortRules}>
          <Icon name="edit" size={16} /> {sortRules.length ? `Edit title sort rules (${sortRules.length})` : 'Add title sort rules'}
        </button>
        <source.Settings />
      </Collapsible>
    </section>
  );
}

export interface SavedSearchesProps {
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
