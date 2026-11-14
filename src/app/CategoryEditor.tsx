// Full-size editor for custom categories: add, rename, edit item types,
// and preview which open lots each one takes.
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import { KEYS, type CustomCategory } from '../shared/keys';
import { saveCustomCategories } from './categories';
import { Dialog } from './Dialog';
import { Icon } from './icons';
import { getSetting, setSetting } from './settings';
import type { Lot } from './types';
import { fmtCount, plural } from './util';
import { categoryIndex, compareCategoryNames, compileCategories } from './view';

/** A category being edited; `from` is its saved name (null if new), so renames can follow it. */
interface Draft {
  key: number;
  from: string | null;
  name: string;
  types: string[];
}

const PREVIEW_LIMIT = 50;

let nextKey = 0;
export const toDraft = (c: CustomCategory): Draft => ({
  key: nextKey++,
  from: c.name,
  name: c.name,
  types: c.types,
});

/** The category a draft saves as. */
export const clean = (d: Draft): CustomCategory => ({ name: d.name.trim(), types: d.types });

/** What's wrong with a row, if anything. */
export function rowError(d: Draft, drafts: Draft[]): string | null {
  const name = d.name.trim();
  if (!name) {
    return 'Name is required';
  }
  if (drafts.some((o) => o !== d && o.name.trim().toLowerCase() === name.toLowerCase())) {
    return 'Another category has this name';
  }
  if (!d.types.length && !drafts.some((o) => o !== d && o.name.trim().startsWith(`${name} - `))) {
    return 'Add item types';
  }
  return null;
}

