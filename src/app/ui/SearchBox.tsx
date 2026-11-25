// The search box with its typeahead: item types, brands and categories that
// match what's typed (picking one filters by it), the best-matching lots, and
// recent searches when the box is empty.
import { useRef, useState } from 'preact/hooks';

import { CDN } from '../../shared/constants';
import * as format from '../../shared/format';
import { KEYS } from '../../shared/keys';
import { searchOptionsFor, type SearchOption } from '../logic/suggest';
import { searchRegexOf } from '../logic/view';
import { getSetting, setSetting } from '../server/settings';
import {
  gridView,
  openLot,
  rememberSearch,
  searchDraft,
  setSearchDraft,
  setView,
  storedView,
  suggestions,
} from './state';

const GROUP_TITLES: Record<SearchOption['kind'], string | null> = {
  search: null,
  recent: 'Recent searches',
  type: 'Item types',
  brand: 'Brands',
  category: 'Categories',
  lot: 'Lots',
};

const SEARCH_TIP =
  'Search titles, item types, brands, models and lot numbers. Every word must match; plurals and common synonyms count. Use "quotes" for a phrase, -word to exclude, and brand:, model: or type: to search one field. Press / to jump here.';

export function SearchBox() {
  const view = storedView.value;
  const draft = searchDraft.value;
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const badRegex =
    view.searchRegex && draft.trim() !== '' && !searchRegexOf({ ...view, search: draft });
  const showList = open && !view.searchRegex;
  let options: SearchOption[] = [];
  if (showList) {
    options = searchOptionsFor(draft, getSetting(KEYS.recentSearches), suggestions.value);
  }
  // A lone "Search for …" row adds nothing.
  const listed = options.length > 1 || options[0]?.kind === 'recent' ? options : [];

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const choose = (o: SearchOption) => {
    close();
    switch (o.kind) {
      case 'search':
      case 'recent':
        setView({ search: o.text });
        rememberSearch(o.text);
        break;
      case 'type':
        rememberSearch(draft);
        setView({ search: '', types: [o.facet.value] });
        break;
      case 'brand':
        rememberSearch(draft);
        setView({ search: '', brands: [o.facet.value] });
        break;
      case 'category':
        rememberSearch(draft);
        setView({ search: '', categories: [o.facet.value] });
        break;
      case 'lot':
        rememberSearch(draft);
        input.current?.blur();
        openLot(o.lot);
        break;
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) {
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!listed.length) {
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // Cycle through the options and back to the text box (-1).
      setActive(i => {
        const next = i + step;
        if (next >= listed.length) {
          return -1;
        }
        return next < -1 ? listed.length - 1 : next;
      });
    } else if (e.key === 'Enter') {
      const o = listed[active];
      e.preventDefault();
      if (o) {
        choose(o);
      } else {
        // Search now rather than after the typing pause.
        setView({ search: draft });
        rememberSearch(draft);
        close();
      }
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  let searchTitle = SEARCH_TIP;
  if (badRegex) {
    searchTitle = 'Invalid regex';
  } else if (view.searchRegex) {
    searchTitle = 'Case-insensitive regex across title, lot number, brand, model and item type';
  }
  let placeholder = `Search ${format.num(gridView.value.open)} lots`;
  if (view.searchRegex) {
    placeholder = `Regex search ${format.num(gridView.value.open)} lots`;
  }
  const optionId = (i: number) => `search-option-${i}`;
  let lastKind: SearchOption['kind'] | null = null;
  const expanded = showList && listed.length > 0;

  return (
    <div class="search-box">
      <input
        ref={input}
        class={`search ${badRegex ? 'has-error' : ''}`}
        type="search"
        role="combobox"
        aria-expanded={expanded}
        aria-controls="search-options"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 && listed[active] ? optionId(active) : undefined}
        placeholder={placeholder}
        aria-label="Search lots"
        aria-invalid={badRegex}
        title={searchTitle}
        spellcheck={!view.searchRegex}
        autocomplete="off"
        value={draft}
        onInput={e => {
          setSearchDraft(e.currentTarget.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        class={`regex-toggle ${view.searchRegex ? 'on' : ''}`}
        aria-pressed={view.searchRegex}
        title={view.searchRegex ? 'Regex search on (case-insensitive)' : 'Use regex search'}
        onClick={() => setView({ searchRegex: !view.searchRegex })}
      >
        .*
      </button>
      {expanded && (
        <ul
          class="search-options"
          id="search-options"
          role="listbox"
          aria-label="Search suggestions"
          // Keep focus in the box so a click can pick an option before blur closes the list.
          onMouseDown={e => e.preventDefault()}
        >
          {listed.map((o, i) => {
            const title = GROUP_TITLES[o.kind];
            const head = title && o.kind !== lastKind;
            lastKind = o.kind;
            return (
              <>
                {head && (
                  <li class="search-group" role="presentation">
                    {title}
                    {o.kind === 'recent' && (
                      <button
                        type="button"
                        class="btn-text"
                        onClick={() => setSetting(KEYS.recentSearches, [])}
                      >
                        Clear
                      </button>
                    )}
                  </li>
                )}
                <li
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  class={`search-option search-option-${o.kind} ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(o)}
                >
                  <OptionBody option={o} />
                </li>
              </>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function OptionBody({ option: o }: { option: SearchOption }) {
  switch (o.kind) {
    case 'search':
      return (
        <span>
          Search for <strong>“{o.text}”</strong>
        </span>
      );
    case 'recent':
      return <span>{o.text}</span>;
    case 'type':
    case 'brand':
    case 'category':
      return (
        <>
          <span class="search-option-label">{o.facet.label}</span>
          <span class="count">{format.num(o.facet.count)}</span>
        </>
      );
    case 'lot': {
      const img = o.lot.images[0];
      let thumb = <span class="noimg" />;
      if (img) {
        thumb = <img src={`${CDN}/${img.image_thumb}`} alt="" loading="lazy" />;
      }
      return (
        <>
          {thumb}
          <span class="search-option-label">{o.lot.title}</span>
          <span class="search-option-price">{format.dollars(o.lot.current_price)}</span>
        </>
      );
    }
  }
}
