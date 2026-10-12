import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { compileFilter, splitFilters } from '../shared/filters';
import { DEFAULT_SYNC_MINUTES, KEYS, MIN_SYNC_MINUTES } from '../shared/keys';
import { useSetting } from './gm';
import { Icon } from './icons';
import { fmtCount, parseNum } from './util';
import {
  activeFilterCount,
  DEFAULT_VIEW,
  ENDING,
  MINE,
  type Facets,
  type SavedSearch,
  type SavedSearchStats,
  type ViewState,
} from './view';

interface Props {
  view: ViewState;
  setView: (patch: Partial<ViewState>) => void;
  facets: Facets;
  matchCounts: Map<string, number>;
  pickup: string;
  accountPickup: string | null;
  authed: boolean;
  onOpenHidden: (id: number) => void;
  saved: SavedSearchesProps;
}

export function Sidebar(props: Props) {
  return (
    <div class="sidebar-inner">
      <SavedSearchesSection {...props.saved} />
      <FiltersSection {...props} />
      <HideFilterSection matchCounts={props.matchCounts} onOpenHidden={props.onOpenHidden} />
      <SettingsSection pickup={props.pickup} accountPickup={props.accountPickup} locations={props.facets.locations.map((l) => l.name)} />
    </div>
  );
}

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

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function NumberField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => setText(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const n = parseNum(text);
    if (n !== value) onChange(n);
  };
  return (
    <label class="field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        placeholder="$"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}

function FiltersSection({ view, setView, facets, pickup, authed }: Props) {
  const n = activeFilterCount(view);
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
          {Object.entries(MINE).map(([k, label]) => (
            <option value={k} disabled={!!k && !authed}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label class="field">
        <span>Ending</span>
        <select value={view.ending} onChange={(e) => setView({ ending: e.currentTarget.value as ViewState['ending'] })}>
          {Object.entries(ENDING).map(([k, label]) => (
            <option value={k}>{label}</option>
          ))}
        </select>
      </label>

      <Collapsible id="f-location" title="Location">
        {facets.locations.map((l) => (
          <label class="check">
            <input type="checkbox" checked={view.locations.includes(l.name)} onChange={() => setView({ locations: toggle(view.locations, l.name) })} />
            <span>{l.name}</span>
            <span class="count">{fmtCount(l.count)}</span>
          </label>
        ))}
        <label class="check">
          <input type="checkbox" checked={view.reachable} onChange={() => setView({ reachable: !view.reachable })} />
          <span>Available at {pickup} (incl. transfers)</span>
        </label>
      </Collapsible>

      <Collapsible id="f-category" title="Category">
        {facets.categories.map((c) => (
          <label class="check">
            <input type="checkbox" checked={view.categories.includes(c.value)} onChange={() => setView({ categories: toggle(view.categories, c.value) })} />
            <span>{c.label}</span>
            <span class="count">{fmtCount(c.count)}</span>
          </label>
        ))}
      </Collapsible>

      <Collapsible id="f-condition" title="Condition">
        {facets.conditions.map((c) => (
          <label class="check">
            <input type="checkbox" checked={view.conditions.includes(c.value)} onChange={() => setView({ conditions: toggle(view.conditions, c.value) })} />
            <span>{c.label}</span>
            <span class="count">{fmtCount(c.count)}</span>
          </label>
        ))}
      </Collapsible>

      <Collapsible id="f-price" title="Price">
        <div class="field-row">
          <NumberField label="Bid min" value={view.priceMin} onChange={(v) => setView({ priceMin: v })} />
          <NumberField label="Bid max" value={view.priceMax} onChange={(v) => setView({ priceMax: v })} />
        </div>
        <div class="field-row">
          <NumberField label="Max est. total" value={view.totalMax} onChange={(v) => setView({ totalMax: v })} />
          <NumberField label="Min retail" value={view.retailMin} onChange={(v) => setView({ retailMin: v })} />
        </div>
      </Collapsible>
    </section>
  );
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
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(pattern);
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const ok = !!compileFilter(pattern);

  useEffect(() => {
    if (editing) box.current?.select();
  }, [editing]);

  const start = () => {
    setText(pattern);
    setErr(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setErr(null);
  };
  const save = () => {
    if (!editing) return;
    const next = text.trim();
    if (!next || next === pattern) return cancel();
    if (!compileFilter(next)) return setErr('Invalid regex');
    setEditing(false);
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
            class={err ? 'has-error' : ''}
            aria-label="Edit filter regex"
            spellcheck={false}
            rows={Math.min(6, Math.max(1, Math.ceil(text.length / 26)))}
            value={text}
            ref={box}
            onInput={(e) => {
              setText(e.currentTarget.value.replace(/\n/g, ''));
              setErr(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
            onBlur={save}
          />
          <span class={err ? 'error small' : 'muted small'}>{err ?? 'Enter to save · Esc to cancel'}</span>
        </div>
      ) : (
        <button
          type="button"
          class="filter-pattern"
          title={ok ? `/\\b(?:${pattern})\\b/i – click to edit` : 'Invalid regex – ignored. Click to edit'}
          onClick={start}
        >
          <PatternText pattern={pattern} />
        </button>
      )}
      {ok && !editing && <span class="count">{fmtCount(count)}</span>}
    </li>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="switch-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  );
}

function HideFilterSection({ matchCounts, onOpenHidden }: { matchCounts: Map<string, number>; onOpenHidden: (id: number) => void }) {
  const [words, setWords] = useSetting(KEYS.words);
  const [filterOn, setFilterOn] = useSetting(KEYS.filterOn);
  const [removeFiltered, setRemoveFiltered] = useSetting(KEYS.removeFiltered);
  const [showHidden, setShowHidden] = useSetting(KEYS.showHidden);
  const [hiddenLots, setHiddenLots] = useSetting(KEYS.hidden);
  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const add = () => {
    const list = splitFilters(input);
    if (!list.length) return;
    const bad = list.filter((p) => !compileFilter(p));
    if (bad.length) return setErr(`Invalid regex: ${bad.join(', ')}`);
    setWords([...words, ...list.filter((p) => !words.includes(p))]);
    setInput('');
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
          {words.map((w) => (
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

      <Switch label="Apply filters" checked={!!filterOn} onChange={setFilterOn} />
      <Switch label="Remove filtered lots instead of graying out" checked={!!removeFiltered} onChange={setRemoveFiltered} />
      <Switch label="Show hidden lots" checked={!!showHidden} onChange={setShowHidden} />

      <Collapsible id="hidden" title={`Hidden lots (${hidden.length})`}>
        <ul class="hidden-list">
          {hidden.map(([id, info]) => (
            <li>
              <a
                href={info.href}
                title={info.title}
                onClick={(e) => {
                  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  onOpenHidden(Number(id));
                }}
              >
                {info.title || `Lot ${id}`}
              </a>
              <button
                type="button"
                class="icon-btn"
                title="Unhide"
                aria-label={`Unhide ${info.title}`}
                onClick={() => {
                  const next = { ...hiddenLots };
                  delete next[id];
                  setHiddenLots(next);
                }}
              >
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

function SettingsSection({ pickup, accountPickup, locations }: { pickup: string; accountPickup: string | null; locations: string[] }) {
  const [minutes, setMinutes] = useSetting(KEYS.syncMinutes);
  const [override, setOverride] = useSetting(KEYS.pickup);
  const [text, setText] = useState(String(minutes));
  useEffect(() => setText(String(minutes)), [minutes]);
  const commit = () => {
    const n = Math.max(MIN_SYNC_MINUTES, Math.round(parseNum(text) ?? DEFAULT_SYNC_MINUTES));
    setText(String(n));
    if (n !== minutes) setMinutes(n);
  };
  const options = [...new Set([...locations, pickup])];
  return (
    <section class="panel">
      <Collapsible id="settings" title={<h2>Settings</h2>}>
        <label class="field">
          <span>Full catalog refresh at most every (minutes, min {MIN_SYNC_MINUTES})</span>
          <input
            type="number"
            min={MIN_SYNC_MINUTES}
            step={1}
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </label>
        <label class="field">
          <span>Pickup location (for transfer fees)</span>
          <select value={override ?? ''} onChange={(e) => setOverride(e.currentTarget.value || null)}>
            <option value="">Account default ({accountPickup ?? 'Raleigh'})</option>
            {options.map((o) => (
              <option value={o}>{o}</option>
            ))}
          </select>
        </label>
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

function SavedSearchesSection({ searches, stats, activeId, canSave, suggestedName, onSave, onOpen, onDelete, onRename }: SavedSearchesProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (naming || renaming) input.current?.select();
  }, [naming, renaming]);

  const startSave = () => {
    setName(suggestedName);
    setNaming(true);
  };
  const commitSave = () => {
    if (!naming) return;
    setNaming(false);
    if (name.trim()) onSave(name.trim());
  };
  const commitRename = (id: string) => {
    if (renaming !== id) return;
    setRenaming(null);
    if (name.trim()) onRename(id, name.trim());
  };
  const keys = (commit: () => void, cancel: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Saved searches</h2>
        {!naming && (
          <button type="button" class="btn-text" disabled={!canSave} onClick={startSave} title={canSave ? 'Save the current filters' : 'Set some filters first, or this search is already saved'}>
            Save current
          </button>
        )}
      </div>
      {naming && (
        <div class="add-filter">
          <input
            ref={input}
            type="text"
            aria-label="Name for saved search"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
            onKeyDown={keys(commitSave, () => setNaming(false))}
            onBlur={commitSave}
          />
          <button type="button" class="btn-text" onMouseDown={(e) => e.preventDefault()} onClick={commitSave}>
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
              <button type="button" class="filter-remove" aria-label={`Delete ${s.name}`} title="Delete saved search" onClick={() => confirm(`Delete saved search “${s.name}”?`) && onDelete(s.id)}>
                <Icon name="cancel" size={16} />
              </button>
              {renaming === s.id ? (
                <input
                  ref={input}
                  class="rename"
                  type="text"
                  aria-label="Rename saved search"
                  value={name}
                  onInput={(e) => setName(e.currentTarget.value)}
                  onKeyDown={keys(() => commitRename(s.id), () => setRenaming(null))}
                  onBlur={() => commitRename(s.id)}
                />
              ) : (
                <button
                  type="button"
                  class="saved-name"
                  title="Click to open · double-click to rename"
                  onClick={() => onOpen(s, false)}
                  onDblClick={() => {
                    setName(s.name);
                    setRenaming(s.id);
                  }}
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
