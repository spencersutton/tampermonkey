// Full-size editor for custom categories: add, rename, edit item types,
// and preview which open lots each one takes.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { KEYS, type CustomCategory } from '../shared/keys';
import { saveCustomCategories } from './categories';
import { getSetting, setSetting } from './settings';
import { Icon } from './icons';
import type { Lot } from './types';
import { Dialog } from './Dialog';
import { fmtCount, plural } from './util';
import { categoryIndex, compareCategoryNames, compileCategories } from './view';

/** A category being edited; `from` is its saved name (null if new), so renames can follow it. */
interface Draft {
  key: number;
  from: string | null;
  name: string;
  types: string[];
  within: string; // site category value, '' for any
}

const PREVIEW_LIMIT = 50;

let nextKey = 0;
export const toDraft = (c: CustomCategory): Draft => ({
  key: nextKey++,
  from: c.name,
  name: c.name,
  types: c.types ?? [],
  within: c.within ?? '',
});

/** The category a draft saves as. */
export const clean = (d: Draft): CustomCategory => {
  return { name: d.name.trim(), ...(d.types.length && { types: d.types }), ...(d.within && { within: d.within }) };
};

/** One-line description of a row: where it takes lots from and what it matches. */
function summary(d: Draft, sites: { value: string; label: string }[]): string {
  const where = d.within ? (sites.find((c) => c.value === d.within)?.label ?? d.within) : 'Any category';
  const what = [d.types.length && plural(d.types.length, 'type')].filter(Boolean);
  return [where, ...what].join(' · ');
}

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
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const dirty = JSON.stringify(drafts.map(clean)) !== baseline;
  const errors = new Map(drafts.map((d) => [d.key, rowError(d, drafts)]));
  const valid = [...errors.values()].every((e) => !e);

  const close = () => {
    if (!dirty || confirm('Discard your changes to custom categories?')) {
      onClose();
    }
  };
  // Focus the name box of a row just added.
  useEffect(() => {
    if (focusKey != null) {
      list.current?.querySelector<HTMLInputElement>(`[data-key="${focusKey}"] input`)?.focus();
      setFocusKey(null);
    }
  }, [focusKey]);

  // Site categories a row can be limited to: those of the open lots, plus any
  // already chosen that no open lot is in right now.
  const siteCategories = useMemo(() => {
    const byValue = new Map<string, string>();
    for (const l of lots) {
      if (l.category) {
        byValue.set(l.category.value, l.category.label);
      }
    }
    for (const d of drafts) {
      if (d.within && !byValue.has(d.within)) {
        byValue.set(d.within, d.within);
      }
    }
    return [...byValue].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [lots, drafts.map((d) => d.within).join('\u0000')]);

  // Which row takes each open lot, with counts.
  const assignment = useMemo(() => {
    const cats = drafts.map(clean);
    const compiled = compileCategories(cats);
    const taken = new Map<number, Lot[]>(drafts.map((d) => [d.key, []]));
    for (const lot of lots) {
      const owner = categoryIndex(lot, compiled);
      if (owner >= 0) {
        taken.get(drafts[owner].key)!.push(lot);
      }
    }
    return { taken };
  }, [drafts, lots]);

  // Open lots of each item type, per site category ('' = all of them), for the type chips and suggestions.
  const typeCounts = useMemo(() => {
    const by = new Map<string, Map<string, number>>([['', new Map()]]);
    for (const l of lots) {
      if (l.itemType) {
        for (const scope of new Set(['', l.category?.value ?? ''])) {
          const m = by.get(scope) ?? by.set(scope, new Map()).get(scope)!;
          m.set(l.itemType, (m.get(l.itemType) ?? 0) + 1);
        }
      }
    }
    return by;
  }, [lots]);
  const countsFor = (within: string) => typeCounts.get(within) ?? new Map<string, number>();

  const update = (key: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const add = () => {
    const d: Draft = { key: nextKey++, from: null, name: '', types: [], within: '' };
    setDrafts((ds) => [...ds, d]);
    setSelected(d.key);
    setFocusKey(d.key);
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
  const selLots = sel ? assignment.taken.get(sel.key)! : [];

  return (
    <Dialog onClose={close} aria-labelledby="cat-editor-title">
      <div class="modal cat-editor" tabIndex={-1}>
        <div class="cat-head">
          <div>
            <h2 id="cat-editor-title">Custom categories</h2>
            <p class="muted small">
              Lots of a listed item type move into the category. A category restricted to the lot's site category takes precedence over an unrestricted
              category; otherwise the first matching category alphabetically wins. Click a category to edit it. Name it “Parent - Name” to
              nest it under a site or custom category, e.g. “Tools - Drills - Cordless”.
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
            <ol class="cat-list" ref={list}>
              {[...drafts].sort((a, b) => compareCategoryNames(a.name, b.name)).map((d) => {
                const err = errors.get(d.key);
                const count = assignment.taken.get(d.key)!.length;
                const open = d.key === selected;
                const label = d.name.trim() || 'New category';
                return (
                  <li
                    key={d.key}
                    data-key={d.key}
                    class={[
                      'cat-row',
                      err && 'has-error',
                      open && 'selected',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div class="cat-line">
                      <button
                        type="button"
                        class="cat-summary"
                        aria-expanded={open}
                        title={open ? 'Close' : 'Edit'}
                        onClick={() => setSelected(open ? null : d.key)}
                      >
                        <span class="cat-title">{label}</span>
                        <span class={err ? 'error small' : 'muted small'}>{err ?? summary(d, siteCategories)}</span>
                        <span class="cat-count">
                          {plural(count, 'lot')}
                        </span>
                        <Icon name="expandMore" size={18} />
                      </button>
                    </div>
                    {open && (
                      <div class="cat-fields">
                        <label class="field cat-name">
                          <span>Name</span>
                          <input type="text" value={d.name} placeholder="e.g. Tools - Pressure Washers" onInput={(e) => update(d.key, { name: e.currentTarget.value })} />
                        </label>
                        <label class="field cat-within">
                          <span>Only within</span>
                          <select value={d.within} onChange={(e) => update(d.key, { within: e.currentTarget.value })}>
                            <option value="">Any site category</option>
                            {siteCategories.map((c) => (
                              <option value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </label>
                        <TypeChips
                          types={d.types}
                          counts={countsFor(d.within)}
                          listId={`cat-types-${d.within}`}
                          onChange={(patch) => update(d.key, patch)}
                        />
                        <div class="cat-actions">
                          <button type="button" class="btn-text cat-delete" onClick={() => remove(d)}>
                            <Icon name="delete" size={16} /> Delete
                          </button>
                        </div>
                      </div>
                    )}
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
                {selLots.length > PREVIEW_LIMIT && <li class="muted small">…and {fmtCount(selLots.length - PREVIEW_LIMIT)} more</li>}
              </ul>
            ) : (
              <p class="muted small">No open lots match.</p>
            )}
          </section>
        )}

        {/* One list of suggestions per "Only within" choice in use, most common types first. */}
        {[...new Set(drafts.map((d) => d.within))].map((w) => (
          <datalist id={`cat-types-${w}`}>
            {[...countsFor(w)]
              .sort((a, b) => b[1] - a[1])
              .map(([t, n]) => (
                <option value={t}>{plural(n, 'open lot')}</option>
              ))}
          </datalist>
        ))}

        <div class="cat-foot">
          {!valid && <span class="error small">Fix the highlighted rows to save.</span>}
          <button type="button" class="btn btn-outline" onClick={close}>
            Cancel
          </button>
          <button type="button" class="btn" onClick={save} aria-disabled={valid ? undefined : 'true'}>
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * The item types of a category as chips, each with how many open lots in its
 * scope have that type (flagged when none do), plus a box that suggests the
 * types lots really have. Enter, a comma or leaving the box adds what's typed.
 */
function TypeChips({ types, counts, listId, onChange }: {
  types: string[];
  counts: Map<string, number>;
  listId: string;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const [text, setText] = useState('');
  /** Add the comma-separated types in `raw`. */
  const add = (raw: string) => {
    const fresh = raw.split(',').map((t) => t.trim().toLowerCase().replace(/\s+/g, ' ')).filter((t) => t && !types.includes(t));
    if (fresh.length) {
      onChange({ types: [...new Set([...types, ...fresh])] });
    }
    setText('');
  };
  return (
    <div class="field cat-types">
      <span>Item types</span>
      <div class="type-chips">
        {types.map((t) => {
          const n = counts.get(t) ?? 0;
          return (
            <span class={`type-chip ${n ? '' : 'type-chip-none'}`} title={n ? `${plural(n, 'open lot')} of this type` : 'No open lot has this type'}>
              {t} <span class="count">{n ? fmtCount(n) : 'none'}</span>
              <button type="button" class="filter-remove" aria-label={`Remove ${t}`} onClick={() => onChange({ types: types.filter((x) => x !== t) })}>
                <Icon name="cancel" size={14} />
              </button>
            </span>
          );
        })}
        <input
          type="text"
          list={listId}
          value={text}
          aria-label="Add item type"
          placeholder={types.length ? 'Add type…' : 'e.g. pressure washer'}
          spellcheck={false}
          onInput={(e) => {
            const v = e.currentTarget.value;
            // Picking a suggestion fills in a whole known type: add it straight away.
            if (v.includes(',') || (counts.has(v) && !(e as InputEvent).inputType?.startsWith('insertText'))) {
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
