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

  setSetting(KEYS.customCategories, categories);
  if (!changes.size) {
    return;
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
  const view = normalizeView(getSetting(KEYS.view));
  setSetting(KEYS.view, { ...view, categories: fix(view.categories) });
  const searches = getSetting(KEYS.savedSearches);
  setSetting(
    KEYS.savedSearches,
    searches.map((s) => ({ ...s, view: { ...s.view, categories: fix(s.view.categories ?? []) } })),
  );
}
