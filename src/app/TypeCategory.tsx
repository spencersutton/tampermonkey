// Dialog behind the item type button on a lot card: make a custom category of
// that type (plus any similar types picked), or add the types to an existing one.
import { useMemo, useState } from 'preact/hooks';
import { KEYS, type CustomCategory } from '../shared/keys';
import { collator } from '../shared/sortKey';
import { saveCustomCategories } from './categories';
import { setSetting, getSetting } from './settings';
import { toast } from './toast';
import type { Lot } from './types';
import { Dialog } from './Dialog';
import { fmtCount, plural } from './util';
import { categoryIndex, compileCategories } from './view';

/** Similar types offered as checkboxes. */
const SIMILAR_LIMIT = 12;

/** "drill bit set" -> "Drill Bit Sets" */
function categoryName(type: string): string {
  const words = type.split(' ');
  const last = words.pop()!;
  let many = `${last}s`;
  if (/(ss|x|z|ch|sh)$/.test(last)) {
    many = `${last}es`;
  } else if (last.endsWith('s')) {
    many = last;
  } else if (/[^aeiou]y$/.test(last)) {
    many = `${last.slice(0, -1)}ies`;
  }
  return [...words, many].map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function categoryError(mode: 'new' | 'add', existing: CustomCategory | undefined, name: string, cats: CustomCategory[]): string | null {
  if (mode === 'add') {
    return existing ? null : 'Pick a category';
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Name is required';
  }
  if (cats.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    return 'There’s already a category with this name – use “Add to existing”';
  }
  return null;
}

/** Words of a type worth comparing ("of", "and" and the like don't count). */
const typeWords = (t: string) => t.split(/[\s/-]+/).filter((w) => w.length > 2 && !['and', 'for', 'with'].includes(w));

/** Whether saving takes any of `types` from `c`. */
const loses = (c: CustomCategory, types: string[]) => c.types.some((t) => types.includes(t));

/** `c` without `types`, retaining empty parents of child categories. */
function without(c: CustomCategory, types: string[], names: string[] = []): CustomCategory[] {
  const rest = c.types!.filter((t) => !types.includes(t));
  return rest.length || names.some((name) => name.startsWith(`${c.name} - `)) ? [{ ...c, types: rest }] : [];
}

export function TypeCategory({ lot, lots, onClose }: { lot: Lot; lots: Lot[]; onClose: () => void }) {
  const type = lot.itemType!;
  const site = lot.category;
  const cats = getSetting(KEYS.customCategories);
  const lastCategory = getSetting(KEYS.lastCategory);
  // The lot's custom category is the default parent.
  const current = cats[categoryIndex(lot, compileCategories(cats))];
  // Categories nested under this lot's site category first, then A–Z.
  const near = (c: CustomCategory) => site != null && c.name.startsWith(`${site.label} - `);
  const choices = cats.toSorted((a, b) => +near(b) - +near(a) || collator.compare(a.name, b.name));
  const preferred = cats.find((c) => c.name === lastCategory) ?? current ?? choices[0];
  const [mode, setMode] = useState<'new' | 'add'>('new');
  const [selectedCategory, setPick] = useState(() => preferred?.name ?? '');
  const [categorySearch, setCategorySearch] = useState('');
  const filteredChoices = choices.filter((c) => c.name.toLowerCase().includes(categorySearch.trim().toLowerCase()));
  const selected = cats.some((category) => category.name === selectedCategory) ? selectedCategory : preferred?.name ?? '';
  const pick = filteredChoices.some((c) => c.name === selected) ? selected : '';
  const defaultName = () => {
    const parent = current?.name ?? site?.label;
    return parent ? `${parent} - ${categoryName(type)}` : categoryName(type);
  };
  const [name, setName] = useState(defaultName);
  const [extra, setExtra] = useState<string[]>([]);

  const existing = mode === 'add' ? cats.find((c) => c.name === pick) : undefined;
  // Other types sharing a word with this one, those sharing its last word ("washer") first.
  const similar = useMemo(() => {
    const words = typeWords(type);
    const head = words.at(-1);
    const counts = Map.groupBy(
      lots.filter((l) => l.itemType && l.itemType !== type && typeWords(l.itemType).some((w) => words.includes(w))),
      (l) => l.itemType!,
    );
    return [...counts]
      .map(([t, ls]) => ({ t, count: ls.length, head: typeWords(t).at(-1) === head }))
      .sort((a, b) => +b.head - +a.head || b.count - a.count || a.t.localeCompare(b.t))
      .slice(0, SIMILAR_LIMIT);
  }, [lots, type]);

  // The categories after saving, and the open lots the target would then take.
  const { next, target, taken, losing, types } = useMemo(() => {
    const types = [type, ...extra];
    const losing = cats.filter((c) => c !== existing && loses(c, types));
    const names = [
      ...cats.filter((c) => !losing.includes(c) || c.types?.some((t) => !types.includes(t))).map((c) => c.name),
      ...(mode === 'new' ? [name.trim()] : []),
    ];
    const next = cats.flatMap((c) => {
      if (c === existing) {
        return [{ ...c, types: [...new Set([...(c.types ?? []), ...types])] }];
      }
      return losing.includes(c) ? without(c, types, names) : [c];
    });
    if (mode === 'new') {
      next.push({ name: name.trim(), types });
    }
    let target = -1;
    if (existing) {
      target = next.findIndex((c) => c.name === existing.name);
    } else if (mode === 'new') {
      target = next.length - 1;
    }
    const compiled = compileCategories(next);
    const taken = target < 0 ? [] : lots.filter((l) => categoryIndex(l, compiled) === target);
    return { next, target, taken, losing, types };
  }, [cats, mode, existing, name, type, extra, lots]);

  const error = categoryError(mode, existing, name, cats);
  const save = () => {
    if (error) {
      return;
    }
    const category = next[target];
    if (!category) {
      throw new Error('Selected category is missing');
    }
    saveCustomCategories(next);
    setSetting(KEYS.lastCategory, category.name);
    toast('good', `${existing ? 'Updated' : 'Created'} “${category.name}” · ${plural(taken.length, 'open lot')}`);
    onClose();
  };

  return (
    <Dialog onClose={onClose} aria-labelledby="type-cat-title">
      <div class="confirm type-cat" tabIndex={-1}>
        <h2 id="type-cat-title">Make a category of “{type}”</h2>
        <div class="confirm-body">
          <div class="type-cat-mode" role="radiogroup" aria-label="New or existing category">
            <button type="button" role="radio" aria-checked={mode === 'new'} onClick={() => setMode('new')}>
              New category
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'add'}
              disabled={!cats.length}
              title={cats.length ? undefined : 'No custom categories yet'}
              onClick={() => setMode('add')}
            >
              Add to existing
            </button>
          </div>
          {mode === 'add' ? (
            <>
              <label class="field">
                <span>Search categories</span>
                <input
                  type="search"
                  placeholder="Filter by category name"
                  value={categorySearch}
                  onInput={(e) => setCategorySearch(e.currentTarget.value)}
                />
              </label>
              <label class="field">
                <span id="type-cat-category-label">Category</span>
                <select aria-labelledby="type-cat-category-label" class="type-cat-choices" size={6} value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
                  {!pick && <option value="" disabled>Pick a category</option>}
                  {filteredChoices.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              {!filteredChoices.length && <p class="muted small" role="status">No categories match your search.</p>}
            </>
          ) : (
            <label class="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onInput={(e) => setName(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
              />
            </label>
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
                  checked={extra.includes(t) || Boolean(existing?.types?.includes(t))}
                  disabled={existing?.types?.includes(t)}
                  onChange={(e) => setExtra(e.currentTarget.checked ? [...extra, t] : extra.filter((x) => x !== t))}
                />{' '}
                {t} <span class="muted small">{fmtCount(count)}</span>
              </label>
            ))}
          </fieldset>
          {losing.length > 0 && <p class="muted small">Moves {plural(types.length, 'type')} out of {losing.map((c) => `“${c.name}”`).join(', ')}.</p>}
          {error && <p class="error small">{error}</p>}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" class="btn" onClick={save} aria-disabled={error ? 'true' : undefined}>
            {mode === 'add' ? 'Add' : 'Create'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
