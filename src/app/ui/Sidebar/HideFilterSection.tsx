import { useState } from 'preact/hooks';

import { compileFilter } from '../../../shared/filters';
import * as format from '../../../shared/format';
import { KEYS, lotHref } from '../../../shared/keys';
import { lots } from '../../server/catalog';
import { useSetting } from '../../server/settings';
import { openHandler } from '../dom';
import { Icon } from '../icons';
import {
  filteredOnly,
  filteredPattern,
  filterFacets,
  openFiltered,
  openFilteredPattern,
  openFilteredType,
  openLot,
} from '../state';
import { Collapsible } from './Collapsible';
import { useInlineEdit, type SaveFn } from './useInlineEdit';

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
  onOpen: () => void;
  onRemove: () => void;
  onSave: (next: string) => void;
}

// One regex per line: remove button, pattern (click to edit, Option-click to view matches), match count.
function FilterRow({ pattern, count, onOpen, onRemove, onSave }: FilterRowProps) {
  const edit = useInlineEdit();
  const editing = edit.editing != null;
  const ok = compileFilter(pattern) != null;
  const save: SaveFn = next => {
    if (next === pattern) {
      return;
    }
    if (!compileFilter(next)) {
      return 'Invalid regex';
    }
    onSave(next);
    return;
  };

  let patternTitle = 'Invalid regex – ignored. Click to edit';
  if (ok) {
    patternTitle = `/\\b(?:${pattern})\\b/i – click to edit, Option-click to view filtered lots`;
  }
  let body = (
    <button
      type="button"
      class="filter-pattern"
      title={patternTitle}
      onClick={(e?: MouseEvent) => {
        if (e?.altKey && ok) {
          onOpen();
          return;
        }
        edit.start('pattern', pattern);
      }}
    >
      <PatternText pattern={pattern} />
    </button>
  );
  if (editing) {
    body = (
      <div class="filter-edit">
        <textarea
          class={edit.error ? 'has-error' : ''}
          aria-label="Edit filter regex"
          spellcheck={false}
          rows={Math.min(6, Math.max(1, Math.ceil(edit.text.length / 26)))}
          {...edit.boxProps('pattern', save)}
        />
        <span class={edit.error ? 'error small' : 'muted small'}>
          {edit.error ?? 'Enter to save · Esc to cancel'}
        </span>
      </div>
    );
  }

  return (
    <li class={`filter-row ${ok ? '' : 'filter-error'}`}>
      <button
        type="button"
        class="filter-remove"
        aria-label={`Remove ${pattern}`}
        title="Remove filter"
        onClick={onRemove}
      >
        <Icon name="cancel" size={16} />
      </button>
      {body}
      {ok && !editing && <span class="count">{format.num(count)}</span>}
    </li>
  );
}

/** Labeled on/off switch. */
function Switch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="switch-row">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={e => onChange(e.currentTarget.checked)}
      />
    </label>
  );
}

