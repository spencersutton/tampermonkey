// Typeahead for the search box: item types, brands and categories whose names
// match what's being typed, plus the best-matching lots, like a shop's search
// dropdown.
import type { HiddenLot } from '../shared/keys';
import type { ItemDetails } from '../shared/names';
import { matchQuality, stem } from '../shared/search';
import { parseTag } from '../shared/tags';
import type { Lot } from './types';
import { makeSearch, type Facet, type Facets } from './view';

export interface Suggestions {
  query: string; // trimmed
  types: Facet<string>[];
  brands: Facet<string>[];
  tags: Facet<string>[]; // value is the tag key, label the tag as written
  categories: Facet<string>[];
  lots: Lot[];
}

const MAX_TYPES = 5;
const MAX_BRANDS = 3;
const MAX_TAGS = 4;
const MAX_CATEGORIES = 3;
const MAX_LOTS = 4;

/** How well a facet name answers the query: every word must start a word in it. 0 = not at all. */
function nameScore(label: string, words: string[], query: string): number {
  const name = label.toLowerCase();
  let score = 0;
  for (const w of words) {
    const q = Math.max(matchQuality(name, w), matchQuality(name, stem(w)));
    if (q < 0.7) return 0;
    score += q;
  }
  if (name === query) score += 3;
  else if (name.startsWith(query)) score += 1.5;
  return score;
}

/** The best facet names for the query, best match then most lots first. */
function matchFacets(
  facets: Facet<string>[],
  words: string[],
  query: string,
  max: number,
  nameOf: (f: Facet<string>) => string = (f) => f.label,
) {
  return facets
    .map((f) => ({ f, s: nameScore(nameOf(f), words, query) }))
    .filter(({ s, f }) => s > 0 && f.count > 0)
    .toSorted((a, b) => b.s - a.s || b.f.count - a.f.count)
    .slice(0, max)
    .map(({ f }) => f);
}

/** Suggestions for the search box text (nothing for a blank query). */
export function suggest(
  text: string,
  facets: Facets,
  lots: Iterable<Lot>,
  now: number,
  hidden: Record<string, HiddenLot>,
  details?: ItemDetails,
): Suggestions {
  const query = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const none = { query, types: [], brands: [], tags: [], categories: [], lots: [] };
  // Qualifiers and phrases are precise searches already; suggest only for plain words.
  if (!query || /[":]/.test(query) || /(?:^|\s)-/.test(query)) return none;
  const words = query.split(' ');

  const score = makeSearch({ search: query, searchRegex: false }, details);
  const top: { lot: Lot; s: number }[] = [];
  for (const lot of lots) {
    if (lot.endsAt <= now || hidden[lot.id]) continue;
    const s = score(lot);
    if (s == null) continue;
    top.push({ lot, s });
  }
  top.sort((a, b) => b.s - a.s || a.lot.endsAt - b.lot.endsAt || a.lot.id - b.lot.id);
  // One card per duplicate group.
  const seen = new Set<number>();
  const best: Lot[] = [];
  for (const { lot } of top) {
    const group = lot.groupId ?? lot.id;
    if (seen.has(group)) continue;
    seen.add(group);
    best.push(lot);
    if (best.length === MAX_LOTS) break;
  }

  return {
    query,
    types: matchFacets(facets.types, words, query, MAX_TYPES),
    brands: matchFacets(facets.brands, words, query, MAX_BRANDS),
    // Tags match on their value ("nickel" finds "finish: satin nickel").
    tags: matchFacets(facets.tags, words, query, MAX_TAGS, (f) => parseTag(f.value).value),
    categories: matchFacets(facets.categories, words, query, MAX_CATEGORIES),
    lots: best,
  };
}
