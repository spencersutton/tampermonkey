import { dequal } from 'dequal';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';

import * as format from '../../shared/format';
import { KEYS, type CustomCategory } from '../../shared/keys';
// Full-size editor for custom categories: add, rename, organize hierarchy,
// edit item types, and see how many open lots each one takes.
import {
  assignLotsToDrafts,
  buildCategoryRenames,
  buildEditorTree,
  categoryDraftError,
  clean,
  countItemTypes,
  descendantValues,
  draftValue,
  newCategoryId,
  normalizeType,
  parseAddedTypes,
  removeDraft,
  siteCategoriesFromLots,
  type CategoryDraft,
} from '../logic/categories';
import {
  categoryId,
  categoryPath,
  compareCategoryNames,
  customCategoryValue,
  isCustomCategory,
} from '../logic/view';
import { saveCustomCategories } from '../server/categories';
import { getSetting, setSetting } from '../server/settings';
import { Dialog } from './Dialog';
import { Icon } from './icons';

type Draft = CategoryDraft;

let nextKey = 0;
const toDraft = (c: CustomCategory): Draft => ({
  key: nextKey++,
  id: categoryId(c),
  from: customCategoryValue(c),
  name: c.name,
  parent: c.parent ?? null,
  types: c.types,
});

/** Dialog for managing custom categories. Changes apply only on Save. */
export function CategoryEditor({ lots, onClose }: { lots: Lot[]; onClose: () => void }) {
  const [initial] = useState(() => getSetting(KEYS.customCategories));
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft));
  const [baseline] = useState(() => drafts.map(clean));
  const [selected, setSelected] = useState<number | null>(null);
  const focusKey = useRef<number | null>(null);
  const editedName = useRef<{
    input: HTMLInputElement;
    start: number | null;
    end: number | null;
  } | null>(null);

  const dirty = !dequal(drafts.map(clean), baseline);
  const errors = new Map(drafts.map(d => [d.key, categoryDraftError(d, drafts)]));
  const valid = errors.values().every(e => !e);

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

  const siteCategories = useMemo(() => siteCategoriesFromLots(lots), [lots]);
  const siteLabels = useMemo(
    () => new Map(siteCategories.map(s => [s.value, s.label])),
    [siteCategories],
  );
  const cleanedCats = useMemo(() => drafts.map(clean), [drafts]);
  const rows = useMemo(() => buildEditorTree(drafts, siteCategories), [drafts, siteCategories]);

  // Which row takes each open lot, with counts.
  const taken = useMemo(() => assignLotsToDrafts(drafts, lots), [drafts, lots]);

  // Open lots of each item type, for the type chips and suggestions.
  const typeCounts = useMemo(() => countItemTypes(lots), [lots]);
  const typeSuggestions = useMemo(
    () =>
      typeCounts
        .entries()
        .toArray()
        .sortBy(([, n]) => n)
        .toReversed(),
    [typeCounts],
  );

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts(ds => ds.map(d => (d.key === key ? { ...d, ...patch } : d)));
  const add = (parent: string | null = null) => {
    const d: Draft = {
      key: nextKey++,
      id: newCategoryId(),
      from: null,
      name: '',
      parent,
      types: [],
    };
    setDrafts(ds => [...ds, d]);
    setSelected(d.key);
    focusKey.current = d.key;
  };
  const remove = (d: Draft) => {
    setDrafts(ds => removeDraft(ds, d));
    if (selected === d.key) {
      setSelected(null);
    }
  };
  const save = () => {
    if (!valid) {
      return;
    }
    saveCustomCategories(drafts.map(clean), buildCategoryRenames(initial, drafts));
    const created = drafts.findLast(d => d.from == null);
    if (created) {
      setSetting(KEYS.lastCategory, draftValue(created));
    }
    onClose();
  };

  const sel = drafts.find(d => d.key === selected);
  const selectedTypes = new Set(sel?.types.map(normalizeType));
  const customParentOptions = useMemo(
    () =>
      drafts
        .map((d, i) => ({
          draft: d,
          value: draftValue(d),
          label: categoryPath(cleanedCats[i]!, cleanedCats, siteLabels) || 'Untitled',
        }))
        .toSorted((a, b) => compareCategoryNames(a.label, b.label)),
    [drafts, cleanedCats, siteLabels],
  );

  return (
    <Dialog onClose={close} aria-labelledby="cat-editor-title">
      <div class="modal cat-editor" tabIndex={-1}>
        <div class="cat-head">
          <div>
            <h2 id="cat-editor-title">Custom categories</h2>
            <p class="muted small">
              Lots of a listed item type move into the category, regardless of site category. The
              first matching category alphabetically wins. Nest categories under a site or custom
              category using the Parent menu or + button.
            </p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div class="cat-body">
          {drafts.length === 0 && <p class="muted">No custom categories yet.</p>}
          {drafts.length > 0 && (
            <ol class="cat-list">
              {rows.map(row => {
                if (row.kind === 'site') {
                  return (
                    <li key={`site:${row.value}`} class="cat-site-header">
                      <span class="cat-site-name">{row.label}</span>
                      <span class="muted small">Site category</span>
                      <button
                        type="button"
                        class="icon-btn cat-add-sub"
                        aria-label={`Add subcategory under ${row.label}`}
                        title={`Add subcategory under ${row.label}`}
                        onClick={() => add(row.value)}
                      >
                        <Icon name="add" size={18} />
                      </button>
                    </li>
                  );
                }
                const { draft: d, depth } = row;
                const err = errors.get(d.key);
                const count = taken.get(d.key)!.length;
                const label = d.name.trim() || 'New category';
                const val = draftValue(d);
                const blocked = descendantValues(val, drafts);
                const hasChildren = drafts.some(o => o.parent === val);
                let deleteTitle = 'Delete category';
                if (hasChildren) {
                  deleteTitle = 'Delete category (subcategories will move up a level)';
                }
                const unknownSiteParent =
                  d.parent != null && !isCustomCategory(d.parent) && !siteLabels.has(d.parent);
                return (
                  <li
                    key={d.key}
                    data-key={d.key}
                    style={depth > 0 ? { '--depth': depth } : undefined}
                    class={[
                      'cat-row',
                      depth > 0 && 'cat-row-nested',
                      err && 'has-error',
                      d.key === selected && 'selected',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onFocusIn={() => setSelected(d.key)}
                    onMouseDown={() => setSelected(d.key)}
                  >
                    <input
                      ref={input => {
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
                      aria-describedby={err && d.key === selected ? 'cat-editor-error' : undefined}
                      title={err ?? undefined}
                      onInput={e => {
                        const input = e.currentTarget;
                        editedName.current = {
                          input,
                          start: input.selectionStart,
                          end: input.selectionEnd,
                        };
                        update(d.key, { name: input.value });
                      }}
                    />
                    <select
                      class="cat-parent-select"
                      aria-label={`Parent of ${label}`}
                      title="Parent category"
                      value={d.parent ?? ''}
                      onChange={e => update(d.key, { parent: e.currentTarget.value || null })}
                    >
                      <option value="">Top level</option>
                      {unknownSiteParent && <option value={d.parent!}>{d.parent}</option>}
                      {siteCategories.length > 0 && (
                        <optgroup label="Site categories">
                          {siteCategories.map(s => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {customParentOptions.some(o => !blocked.has(o.value)) && (
                        <optgroup label="Custom categories">
                          {customParentOptions
                            .filter(o => !blocked.has(o.value))
                            .map(o => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                    <TypeChips
                      types={d.types}
                      counts={typeCounts}
                      listId={`cat-types-${d.key}`}
                      category={label}
                      onChange={patch => update(d.key, patch)}
                    />
                    <span class="cat-count">{format.plural(count, 'lot')}</span>
                    <button
                      type="button"
                      class="icon-btn cat-add-sub"
                      aria-label={`Add subcategory under ${label}`}
                      title="Add subcategory"
                      onClick={() => add(val)}
                    >
                      <Icon name="add" size={18} />
                    </button>
                    <button
                      type="button"
                      class="icon-btn cat-delete"
                      aria-label={`Delete ${label}`}
                      title={deleteTitle}
                      onClick={() => remove(d)}
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <button type="button" class="btn btn-outline btn-small cat-add" onClick={() => add(null)}>
            <Icon name="add" size={18} /> Add category
          </button>
        </div>

        {/* Only the selected row needs suggestions; duplicating them for every row is expensive. */}
        {sel && (
          <datalist id={`cat-types-${sel.key}`}>
            {typeSuggestions
              .filter(([type]) => !selectedTypes.has(normalizeType(type)))
              .map(([type, count]) => (
                <option value={type}>{format.plural(count, 'open lot')}</option>
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
  /** Add the comma-separated types in `raw`. */
  const add = (raw: string) => {
    const next = parseAddedTypes(raw, types);
    if (next !== types) {
      onChange({ types: next });
    }
    setText('');
  };
  return (
    <div class="cat-types">
      <div class="type-chips">
        {types.map(t => {
          const n = counts.get(t) ?? 0;
          return (
            <span
              class={`type-chip ${n ? '' : 'type-chip-none'}`}
              title={
                n ? `${format.plural(n, 'open lot')} of this type` : 'No open lot has this type'
              }
            >
              {t} <span class="count">{n ? format.num(n) : 'none'}</span>
              <button
                type="button"
                class="filter-remove"
                aria-label={`Remove ${t}`}
                onClick={() => onChange({ types: types.filter(x => x !== t) })}
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
          onInput={e => {
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
          onKeyDown={e => {
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