/** Regex title filters, item type filters, and the list of manually hidden lots. */
export function HideFilterSection({
  matchCounts,
  typeMatchCounts,
}: {
  matchCounts: Map<string, number>;
  typeMatchCounts: Map<string, number>;
}) {
  const [words, setWords] = useSetting(KEYS.words);
  const [filterTypes, setFilterTypes] = useSetting(KEYS.filterTypes);
  const [filterOn, setFilterOn] = useSetting(KEYS.filterOn);
  const [removeFiltered, setRemoveFiltered] = useSetting(KEYS.removeFiltered);
  const [showHidden, setShowHidden] = useSetting(KEYS.showHidden);
  const [hiddenLots, setHiddenLots] = useSetting(KEYS.hidden);
  const [input, setInput] = useState('');
  const [typeInput, setTypeInput] = useState('');
  const add = () => {
    setWords([...words, input].toUnique());
    setInput('');
  };
  const addType = () => {
    const next = typeInput
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    if (!next.length) {
      return;
    }
    setFilterTypes([...filterTypes, ...next].toUnique());
    setTypeInput('');
  };
  const unhide = (id: string) => {
    const { [id]: _, ...rest } = hiddenLots;
    setHiddenLots(rest);
  };
  const hidden = Object.entries(hiddenLots)
    .sortBy(([, h]) => h.ts)
    .toReversed();
  const filteredSet = filterTypes.map(t => t.trim().toLowerCase()).toSet();
  const typeSuggestions = filterFacets.value.types
    .map(t => t.value)
    .filter(t => !filteredSet.has(t.trim().toLowerCase()));

  return (
    <section class="panel">
      <h2>Hide &amp; filter</h2>
      <button
        type="button"
        class={`btn-text ${filteredOnly.value ? 'on' : ''}`}
        aria-pressed={filteredOnly.value}
        onClick={() => openFiltered()}
      >
        View filtered lots
      </button>
      <div class="add-filter">
        <input
          type="text"
          placeholder="Regex, e.g. batter(y|ies)"
          aria-label="Add filter regex"
          autocomplete="off"
          spellcheck={false}
          value={input}
          onInput={e => setInput(e.currentTarget.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
        />
        <button type="button" class="btn-text" onClick={add}>
          Add
        </button>
      </div>
      <p class="muted small">Case-insensitive, whole words: \b(?:pattern)\b. Commas add several.</p>

      <Collapsible id="words" title={`Filter patterns (${words.length})`}>
        <ul class="filter-list">
          {words.toSorted().map(w => (
            <FilterRow
              key={w}
              pattern={w}
              count={matchCounts.get(w) ?? 0}
              onOpen={() => openFilteredPattern(w)}
              onRemove={() => setWords(words.filter(x => x !== w))}
              onSave={next => {
                setWords(words.map(x => (x === w ? next : x)).toUnique());
                if (filteredPattern.peek() === w) {
                  filteredPattern.value = next;
                }
              }}
            />
          ))}
        </ul>
      </Collapsible>

      <Collapsible id="filterTypes" title={`Filtered item types (${filterTypes.length})`}>
        <div class="add-filter">
          <input
            type="text"
            placeholder="Item type, e.g. phone case"
            aria-label="Add item type filter"
            autocomplete="off"
            list="filter-type-options"
            value={typeInput}
            onInput={e => setTypeInput(e.currentTarget.value)}
            onKeyDown={e => e.key === 'Enter' && addType()}
          />
          <datalist id="filter-type-options">
            {typeSuggestions.map(t => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button type="button" class="btn-text" onClick={addType}>
            Add
          </button>
        </div>
        <ul class="filter-list">
          {filterTypes.toSorted().map(t => (
            <li key={t} class="filter-row">
              <button
                type="button"
                class="filter-remove"
                aria-label={`Remove ${t}`}
                title="Remove item type filter"
                onClick={() => setFilterTypes(filterTypes.filter(x => x !== t))}
              >
                <Icon name="cancel" size={16} />
              </button>
              <button
                type="button"
                class="filter-pattern filter-type-btn"
                title={`View filtered ${t} lots`}
                onClick={() => openFilteredType(t)}
              >
                {t}
              </button>
              <span class="count">{format.num(typeMatchCounts.get(t) ?? 0)}</span>
            </li>
          ))}
        </ul>
      </Collapsible>

      <Switch label="Apply filters" checked={filterOn} onChange={setFilterOn} />
      <Switch
        label="Remove filtered lots instead of graying out"
        checked={removeFiltered}
        onChange={setRemoveFiltered}
      />
      <Switch label="Show hidden lots" checked={showHidden} onChange={setShowHidden} />

      <Collapsible id="hidden" title={`Hidden lots (${hidden.length})`}>
        <ul class="hidden-list">
          {hidden.map(([id]) => {
            const lot = lots.value.get(Number(id));
            const label = lot?.title || `Lot ${id}`;
            return (
              <li key={id}>
                {lot ? (
                  <a
                    href={lotHref(lot.auction_period, lot.id)}
                    title={label}
                    onClick={openHandler(() => openLot(lot))}
                  >
                    {label}
                  </a>
                ) : (
                  <span class="muted" title={label}>
                    {label}
                  </span>
                )}
                <button
                  type="button"
                  class="icon-btn"
                  title="Unhide"
                  aria-label={`Unhide ${label}`}
                  onClick={() => unhide(id)}
                >
                  <Icon name="visibility" size={18} />
                </button>
              </li>
            );
          })}
        </ul>
        {hidden.length > 0 && (
          <button
            type="button"
            class="btn-text"
            onClick={() => confirm('Unhide all hidden lots?') && setHiddenLots({})}
          >
            Unhide all
          </button>
        )}
      </Collapsible>
    </section>
  );
}
