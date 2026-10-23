// Dialog behind the item type button on a lot card: make a custom category of
// that type (plus any similar types picked), or add the types to an existing one.
import { useMemo, useRef, useState } from 'preact/hooks';
import { KEYS, type CustomCategory } from '../shared/keys';
import { migrateFilters } from './CategoryEditor';
import { setSetting, useSetting } from './settings';
import { toast } from './toast';
import type { Lot } from './types';
import { fmtCount, plural, useDialog } from './util';
import { categoryIndex, compileCategories } from './view';

/** Matching titles listed in the preview. */
const PREVIEW_LIMIT = 30;
/** Similar types offered as checkboxes. */
const SIMILAR_LIMIT = 12;

/** "drill bit set" -> "Drill Bit Sets" */
function categoryName(type: string): string {
  const words = type.split(' ');
  const last = words.pop()!;
  const many = /(ss|x|z|ch|sh)$/.test(last) ? `${last}es` : /s$/.test(last) ? last : /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`;
  return [...words, many].map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Words of a type worth comparing ("of", "and" and the like don't count). */
const typeWords = (t: string) => t.split(/[\s/-]+/).filter((w) => w.length > 2 && !['and', 'for', 'with'].includes(w));

/** Whether `c` lists any of `types` and is limited the same way (`within`), so saving takes those types from it. */
const loses = (c: CustomCategory, types: string[], within: string | undefined) => (c.within ?? '') === (within ?? '') && !!c.types?.some((t) => types.includes(t));

/** `c` without `types`, or nothing if it's left with nothing to match. */
function without(c: CustomCategory, types: string[]): CustomCategory[] {
  const rest = c.types!.filter((t) => !types.includes(t));
  return rest.length || c.pattern?.trim() ? [{ ...c, types: rest }] : [];
}

export function TypeCategory({ lot, lots, onClose }: { lot: Lot; lots: Lot[]; onClose: () => void }) {
  const type = lot.itemType!;
  const site = lot.category;
  const [cats] = useSetting(KEYS.customCategories);
  // A category already listing this type, if any: the default target.
  const current = cats[categoryIndex(lot, compileCategories(cats.map((c) => ({ ...c, pattern: undefined }))))];
  const [within, setWithin] = useState(!!site && (current ? current.within === site.value : true));
  const defaultName = (w: boolean) => current?.name ?? (w && site ? `${site.label} - ${categoryName(type)}` : categoryName(type));
  const [name, setName] = useState(() => defaultName(within));
  const [nameEdited, setNameEdited] = useState(false);
  const [extra, setExtra] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  });

  const scope = lots.filter((l) => !within || l.category?.value === site?.value);
  const existing = cats.find((c) => c.name.toLowerCase() === name.trim().toLowerCase());
  const types = [type, ...extra];
  const limit = existing ? existing.within : within ? site?.value : undefined;

  // Other types in scope that share a word with this one, those sharing its last word ("washer") first.
  const similar = useMemo(() => {
    const words = typeWords(type);
    const head = words.at(-1);
    const counts = Map.groupBy(
      scope.filter((l) => l.itemType && l.itemType !== type && typeWords(l.itemType).some((w) => words.includes(w))),
      (l) => l.itemType!,
    );
    return [...counts]
      .map(([t, ls]) => ({ t, count: ls.length, head: typeWords(t).at(-1) === head }))
      .sort((a, b) => +b.head - +a.head || b.count - a.count || a.t.localeCompare(b.t))
      .slice(0, SIMILAR_LIMIT);
  }, [lots, within]);

  // Categories that lose these types to this one; their lots move here.
  const losing = cats.filter((c) => c !== existing && loses(c, types, limit));
  // The categories after saving, and the open lots the target would then take.
  const { next, target } = useMemo(() => {
    const next = cats.flatMap((c) =>
      c === existing ? [{ ...c, types: [...new Set([...(c.types ?? []), ...types])] }] : losing.includes(c) ? without(c, types) : [c],
    );
    if (!existing) {
      next.push({ name: name.trim(), types, ...(limit && { within: limit }) });
    }
    return { next, target: existing ? next.findIndex((c) => c.name === existing.name) : next.length - 1 };
  }, [cats, name, types.join('\u0000'), limit]);
  const taken = useMemo(() => {
    const compiled = compileCategories(next);
    return lots.filter((l) => categoryIndex(l, compiled) === target);
  }, [next, target, lots]);

  const error = !name.trim() ? 'Name is required' : null;
  const save = () => {
    if (error) {
      return;
    }
    setSetting(KEYS.customCategories, next);
    const dropped = cats.filter((c) => !next.some((n) => n.name === c.name)).map((c) => c.name);
    if (dropped.length) {
      migrateFilters(new Map(dropped.map((n) => [n, null])));
    }
    toast('good', `${existing ? 'Updated' : 'Created'} “${next[target].name}” · ${plural(taken.length, 'open lot')}`);
    onClose();
  };

  return (
    <div class="backdrop backdrop-top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="confirm type-cat" role="dialog" aria-modal="true" aria-labelledby="type-cat-title" tabIndex={-1} ref={box}>
        <h2 id="type-cat-title">{existing ? 'Add to category' : 'New category'}</h2>
        <div class="confirm-body">
          <label class="field">
            <span>Name</span>
            <input
              type="text"
              list="type-cat-names"
              value={name}
              onInput={(e) => {
                setName(e.currentTarget.value);
                setNameEdited(true);
              }}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <datalist id="type-cat-names">
              {cats.map((c) => (
                <option value={c.name} />
              ))}
            </datalist>
          </label>
          {existing ? (
            <p class="muted small">Adds to your existing category “{existing.name}”.</p>
          ) : (
            site && (
              <label class="switch-row">
                <input
                  type="checkbox"
                  checked={within}
                  onChange={(e) => {
                    setWithin(e.currentTarget.checked);
                    if (!nameEdited) {
                      setName(defaultName(e.currentTarget.checked));
                    }
                  }}
                />
                <span>Only within {site.label}</span>
              </label>
            )
          )}
          <fieldset class="type-cat-types">
            <legend>Item types</legend>
            <label>
              <input type="checkbox" checked disabled /> {type}
            </label>
            {similar.map(({ t, count }) => (
              <label>
                <input
                  type="checkbox"
                  checked={extra.includes(t) || !!existing?.types?.includes(t)}
                  disabled={existing?.types?.includes(t)}
                  onChange={(e) => setExtra(e.currentTarget.checked ? [...extra, t] : extra.filter((x) => x !== t))}
                />{' '}
                {t} <span class="muted small">{fmtCount(count)}</span>
              </label>
            ))}
          </fieldset>
          {losing.length > 0 && <p class="muted small">Moves {plural(types.length, 'type')} out of {losing.map((c) => `“${c.name}”`).join(', ')}.</p>}
          <section class="cat-preview">
            <h3>{plural(taken.length, 'open lot')}</h3>
            <ul>
              {taken.slice(0, PREVIEW_LIMIT).map((l) => (
                <li>
                  <span>{l.title}</span>
                </li>
              ))}
              {taken.length > PREVIEW_LIMIT && <li class="muted small">…and {fmtCount(taken.length - PREVIEW_LIMIT)} more</li>}
            </ul>
          </section>
          {error && <p class="error small">{error}</p>}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn" onClick={save} aria-disabled={error ? 'true' : undefined}>
            {existing ? 'Add' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
