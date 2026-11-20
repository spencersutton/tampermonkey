import { modalActions } from '../state';
import type { Facets, ViewState } from '../view';
import { filterShortcuts } from './filterShortcuts';
import { FiltersSection } from './FiltersSection';
import { HideFilterSection } from './HideFilterSection';
import { SavedSearchesSection, type SavedSearchesProps } from './SavedSearchesSection';
import { SettingsSection } from './SettingsSection';

interface Props {
  view: ViewState;
  facets: Facets;
  matchCounts: Map<string, number>;
  pickup: string;
  authed: boolean;
  saved: SavedSearchesProps;
}

/** Left sidebar: saved searches, filters, hide/regex filters and settings. */
export function Sidebar(props: Props) {
  return (
    <div class="sidebar-inner" ref={filterShortcuts}>
      <SavedSearchesSection {...props.saved} />
      <FiltersSection {...props} />
      <HideFilterSection matchCounts={props.matchCounts} />
      <SettingsSection />
      <button
        type="button"
        class="btn-text"
        onClick={modalActions.showShortcuts}
        title="Keyboard shortcuts (?)"
        aria-keyshortcuts="Shift+/"
      >
        Keyboard shortcuts (?)
      </button>
      <a class="btn-text" href="/tags" title="Give tags to every lot whose title matches a pattern">
        Tag rules
      </a>
    </div>
  );
}
