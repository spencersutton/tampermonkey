// Dialog behind the + button next to the item type on a lot card: make a custom category of
// that type (plus any similar types picked), or add the types to an existing one.
import { useMemo, useState } from 'preact/hooks';

import * as format from '../../shared/format';
import { KEYS } from '../../shared/keys';
import {
  categoryError,
  defaultCategoryName,
  defaultCategoryParent,
  findSimilarTypes,
  planTypeCategory,
  siteCategoriesFromLots,
  sortCategoryChoices,
} from '../logic/categories';
import { plural } from '../logic/util';
import { categoryIndex, categoryPath, compileCategories, customCategoryValue } from '../logic/view';
import { saveCustomCategories } from '../server/categories';
import { getSetting, setSetting } from '../server/settings';
import { toast } from '../server/toast';
import { Lot } from '../types';
import { Dialog } from './Dialog';

export function TypeCategory({
  lot,
  lots,
  onClose,
}: {
  lot: Lot;
  lots: Lot[];
  onClose: () => void;
}) {
  const type = lot.itemType!;
  const site = lot.category;
  const cats = getSetting(KEYS.customCategories);
  const lastCategory = getSetting(KEYS.lastCategory);
  const siteCategories = useMemo(() => {
    const list = siteCategoriesFromLots(lots);
    if (!list.some(s => s.value === site.value)) {
      return [...list, site];
    }
    return list;
  }, [lots, site]);
  const siteLabels = useMemo(
    () => new Map(siteCategories.map(s => [s.value, s.label])),
    [siteCategories],
  );
  // The lot's custom category is the default parent.
  const current = cats[categoryIndex(lot, compileCategories(cats))];
  // Categories nested under this lot's site category first, then A–Z.
  const choices = useMemo(
    () => sortCategoryChoices(cats, site.value, siteLabels),
    [cats, site.value, siteLabels],
  );
  const preferred =
    cats.find(c => customCategoryValue(c) === lastCategory || c.name === lastCategory) ??
    current ??
    choices[0];
  const [mode, setMode] = useState<'new' | 'add'>(() => (cats.length ? 'add' : 'new'));
  const preferredValue = preferred ? customCategoryValue(preferred) : '';
  const [selectedCategory, setPick] = useState(preferredValue);
  const [categorySearch, setCategorySearch] = useState('');
  const labelOf = (c: (typeof cats)[number]) => categoryPath(c, cats, siteLabels);
  const filteredChoices = choices.filter(c =>
    labelOf(c).toLowerCase().includes(categorySearch.trim().toLowerCase()),
  );
  let selected = preferredValue;
  if (cats.some(c => customCategoryValue(c) === selectedCategory)) {
    selected = selectedCategory;
  }
  const pick = filteredChoices.some(c => customCategoryValue(c) === selected) ? selected : '';
  const [parent, setParent] = useState<string | null>(() =>
    defaultCategoryParent(current, site.value),
  );
  const [name, setName] = useState(() => defaultCategoryName(type));
  const [extra, setExtra] = useState<string[]>([]);

  const existing = mode === 'add' ? cats.find(c => customCategoryValue(c) === pick) : undefined;
  // Other types sharing a word with this one, those sharing its last word ("washer") first.
  const similar = useMemo(() => findSimilarTypes(lots, type), [lots, type]);

  // The categories after saving, and the open lots the target would then take.
  const { next, target, taken, losing, types } = useMemo(
    () => planTypeCategory({ cats, mode, existing, name, parent, type, extra, lots }),
    [cats, mode, existing, name, parent, type, extra, lots],
  );

  const error = categoryError(mode, existing, name, cats, parent);
  const save = () => {
    if (error) {
      return;
    }
    const category = next[target];
    if (!category) {
      throw new Error('Selected category is missing');
    }
    saveCustomCategories(next);
    setSetting(KEYS.lastCategory, customCategoryValue(category));
    toast(
      'good',
      `${existing ? 'Updated' : 'Created'} “${categoryPath(category, next, siteLabels)}” · ${plural(taken.length, 'open lot')}`,
    );
    onClose();
  };

  return (
    <Dialog
      onClose={onClose}
      aria-labelledby="type-cat-title"
      onKeyDownCapture={e => {
        if (e.key !== 'Enter' || e.isComposing) {
          return;
        }
        if (
          !(e.target instanceof HTMLElement) ||
          !e.target.matches('dialog, form, input[type="text"], input[type="search"]')
        ) {
          return;
        }
        e.preventDefault();
        if (!e.repeat) {
          save();
        }
      }}
    >
      <form
        class="confirm type-cat"
        tabIndex={-1}
        onSubmit={e => {
          e.preventDefault();
          save();
        }}
      >
        <h2 id="type-cat-title">Make a category of “{type}”</h2>
        <div class="confirm-body">
          <div class="type-cat-mode" role="radiogroup" aria-label="New or existing category">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'new'}
              onClick={() => setMode('new')}
            >
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
          {mode === 'add' && (
            <>
              <label class="field">
                <span>Search categories</span>
                <input
                  type="search"
                  placeholder="Filter by category name"
                  value={categorySearch}
                  onInput={e => setCategorySearch(e.currentTarget.value)}
                />
              </label>
              <label class="field">
                <span id="type-cat-category-label">Category</span>
                <select
                  aria-labelledby="type-cat-category-label"
                  class="type-cat-choices"
                  size={6}
                  value={pick}
                  onChange={e => setPick(e.currentTarget.value)}
                >
                  {!pick && (
                    <option value="" disabled>
                      Pick a category
                    </option>
                  )}
                  {filteredChoices.map(c => {
                    const value = customCategoryValue(c);
                    return (
                      <option key={value} value={value}>
                        {labelOf(c)}
                      </option>
                    );
                  })}
                </select>
              </label>
              {!filteredChoices.length && (
                <p class="muted small" role="status">
                  No categories match your search.
                </p>
              )}
            </>
          )}
          {mode === 'new' && (
            <>
              <label class="field">
                <span>Parent</span>
                <select
                  value={parent ?? ''}
                  onChange={e => setParent(e.currentTarget.value || null)}
                >
                  <option value="">Top level</option>
                  {siteCategories.length > 0 && (
                    <optgroup label="Site categories">
                      {siteCategories.map(s => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {choices.length > 0 && (
                    <optgroup label="Custom categories">
                      {choices.map(c => {
                        const value = customCategoryValue(c);
                        return (
                          <option key={value} value={value}>
                            {labelOf(c)}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
              </label>
              <label class="field">
                <span>Name</span>
                <input type="text" value={name} onInput={e => setName(e.currentTarget.value)} />
              </label>
            </>
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
                  checked={extra.includes(t) || Boolean(existing?.types.includes(t))}
                  disabled={existing?.types.includes(t)}
                  onChange={e =>
                    setExtra(e.currentTarget.checked ? [...extra, t] : extra.filter(x => x !== t))
                  }
                />{' '}
                {t} <span class="muted small">{format.num(count)}</span>
              </label>
            ))}
          </fieldset>
          {losing.length > 0 && (
            <p class="muted small">
              Moves {plural(types.length, 'type')} out of{' '}
              {losing.map(c => `“${labelOf(c)}”`).join(', ')}.
            </p>
          )}
          {error && <p class="error small">{error}</p>}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn" aria-disabled={error ? 'true' : undefined}>
            {mode === 'add' ? 'Add' : 'Create'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
