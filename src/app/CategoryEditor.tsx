// Full-size editor for custom categories: add, rename, reorder (drag or
// arrows), edit the item types and regex, and preview which open lots each one takes.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { compileFilter } from '../shared/filters';
import { KEYS, type CustomCategory } from '../shared/keys';
import { getSetting, setSetting } from './settings';
import { Icon } from './icons';
import type { Lot } from './types';
import { fmtCount, plural, useDialog } from './util';
import { categoryIndex, compileCategories, customCategoryValue, normalizeView } from './view';

/** A category being edited; `from` is its saved name (null if new), so renames can follow it. */
interface Draft {
  key: number;
  from: string | null;
  name: string;
  types: string; // comma-separated
  pattern: string;
  within: string; // site category value, '' for any
}

/** Matching titles listed in the preview. */
const PREVIEW_LIMIT = 50;

let nextKey = 0;
const toDraft = (c: CustomCategory): Draft => ({
  key: nextKey++,
  from: c.name,
  name: c.name,
  types: (c.types ?? []).join(', '),
  pattern: c.pattern ?? '',
  within: c.within ?? '',
});

/** The item types in a draft's box. */
const draftTypes = (d: Draft) => [...new Set(d.types.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];

/** The category a draft saves as. */
const clean = (d: Draft): CustomCategory => {
  const types = draftTypes(d);
  return { name: d.name.trim(), ...(types.length && { types }), ...(d.pattern.trim() && { pattern: d.pattern.trim() }), ...(d.within && { within: d.within }) };
};

/** What's wrong with a row, if anything. */
function rowError(d: Draft, drafts: Draft[]): string | null {
  const name = d.name.trim();
  if (!name) {
    return 'Name is required';
  }
  if (drafts.some((o) => o !== d && o.name.trim().toLowerCase() === name.toLowerCase())) {
    return 'Another category has this name';
  }
  if (!d.pattern.trim() && !draftTypes(d).length) {
    return 'Add item types or a regex';
  }
  if (d.pattern.trim() && !compileFilter(d.pattern.trim())) {
    return 'Invalid regex';
  }
  return null;
}

/**
 * Point category filters at renamed categories and drop deleted ones, in the
 * current view and in every saved search.
 */
export function migrateFilters(renames: Map<string, string | null>) {
  const fix = (cats: string[]) =>
    cats.flatMap((v) => {
      const old = [...renames.keys()].find((n) => customCategoryValue(n) === v);
      if (old === undefined) {
        return [v];
      }
      const next = renames.get(old);
      return next == null ? [] : [customCategoryValue(next)];
    });
  const view = normalizeView(getSetting(KEYS.view));
  setSetting(KEYS.view, { ...view, categories: fix(view.categories) });
  const searches = getSetting(KEYS.savedSearches);
  setSetting(
    KEYS.savedSearches,
    searches.map((s) => ({ ...s, view: { ...s.view, categories: fix(s.view.categories ?? []) } })),
  );
}

/** Dialog for managing custom categories. Changes apply only on Apply or Save. */
export function CategoryEditor({ lots, onClose }: { lots: Lot[]; onClose: () => void }) {
  const [initial, setInitial] = useState(() => getSetting(KEYS.customCategories));
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft));
  const [selected, setSelected] = useState<number | null>(drafts[0]?.key ?? null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);

  const dirty = JSON.stringify(drafts.map(clean)) !== JSON.stringify(initial);
  const errors = new Map(drafts.map((d) => [d.key, rowError(d, drafts)]));
  const valid = [...errors.values()].every((e) => !e);

  const close = () => {
    if (!dirty || confirm('Discard your changes to custom categories?')) {
      onClose();
    }
  };
  useDialog(dialog, (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);
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

  // Which row takes each open lot, with counts, plus lots a row's regex
  // matches that another row took (by item type, or by a regex above it).
  const assignment = useMemo(() => {
    const cats = drafts.map(clean);
    const compiled = compileCategories(cats);
    const taken = new Map<number, Lot[]>(drafts.map((d) => [d.key, []]));
    const shadowed = new Map<number, number>(drafts.map((d) => [d.key, 0]));
    for (const lot of lots) {
      const owner = categoryIndex(lot, compiled);
      if (owner >= 0) {
        taken.get(drafts[owner].key)!.push(lot);
      }
      for (const { i, re, within } of compiled.regexes) {
        if (i !== owner && (!within || within === lot.category?.value) && re.test(lot.title)) {
          shadowed.set(drafts[i].key, shadowed.get(drafts[i].key)! + 1);
        }
      }
    }
    return { taken, shadowed };
  }, [drafts.map((d) => `${d.within}\u0001${d.types}\u0001${d.pattern}`).join('\u0000'), lots]);

  const update = (key: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (from: number, to: number) =>
    setDrafts((ds) => {
      const next = [...ds];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  const add = () => {
    const d: Draft = { key: nextKey++, from: null, name: '', types: '', pattern: '', within: '' };
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
  /** Store the drafts; returns false if any row is invalid. */
  const apply = () => {
    if (!valid) {
      return false;
    }
    const renames = new Map<string, string | null>(initial.map((c) => [c.name, null]));
    for (const d of drafts) {
      if (d.from != null) {
        renames.set(d.from, d.name.trim());
      }
    }
    for (const [from, to] of renames) {
      if (from === to) {
        renames.delete(from);
      }
    }
    const saved = drafts.map(clean);
    setSetting(KEYS.customCategories, saved);
    if (renames.size) {
      migrateFilters(renames);
    }
    // Later renames are relative to what's now saved.
    setInitial(saved);
    setDrafts((ds) => ds.map((d) => ({ ...d, from: d.name.trim() })));
    return true;
  };
  const save = () => {
    if (apply()) {
      onClose();
    }
  };

  const sel = drafts.find((d) => d.key === selected);
  const selLots = sel ? assignment.taken.get(sel.key)! : [];

  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="modal cat-editor" role="dialog" aria-modal="true" aria-labelledby="cat-editor-title" tabIndex={-1} ref={dialog}>
        <div class="cat-head">
          <div>
            <h2 id="cat-editor-title">Custom categories</h2>
            <p class="muted small">
              Lots of a listed item type (the chip on each lot card), or whose title matches the regex, move into the category; “Only within” limits it to
              one site category. Item types win, then the first regex (top to bottom) that matches – drag or use the arrows to reorder. Regexes are
              case-insensitive, whole words: \b(?:pattern)\b.
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
              {drafts.map((d, i) => {
                const err = errors.get(d.key);
                const count = assignment.taken.get(d.key)!.length;
                const shadowed = assignment.shadowed.get(d.key)!;
                const isDragOver = drag && drag.over === i && drag.from !== i;
                return (
                  <li
                    key={d.key}
                    data-key={d.key}
                    class={[
                      'cat-row',
                      err && 'has-error',
                      d.key === selected && 'selected',
                      drag?.from === i && 'dragging',
                      isDragOver && (drag.from < i ? 'drop-after' : 'drop-before'),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onFocusIn={() => setSelected(d.key)}
                    onMouseDown={() => setSelected(d.key)}
                    onDragOver={(e) => {
                      if (drag) {
                        e.preventDefault();
                        setDrag((cur) => (cur && cur.over !== i ? { ...cur, over: i } : cur));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (drag) {
                        move(drag.from, i);
                      }
                      setDrag(null);
                    }}
                  >
                    <div class="cat-order">
                      <span
                        class="cat-handle"
                        draggable
                        title="Drag to reorder"
                        onDragStart={(e) => {
                          const row = (e.currentTarget as HTMLElement).closest('li');
                          e.dataTransfer!.effectAllowed = 'move';
                          e.dataTransfer!.setData('text/plain', d.name);
                          if (row) {
                            e.dataTransfer!.setDragImage(row, 16, 16);
                          }
                          setDrag({ from: i, over: i });
                        }}
                        onDragEnd={() => setDrag(null)}
                      >
                        <Icon name="dragIndicator" size={20} />
                      </span>
                      <button type="button" class="icon-btn" aria-label={`Move ${d.name || 'category'} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                        <Icon name="arrowUp" size={16} />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={`Move ${d.name || 'category'} down`}
                        disabled={i === drafts.length - 1}
                        onClick={() => move(i, i + 1)}
                      >
                        <Icon name="arrowDown" size={16} />
                      </button>
                    </div>
                    <label class="field cat-name">
                      <span>Name</span>
                      <input type="text" value={d.name} placeholder="e.g. Pressure Washer" onInput={(e) => update(d.key, { name: e.currentTarget.value })} />
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
                    <label class="field cat-types">
                      <span>Item types</span>
                      <input
                        type="text"
                        value={d.types}
                        placeholder="e.g. pressure washer, power washer"
                        spellcheck={false}
                        onInput={(e) => update(d.key, { types: e.currentTarget.value })}
                      />
                    </label>
                    <label class="field cat-pattern">
                      <span>Title regex</span>
                      <textarea
                        rows={Math.min(6, Math.max(2, Math.ceil(d.pattern.length / 60)))}
                        spellcheck={false}
                        value={d.pattern}
                        placeholder="e.g. pressure washers?|power washers?"
                        onInput={(e) => update(d.key, { pattern: e.currentTarget.value.replace(/\n/g, '') })}
                      />
                    </label>
                    <div class="cat-count" title={shadowed ? `Its regex also matches ${plural(shadowed, 'lot')} another category took` : undefined}>
                      <b>{fmtCount(count)}</b>
                      <span class="muted small">{count === 1 ? 'lot' : 'lots'}</span>
                      {shadowed > 0 && <span class="muted small">+{fmtCount(shadowed)} taken elsewhere</span>}
                    </div>
                    <button
                      type="button"
                      class="icon-btn cat-delete"
                      aria-label={`Delete ${d.name || 'category'}`}
                      title="Delete category"
                      onClick={() => remove(d)}
                    >
                      <Icon name="delete" size={20} />
                    </button>
                    {err && <p class="error small cat-error">{err}</p>}
                  </li>
                );
              })}
            </ol>
          )}
          <button type="button" class="btn btn-outline btn-small cat-add" onClick={add}>
            <Icon name="add" size={18} /> Add category
          </button>

          {sel && (
            <section class="cat-preview">
              <h3>
                {sel.name.trim() || 'New category'} · {plural(selLots.length, 'open lot')}
              </h3>
              {selLots.length ? (
                <ul>
                  {selLots.slice(0, PREVIEW_LIMIT).map((l) => (
                    <li>
                      <span>{l.title}</span>
                      {l.category && <span class="muted small">{l.category.label}</span>}
                    </li>
                  ))}
                  {selLots.length > PREVIEW_LIMIT && <li class="muted small">…and {fmtCount(selLots.length - PREVIEW_LIMIT)} more</li>}
                </ul>
              ) : (
                <p class="muted small">No open lots match{errors.get(sel.key) ? ' (fix the regex first)' : ''}.</p>
              )}
            </section>
          )}
        </div>

        <div class="cat-foot">
          {!valid && <span class="error small">Fix the highlighted rows to save.</span>}
          <button type="button" class="btn btn-outline" onClick={close}>
            Cancel
          </button>
          <button type="button" class="btn btn-outline" onClick={() => dirty && apply()} aria-disabled={valid && dirty ? undefined : 'true'}>
            Apply
          </button>
          <button type="button" class="btn" onClick={save} aria-disabled={valid ? undefined : 'true'}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
