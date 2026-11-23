import * as format from '../../../shared/format';
import type { SavedSearch, SavedSearchStats } from '../../logic/view';
import { Icon } from '../icons';
import { useInlineEdit, type SaveFn } from './useInlineEdit';

export interface SavedSearchesProps {
  searches: SavedSearch[];
  stats: Map<string, SavedSearchStats>;
  activeId: string | null;
  canSave: boolean; // current view has filters and isn't already saved
  canUpdate: (s: SavedSearch) => boolean;
  suggestedName: string;
  onSave: (name: string) => void;
  onOpen: (s: SavedSearch, newOnly: boolean) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onUpdate: (id: string) => void;
}

/** Saved searches with total/new counts, plus save, update, rename and delete. */
export function SavedSearchesSection({
  searches,
  stats,
  activeId,
  canSave,
  canUpdate,
  suggestedName,
  onSave,
  onOpen,
  onDelete,
  onRename,
  onUpdate,
}: SavedSearchesProps) {
  // Editor ids: 'new' names a new saved search; otherwise it's the id being renamed.
  const edit = useInlineEdit();
  const naming = edit.editing === 'new';
  const saveNew: SaveFn = name => onSave(name);
  let saveTitle = 'Set some filters first, or this search is already saved';
  if (canSave) {
    saveTitle = 'Save the current filters';
  }

  return (
    <section class="panel">
      <div class="panel-head">
        <h2>Saved searches</h2>
        {!naming && (
          <button
            type="button"
            class="btn-text"
            disabled={!canSave}
            onClick={() => edit.start('new', suggestedName)}
            title={saveTitle}
          >
            Save current
          </button>
        )}
      </div>
      {naming && (
        <div class="add-filter">
          <input
            type="text"
            aria-label="Name for saved search"
            {...edit.boxProps('new', saveNew)}
          />
          <button
            type="button"
            class="btn-text"
            onMouseDown={e => e.preventDefault()}
            onClick={() => edit.save('new', saveNew)}
          >
            Save
          </button>
        </div>
      )}
      {searches.length === 0 && !naming && (
        <p class="muted small">
          Set filters or a search, then save them here. New listings that match show up as a count
          after each catalog refresh.
        </p>
      )}
      <ul class="filter-list">
        {searches.map(s => {
          const st = stats.get(s.id) ?? { total: 0, fresh: 0 };
          let label = (
            <button
              type="button"
              class="saved-name"
              title="Click to open · double-click to rename"
              onClick={() => onOpen(s, false)}
              onDblClick={() => edit.start(s.id, s.name)}
            >
              {s.name}
            </button>
          );
          if (edit.editing === s.id) {
            label = (
              <input
                class="rename"
                type="text"
                aria-label="Rename saved search"
                {...edit.boxProps(s.id, name => onRename(s.id, name))}
              />
            );
          }
          return (
            <li class={`filter-row saved-row ${s.id === activeId ? 'active' : ''}`}>
              <button
                type="button"
                class="filter-remove"
                aria-label={`Delete ${s.name}`}
                title="Delete saved search"
                onClick={() => confirm(`Delete saved search “${s.name}”?`) && onDelete(s.id)}
              >
                <Icon name="cancel" size={16} />
              </button>
              {label}
              <button
                type="button"
                class="btn-text"
                aria-label={`Update saved search ${s.name}`}
                title="Replace this saved search with the current filters and sort"
                disabled={!canUpdate(s)}
                onClick={() => onUpdate(s.id)}
              >
                <Icon name="refresh" size={16} />
              </button>
              {st.fresh > 0 && (
                <button
                  type="button"
                  class="pill pill-new"
                  title="Show only the new matches"
                  onClick={() => onOpen(s, true)}
                >
                  {format.num(st.fresh)} new
                </button>
              )}
              <span
                class="count"
                title="Open lots matching, not counting hidden or regex-filtered lots"
              >
                {format.num(st.total)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
