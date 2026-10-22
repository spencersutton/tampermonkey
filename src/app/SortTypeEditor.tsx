// Editor for the item types used when sorting by title: regexes that find
// the kind of item in a title ("garbage disposal", "mini fridge"), which then
// leads the title so the same kind of item sorts together.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { compileFilter } from '../shared/filters';
import { KEYS } from '../shared/keys';
import { sortKey } from '../shared/sortKey';
import { getSetting, setSetting } from './gm';
import { Icon } from './icons';
import type { Lot } from './types';
import { fmtCount, plural, useDialog } from './util';

/** An item type being edited. */
interface Draft {
  key: number;
  pattern: string;
}

/** Matching titles listed in the preview. */
const PREVIEW_LIMIT = 50;

let nextKey = 0;
const toDraft = (pattern: string): Draft => ({ key: nextKey++, pattern });
const clean = (d: Draft) => d.pattern.trim();

/** What's wrong with a row, if anything. */
function rowError(d: Draft): string | null {
  if (!clean(d)) {
    return 'Regex is required';
  }
  return compileFilter(clean(d)) ? null : 'Invalid regex';
}

/** Dialog for managing item types for sorting. Changes apply only on Apply or Save. */
export function SortTypeEditor({ lots, onClose }: { lots: Lot[]; onClose: () => void }) {
  const [initial, setInitial] = useState(() => getSetting(KEYS.sortTypes));
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft));
  const [selected, setSelected] = useState<number | null>(drafts[0]?.key ?? null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);

  const dirty = JSON.stringify(drafts.map(clean)) !== JSON.stringify(initial);
  const errors = new Map(drafts.map((d) => [d.key, rowError(d)]));
  const valid = [...errors.values()].every((e) => !e);

  const close = () => {
    if (!dirty || confirm('Discard your changes to the item types?')) {
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
  // Focus the regex box of a row just added.
  useEffect(() => {
    if (focusKey != null) {
      list.current?.querySelector<HTMLTextAreaElement>(`[data-key="${focusKey}"] textarea`)?.focus();
      setFocusKey(null);
    }
  }, [focusKey]);

  // Open lots each row takes (first match wins) with the title they sort as,
  // plus lots a row's regex matches that an earlier row already took.
  const assignment = useMemo(() => {
    const compiled = drafts.map((d) => (clean(d) ? compileFilter(clean(d)) : null));
    const taken = drafts.map(() => [] as { lot: Lot; key: string }[]);
    const shadowed = drafts.map(() => 0);
    for (const lot of lots) {
      let owner = -1;
      const key = sortKey(lot.title, compiled, (i) => (owner = i));
      if (owner < 0) {
        continue;
      }
      taken[owner].push({ lot, key });
      compiled.forEach((re, i) => {
        if (i > owner && re?.test(lot.title)) {
          shadowed[i]++;
        }
      });
    }
    return new Map(drafts.map((d, i) => [d.key, { taken: taken[i], shadowed: shadowed[i] }]));
  }, [drafts.map(clean).join('\u0000'), lots]);

  const update = (key: number, pattern: string) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, pattern } : d)));
  const move = (from: number, to: number) =>
    setDrafts((ds) => {
      const next = [...ds];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  const add = () => {
    const d = toDraft('');
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
    const saved = drafts.map(clean);
    setSetting(KEYS.sortTypes, saved);
    setInitial(saved);
    return true;
  };
  const save = () => {
    if (apply()) {
      onClose();
    }
  };

  const sel = drafts.find((d) => d.key === selected);
  const selLots = sel ? assignment.get(sel.key)!.taken : [];

  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="modal cat-editor" role="dialog" aria-modal="true" aria-labelledby="sort-type-editor-title" tabIndex={-1} ref={dialog}>
        <div class="cat-head">
          <div>
            <h2 id="sort-type-editor-title">Item types for sorting</h2>
            <p class="muted small">
              When sorting by title, the words a regex matches move to the front, so the same kind of item sorts together: "1/3 HP Continuous Feed Garbage
              Disposal" sorts as "Garbage Disposal Continuous Feed 1/3 HP". Case-insensitive, whole words. A title uses the first type (top to bottom) that
              matches – use the arrows to reorder.
            </p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div class="cat-body">
          {drafts.length === 0 ? (
            <p class="muted">No item types yet.</p>
          ) : (
            <ol class="cat-list" ref={list}>
              {drafts.map((d, i) => {
                const err = errors.get(d.key);
                const { taken, shadowed } = assignment.get(d.key)!;
                const count = taken.length;
                return (
                  <li
                    key={d.key}
                    data-key={d.key}
                    class={['cat-row', 'rw-row', err && 'has-error', d.key === selected && 'selected'].filter(Boolean).join(' ')}
                    onFocusIn={() => setSelected(d.key)}
                    onMouseDown={() => setSelected(d.key)}
                  >
                    <div class="cat-order">
                      <button type="button" class="icon-btn" aria-label="Move type up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                        <Icon name="arrowUp" size={16} />
                      </button>
                      <button type="button" class="icon-btn" aria-label="Move type down" disabled={i === drafts.length - 1} onClick={() => move(i, i + 1)}>
                        <Icon name="arrowDown" size={16} />
                      </button>
                    </div>
                    <label class="field cat-pattern">
                      <span>Item type regex</span>
                      <textarea
                        rows={Math.min(6, Math.max(2, Math.ceil(d.pattern.length / 60)))}
                        spellcheck={false}
                        value={d.pattern}
                        placeholder="e.g. mini (?:refrigerator|fridge)s?"
                        onInput={(e) => update(d.key, e.currentTarget.value.replace(/\n/g, ''))}
                      />
                    </label>
                    <div class="cat-count" title={shadowed ? `Its regex also matches ${plural(shadowed, 'lot')} an earlier type took` : undefined}>
                      <b>{fmtCount(count)}</b>
                      <span class="muted small">{count === 1 ? 'lot' : 'lots'}</span>
                      {shadowed > 0 && <span class="muted small">+{fmtCount(shadowed)} taken above</span>}
                    </div>
                    <button type="button" class="icon-btn cat-delete" aria-label="Delete type" title="Delete type" onClick={() => remove(d)}>
                      <Icon name="delete" size={20} />
                    </button>
                    {err && <p class="error small cat-error">{err}</p>}
                  </li>
                );
              })}
            </ol>
          )}
          <button type="button" class="btn btn-outline btn-small cat-add" onClick={add}>
            <Icon name="add" size={18} /> Add item type
          </button>

          {sel && (
            <section class="cat-preview rw-preview">
              <h3>{plural(selLots.length, 'open lot')}</h3>
              {selLots.length ? (
                <ul>
                  {selLots.slice(0, PREVIEW_LIMIT).map(({ lot, key }) => (
                    <li>
                      <span>{lot.title}</span>
                      <span class="muted small">sorts as {key}</span>
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