/** Dialog for managing custom categories. Changes apply only on Save. */
export function CategoryEditor({ lots, onClose }: { lots: Lot[]; onClose: () => void }) {
  const [initial] = useState(() => getSetting(KEYS.customCategories));
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft));
  const [baseline] = useState(() => JSON.stringify(drafts.map(clean)));
  const [selected, setSelected] = useState<number | null>(null);
  const focusKey = useRef<number | null>(null);
  const editedName = useRef<{
    input: HTMLInputElement;
    start: number | null;
    end: number | null;
  } | null>(null);

  const dirty = JSON.stringify(drafts.map(clean)) !== baseline;
  const errors = new Map(drafts.map((d) => [d.key, rowError(d, drafts)]));
  const valid = [...errors.values()].every((e) => !e);

  const close = () => {
    if (!dirty || confirm('Discard your changes to custom categories?')) {
      onClose();
    }
  };
  useLayoutEffect(() => {
    const edited = editedName.current;
    editedName.current = null;
    if (edited && edited.input.isConnected && document.activeElement !== edited.input) {
      edited.input.focus();
      edited.input.setSelectionRange(edited.start, edited.end);
    }
  }, [drafts]);

  // Which row takes each open lot, with counts.
  const taken = useMemo(() => {
    const cats = drafts.map(clean);
    const compiled = compileCategories(cats);
    const taken = new Map<number, Lot[]>(drafts.map((d) => [d.key, []]));
    for (const lot of lots) {
      const owner = categoryIndex(lot, compiled);
      if (owner >= 0) {
        taken.get(drafts[owner]!.key)!.push(lot);
      }
    }
    return taken;
  }, [drafts, lots]);

  // Open lots of each item type, for the type chips and suggestions.
  const typeCounts = useMemo(() => {
    const by = new Map<string, number>();
    for (const l of lots) {
      if (l.itemType) {
        by.set(l.itemType, (by.get(l.itemType) ?? 0) + 1);
      }
    }
    return by;
  }, [lots]);
  const typeSuggestions = useMemo(
    () => [...typeCounts].toSorted((a, b) => b[1] - a[1]),
    [typeCounts],
  );

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const add = () => {
    const d: Draft = { key: nextKey++, from: null, name: '', types: [] };
    setDrafts((ds) => [...ds, d]);
    setSelected(d.key);
    focusKey.current = d.key;
  };
  const remove = (d: Draft) => {
    setDrafts((ds) => ds.filter((x) => x.key !== d.key));
    if (selected === d.key) {
      setSelected(null);
    }
  };
  const save = () => {
    if (!valid) {
      return;
    }
    const renames = new Map<string, string | null>(initial.map((c) => [c.name, null]));
    for (const d of drafts) {
      if (d.from != null) {
        renames.set(d.from, d.name.trim());
      }
    }
    saveCustomCategories(drafts.map(clean), renames);
    const created = drafts.findLast((d) => d.from == null);
    if (created) {
      setSetting(KEYS.lastCategory, created.name.trim());
    }
    onClose();
  };

  const sel = drafts.find((d) => d.key === selected);
  const selLots = sel ? taken.get(sel.key)! : [];
  const selectedTypes = new Set(sel?.types.map(normalizeType));

  return (
    <Dialog onClose={close} aria-labelledby="cat-editor-title">
      <div class="modal cat-editor" tabIndex={-1}>
        <div class="cat-head">
          <div>
            <h2 id="cat-editor-title">Custom categories</h2>
            <p class="muted small">
              Lots of a listed item type move into the category, regardless of site category. The
              first matching category alphabetically wins. Select a row to preview its lots. Name it
              “Parent - Name” to nest it under a site or custom category, e.g. “Tools - Drills -
              Cordless”.
            </p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div class="cat-body">
          {drafts.length === 0 ? (
            <p class="muted">No custom categories yet.</p>
          ) : (
            <ol class="cat-list">
              {[...drafts]
                .toSorted((a, b) => compareCategoryNames(a.name, b.name))
                .map((d) => {
                  const err = errors.get(d.key);
                  const count = taken.get(d.key)!.length;
                  const label = d.name.trim() || 'New category';
                  return (
                    <li
                      key={d.key}
                      data-key={d.key}
                      class={['cat-row', err && 'has-error', d.key === selected && 'selected']
                        .filter(Boolean)
                        .join(' ')}
                      onFocusIn={() => setSelected(d.key)}
                      onMouseDown={() => setSelected(d.key)}
                    >
                      <input
                        ref={(input) => {
                          if (input && focusKey.current === d.key) {
                            focusKey.current = null;
                            input.focus();
                          }
                        }}
                        class="cat-name"
                        type="text"
                        value={d.name}
                        placeholder="Category name"
                        aria-label={`Name of ${label}`}
                        aria-invalid={err ? 'true' : undefined}
                        aria-describedby={
                          err && d.key === selected ? 'cat-editor-error' : undefined
                        }
                        title={err ?? undefined}
                        onInput={(e) => {
                          const input = e.currentTarget;
                          editedName.current = {
                            input,
                            start: input.selectionStart,
                            end: input.selectionEnd,
                          };
                          update(d.key, { name: input.value });
                        }}
                      />
                      <TypeChips
                        types={d.types}
                        counts={typeCounts}
                        listId={`cat-types-${d.key}`}
                        category={label}
                        onChange={(patch) => update(d.key, patch)}
                      />
                      <span class="cat-count">{plural(count, 'lot')}</span>
                      <button
                        type="button"
                        class="icon-btn cat-delete"
                        aria-label={`Delete ${label}`}
                        title="Delete category"
                        onClick={() => remove(d)}
                      >
                        <Icon name="delete" size={18} />
                      </button>
                    </li>
                  );
                })}
            </ol>
          )}
          <button type="button" class="btn btn-outline btn-small cat-add" onClick={add}>
            <Icon name="add" size={18} /> Add category
          </button>
        </div>

        {sel && (
          <section class="cat-preview" aria-labelledby="cat-preview-title">
            <h3 id="cat-preview-title">
              {sel.name.trim() || 'New category'} · {plural(selLots.length, 'open lot')}
            </h3>
            {selLots.length ? (
              <ul>
                {selLots.slice(0, PREVIEW_LIMIT).map((l) => (
                  <li key={l.id}>
                    <span>{l.title}</span>
                    {l.category && <span class="muted small">{l.category.label}</span>}
                  </li>
                ))}
                {selLots.length > PREVIEW_LIMIT && (
                  <li class="muted small">…and {fmtCount(selLots.length - PREVIEW_LIMIT)} more</li>
                )}
              </ul>
            ) : (
              <p class="muted small">No open lots match.</p>
            )}
          </section>
        )}

        {/* Only the selected row needs suggestions; duplicating them for every row is expensive. */}
        {sel && (
          <datalist id={`cat-types-${sel.key}`}>
            {typeSuggestions
              .filter(([type]) => !selectedTypes.has(normalizeType(type)))
              .map(([type, count]) => (
                <option value={type}>{plural(count, 'open lot')}</option>
              ))}
          </datalist>
        )}

        <div class="cat-foot">
          {!valid && (
            <span id="cat-editor-error" class="error small">
              {(sel && errors.get(sel.key)) || 'Fix the highlighted rows to save.'}
            </span>
          )}
          <button type="button" class="btn btn-outline" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            class="btn"
            onClick={save}
            aria-disabled={valid ? undefined : 'true'}
          >
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The item types of a category as chips, each with how many open lots have that type (flagged when
 * none do), plus a box that suggests the types lots really have. Enter, a comma or leaving the box
 * adds what's typed.
 */
const normalizeType = (type: string) => type.trim().toLowerCase().replace(/\s+/g, ' ');

function TypeChips({
  types,
  counts,
  listId,
  category,
  onChange,
}: {
  types: string[];
  counts: Map<string, number>;
  listId: string;
  category: string;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const [text, setText] = useState('');
  const existing = new Set(types.map(normalizeType));
  /** Add the comma-separated types in `raw`. */
  const add = (raw: string) => {
    const fresh = raw
      .split(',')
      .map(normalizeType)
      .filter((t) => t && !existing.has(t));
    if (fresh.length) {
      onChange({ types: [...new Set([...types, ...fresh])] });
    }
    setText('');
  };
  return (
    <div class="cat-types">
      <div class="type-chips">
        {types.map((t) => {
          const n = counts.get(t) ?? 0;
          return (
            <span
              class={`type-chip ${n ? '' : 'type-chip-none'}`}
              title={n ? `${plural(n, 'open lot')} of this type` : 'No open lot has this type'}
            >
              {t} <span class="count">{n ? fmtCount(n) : 'none'}</span>
              <button
                type="button"
                class="filter-remove"
                aria-label={`Remove ${t}`}
                onClick={() => onChange({ types: types.filter((x) => x !== t) })}
              >
                <Icon name="cancel" size={14} />
              </button>
            </span>
          );
        })}
        <input
          type="text"
          list={listId}
          value={text}
          aria-label={`Add item type to ${category}`}
          placeholder={types.length ? 'Add type…' : 'e.g. pressure washer'}
          spellcheck={false}
          onInput={(e) => {
            const v = e.currentTarget.value;
            // Picking a suggestion fills in a whole known type: add it straight away.
            if (
              v.includes(',') ||
              (counts.has(v) &&
                !(
                  'inputType' in e &&
                  typeof e.inputType === 'string' &&
                  e.inputType.startsWith('insertText')
                ))
            ) {
              add(v);
            } else {
              setText(v);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            } else if (e.key === 'Backspace' && !text && types.length) {
              onChange({ types: types.slice(0, -1) });
            }
          }}
          onBlur={() => add(text)}
        />
      </div>
    </div>
  );
}
