// Editor for title sort rules: regex rewrites applied (top to bottom) to lot
// titles before sorting by title, with a preview of the open lots each changes.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { KEYS, type SortRule } from '../shared/keys';
import { compileSortRules, sortKey } from '../shared/sortKey';
import { getSetting, setSetting } from './gm';
import { Icon } from './icons';
import type { Lot } from './types';
import { fmtCount, plural, useDialog } from './util';

/** A rule being edited. */
interface Draft {
  key: number;
  pattern: string;
  replacement: string;
}

/** Changed titles listed in the preview. */
const PREVIEW_LIMIT = 50;

let nextKey = 0;
const toDraft = (r: SortRule): Draft => ({ key: nextKey++, ...r });
const clean = (d: Draft): SortRule => ({ pattern: d.pattern.trim(), replacement: d.replacement });

/** What's wrong with a row, if anything. */
function rowError(d: Draft): string | null {
  if (!d.pattern.trim()) {
    return 'Regex is required';
  }
  return compileSortRules([clean(d)])[0].re ? null : 'Invalid regex';
}

/** Dialog for managing title sort rules. Changes apply only on Apply or Save. */
export function SortRuleEditor({ lots, onClose }: { lots: Lot[]; onClose: () => void }) {
  const [initial, setInitial] = useState(() => getSetting(KEYS.sortRules));
  const [drafts, setDrafts] = useState<Draft[]>(() => initial.map(toDraft));
  const [selected, setSelected] = useState<number | null>(drafts[0]?.key ?? null);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);

  const dirty = JSON.stringify(drafts.map(clean)) !== JSON.stringify(initial);
  const errors = new Map(drafts.map((d) => [d.key, rowError(d)]));
  const valid = [...errors.values()].every((e) => !e);

  const close = () => {
    if (!dirty || confirm('Discard your changes to the sort rules?')) {
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

  // Open lots each row changes, with the title they sort as.
  const changed = useMemo(() => {
    const compiled = compileSortRules(drafts.map(clean));
    const byRow = drafts.map(() => [] as { lot: Lot; key: string }[]);
    for (const lot of lots) {
      const hits: number[] = [];
      const key = sortKey(lot.title, compiled, (i) => hits.push(i));
      hits.forEach((i) => byRow[i].push({ lot, key }));
    }
    return new Map(drafts.map((d, i) => [d.key, byRow[i]]));
  }, [JSON.stringify(drafts.map(clean)), lots]);

  const update = (key: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (from: number, to: number) =>
    setDrafts((ds) => {
      const next = [...ds];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
  const add = () => {
    const d: Draft = { key: nextKey++, pattern: '', replacement: '' };
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
    setSetting(KEYS.sortRules, saved);
    setInitial(saved);
    return true;
  };
  const save = () => {
    if (apply()) {
      onClose();
    }
  };

  const sel = drafts.find((d) => d.key === selected);
  const selLots = sel ? changed.get(sel.key)! : [];

  return (
    <div class="backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="modal cat-editor" role="dialog" aria-modal="true" aria-labelledby="sort-rule-editor-title" tabIndex={-1} ref={dialog}>
        <div class="cat-head">
          <div>
            <h2 id="sort-rule-editor-title">Title sort rules</h2>
            <p class="muted small">
              When sorting by title, each title as listed has every matching regex replaced, top to bottom; then any sizes and counts left at the start
              move to the end. Case-insensitive; use $1, $2… in the replacement for the regex's groups.
            </p>
          </div>
          <button type="button" class="icon-btn" aria-label="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        <div class="cat-body">
          {drafts.length === 0 ? (
            <p class="muted">No sort rules yet.</p>
          ) : (
            <ol class="cat-list" ref={list}>
              {drafts.map((d, i) => {
                const err = errors.get(d.key);
                const count = changed.get(d.key)!.length;
                return (
                  <li
                    key={d.key}
                    data-key={d.key}
                    class={['cat-row', 'rw-row', err && 'has-error', d.key === selected && 'selected'].filter(Boolean).join(' ')}
                    onFocusIn={() => setSelected(d.key)}
                    onMouseDown={() => setSelected(d.key)}
                  >
                    <div class="cat-order">
                      <button type="button" class="icon-btn" aria-label="Move rule up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                        <Icon name="arrowUp" size={16} />
                      </button>
                      <button type="button" class="icon-btn" aria-label="Move rule down" disabled={i === drafts.length - 1} onClick={() => move(i, i + 1)}>
                        <Icon name="arrowDown" size={16} />
                      </button>
                    </div>
                    <label class="field cat-pattern">
                      <span>Title regex</span>
                      <textarea
                        rows={Math.min(6, Math.max(2, Math.ceil(d.pattern.length / 60)))}
                        spellcheck={false}
                        value={d.pattern}
                        placeholder="e.g. ^(.+?)\s+(garbage disposal)\b"
                        onInput={(e) => update(d.key, { pattern: e.currentTarget.value.replace(/\n/g, '') })}
                      />
                    </label>
                    <label class="field rw-repl">
                      <span>Replace with</span>
                      <input type="text" spellcheck={false} value={d.replacement} placeholder="e.g. $2 $1" onInput={(e) => update(d.key, { replacement: e.currentTarget.value })} />
                    </label>
                    <div class="cat-count">
                      <b>{fmtCount(count)}</b>
                      <span class="muted small">{count === 1 ? 'lot' : 'lots'}</span>
                    </div>
                    <button type="button" class="icon-btn cat-delete" aria-label="Delete rule" title="Delete rule" onClick={() => remove(d)}>
                      <Icon name="delete" size={20} />
                    </button>
                    {err && <p class="error small cat-error">{err}</p>}
                  </li>
                );
              })}
            </ol>
          )}
          <button type="button" class="btn btn-outline btn-small cat-add" onClick={add}>
            <Icon name="add" size={18} /> Add rule
          </button>

          {sel && (
            <section class="cat-preview rw-preview">
              <h3>Changes {plural(selLots.length, 'open lot')}</h3>
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
                <p class="muted small">No open lots change{errors.get(sel.key) ? ' (fix the regex first)' : ''}.</p>
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
