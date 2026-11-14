import { useState } from 'preact/hooks';

import { compileFilter } from '../../shared/filters';
import { KEYS, siteUrl } from '../../shared/keys';
import { Icon } from '../icons';
import { getSetting, setSetting } from '../settings';
import { filteredOnly, openFiltered, openHidden } from '../state';
import { fmtCount, openHandler } from '../util';
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
  onRemove: () => void;
  onSave: (next: string) => void;
}

// One regex per line: remove button, pattern (click to edit), match count.
function FilterRow({ pattern, count, onRemove, onSave }: FilterRowProps) {
  const edit = useInlineEdit();
  const editing = edit.editing != null;
  const ok = compileFilter(pattern) != null;
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
      <button
        type="button"
        class="filter-remove"
        aria-label={`Remove ${pattern}`}
        title="Remove filter"
        onClick={onRemove}
      >
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
          <span class={edit.error ? 'error small' : 'muted small'}>
            {edit.error ?? 'Enter to save · Esc to cancel'}
          </span>
        </div>
      ) : (
        <button
          type="button"
          class="filter-pattern"
          title={
            ok
              ? `/\\b(?:${pattern})\\b/i – click to edit`
              : 'Invalid regex – ignored. Click to edit'
          }
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
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </label>
  );
}

/** Regex title filters and the list of manually hidden lots. */
export function HideFilterSection({ matchCounts }: { matchCounts: Map<string, number> }) {
  const words = getSetting(KEYS.words);
  const setWords = (value: ReturnType<typeof getSetting<typeof KEYS.words>>) =>
    setSetting(KEYS.words, value);
  const filterOn = getSetting(KEYS.filterOn);
  const setFilterOn = (value: ReturnType<typeof getSetting<typeof KEYS.filterOn>>) =>
    setSetting(KEYS.filterOn, value);
  const removeFiltered = getSetting(KEYS.removeFiltered);
  const setRemoveFiltered = (value: ReturnType<typeof getSetting<typeof KEYS.removeFiltered>>) =>
    setSetting(KEYS.removeFiltered, value);
  const showHidden = getSetting(KEYS.showHidden);
  const setShowHidden = (value: ReturnType<typeof getSetting<typeof KEYS.showHidden>>) =>
    setSetting(KEYS.showHidden, value);
  const hiddenLots = getSetting(KEYS.hidden);
  const setHiddenLots = (value: ReturnType<typeof getSetting<typeof KEYS.hidden>>) =>
    setSetting(KEYS.hidden, value);
  const [input, setInput] = useState('');
  const add = () => {
    setWords([...new Set([...words, input])]);
    setInput('');
  };
  const unhide = (id: string) => {
    const { [id]: _, ...rest } = hiddenLots;
    setHiddenLots(rest);
  };
  const hidden = Object.entries(hiddenLots).toSorted((a, b) => b[1].ts - a[1].ts);

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
          {words.toSorted().map((w) => (
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
      <Switch
        label="Remove filtered lots instead of graying out"
        checked={removeFiltered}
        onChange={setRemoveFiltered}
      />
      <Switch label="Show hidden lots" checked={showHidden} onChange={setShowHidden} />

      <Collapsible id="hidden" title={`Hidden lots (${hidden.length})`}>
        <ul class="hidden-list">
          {hidden.map(([id, info]) => (
            <li>
              <a
                href={siteUrl(info.href)}
                title={info.title}
                onClick={openHandler(() => openHidden(Number(id)))}
              >
                {info.title || `Lot ${id}`}
              </a>
              <button
                type="button"
                class="icon-btn"
                title="Unhide"
                aria-label={`Unhide ${info.title}`}
                onClick={() => unhide(id)}
              >
                <Icon name="visibility" size={18} />
              </button>
            </li>
          ))}
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
