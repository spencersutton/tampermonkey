import { KEYS } from '../../shared/keys';
import { getSetting, setSetting } from '../settings';
import { filterFacets, modal, modalActions, openId, storedView } from '../state';
import { sameDefaultFilters } from '../view';
import { setAllCategoriesCollapsed } from './CategoryList';

export function saveFilterDefaults() {
  const view = storedView.value;
  if (sameDefaultFilters(view, getSetting(KEYS.defaultFilters))) return;
  setSetting(KEYS.defaultFilters, {
    categories: [...view.categories],
    conditions: [...view.conditions],
    ...(view.noCategories ? { noCategories: true } : {}),
  });
}

export function filterShortcuts(element: HTMLDivElement | null) {
  if (!element) return;
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.repeat ||
      event.isComposing ||
      event.defaultPrevented ||
      modal.peek() ||
      openId.peek() != null
    ) {
      return;
    }
    if (!event.altKey && (event.key === '?' || (event.shiftKey && event.code === 'Slash'))) {
      if (
        element.ownerDocument.activeElement?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
        )
      ) {
        return;
      }
      event.preventDefault();
      modalActions.showShortcuts();
      return;
    }
    if (!event.altKey || !event.shiftKey) return;
    if (!['KeyD', 'KeyE', 'KeyC'].includes(event.code)) return;
    event.preventDefault();
    if (event.code === 'KeyD') {
      saveFilterDefaults();
    } else {
      setAllCategoriesCollapsed(filterFacets.value, event.code === 'KeyC');
    }
  };
  element.ownerDocument.addEventListener('keydown', onKeyDown);
  return () => element.ownerDocument.removeEventListener('keydown', onKeyDown);
}
