import { KEYS, type CustomCategory } from '../shared/keys';
import { getSetting, setSetting } from './settings';
import { customCategoryValue, normalizeView } from './view';

/** Save categories and update filters for renamed or removed categories. */
export function saveCustomCategories(categories: CustomCategory[], renames: ReadonlyMap<string, string | null> = new Map()) {
  const names = new Set(categories.map((c) => c.name));
  const changes = new Map<string, string | null>(
    getSetting(KEYS.customCategories)
      .filter((c) => !names.has(c.name))
      .map((c) => [c.name, null] as const),
  );
  for (const [from, to] of renames) {
    if (from !== to) {
      changes.set(from, to);
    }
  }

  // Drop restrictions saved by older versions when the categories are next saved.
  setSetting(KEYS.customCategories, categories.map(({ within: _within, ...category }: CustomCategory & { within?: string }) => category));
  if (!changes.size) {
    return;
  }

  const lastCategory = getSetting(KEYS.lastCategory);
  if (lastCategory != null && changes.has(lastCategory)) {
    setSetting(KEYS.lastCategory, changes.get(lastCategory) ?? null);
  }

  const byValue = new Map([...changes].map(([from, to]) => [customCategoryValue(from), to == null ? null : customCategoryValue(to)]));
  const fix = (cats: string[]) =>
    cats.flatMap((v) => {
      const next = byValue.get(v);
      if (next === undefined) {
        return [v];
      }
      return next === null ? [] : [next];
    });
  const stored = getSetting(KEYS.view);
  if (stored != null) {
    const view = normalizeView(stored);
    setSetting(KEYS.view, { ...view, categories: fix(view.categories) });
  }
  const defaults = getSetting(KEYS.defaultFilters);
  const defaultCategories = fix(defaults.categories);
  if (JSON.stringify(defaultCategories) !== JSON.stringify(defaults.categories)) {
    setSetting(KEYS.defaultFilters, { ...defaults, categories: defaultCategories });
  }
  const searches = getSetting(KEYS.savedSearches);
  setSetting(
    KEYS.savedSearches,
    searches.map((s) => ({ ...s, view: { ...s.view, categories: fix(s.view.categories ?? []) } })),
  );
}
