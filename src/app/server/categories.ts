import { KEYS, type CustomCategory } from '../../shared/keys';
import { computeCategoryUpdates } from '../logic/categories';
import { getSetting, setSetting } from './settings';

/** Save categories and update filters for renamed or removed categories. */
export function saveCustomCategories(
  categories: CustomCategory[],
  renames: ReadonlyMap<string, string | null> = new Map(),
) {
  const updates = computeCategoryUpdates(categories, renames, {
    customCategories: getSetting(KEYS.customCategories),
    lastCategory: getSetting(KEYS.lastCategory),
    view: getSetting(KEYS.view),
    savedSearches: getSetting(KEYS.savedSearches),
  });

  setSetting(KEYS.customCategories, categories);
  if (updates.lastCategory !== undefined) {
    setSetting(KEYS.lastCategory, updates.lastCategory);
  }
  if (updates.view !== undefined) {
    setSetting(KEYS.view, updates.view);
  }
  if (updates.savedSearches !== undefined) {
    setSetting(KEYS.savedSearches, updates.savedSearches);
  }
}
