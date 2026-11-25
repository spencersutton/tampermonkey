// Catalog search engine: query parsing, matching, relevance ranking and
// spelling correction, all run locally against the in-memory catalog.
//
// Query syntax (case-insensitive, every term must match):
//   cordless drill           words anywhere in title, lot number, brand, model or item type
//   "cordless drill"         an exact phrase
//   brand:dewalt model:dcd   restrict a term to one field (quote multi-word values)
//   type:"pressure washer"   restrict a term to the item type
//   desc:brushless           restrict a term to the lot description
//   -refurbished             exclude lots containing the word
//
// Plain words also match their singular/plural forms ("drills" finds "drill")
// and common shopper synonyms ("fridge" finds "refrigerator"). Ranking weighs
// where a word matched (item type and brand count more than the title) and how
// (a whole word counts more than part of one).

export type Field = 'brand' | 'model' | 'type' | 'desc';

export interface Term {
  field: Field | null;
  value: string; // lowercased, unquoted
  phrase: boolean; // was quoted: matched exactly, no stemming or synonyms
  negate: boolean;
}

/** The searchable text of one lot. */
export interface SearchDoc {
  title: string;
  lotNumber: string;
  brand?: Nullable<string>;
  model?: Nullable<string>;
  itemType?: string | undefined;
  description?: Nullable<string>;
}

const TERM_RE =
  /(?:^|\s+)(-(?=\S))?(?:(brand|model|type|desc):\s*)?("(?:\\.|[^"\\])*"(?=\s|$)|\S+)/g;

/** Split a query into terms. Blank input gives no terms. */
export function parseQuery(query: string): Term[] {
  return Array.from(query.toLowerCase().matchAll(TERM_RE), ([, neg, field, raw = '']) => {
    const phrase = raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"');
    return {
      field:
        field === 'brand' || field === 'model' || field === 'type' || field === 'desc'
          ? field
          : null,
      value: phrase ? raw.slice(1, -1).replace(/\\(["\\])/g, '$1') : raw,
      phrase,
      negate: Boolean(neg),
    };
  });
}

/** Write terms back as a query string. */
export function formatQuery(terms: Term[]): string {
  return terms
    .map(t => {
      const needsQuotes = t.phrase || /\s/.test(t.value);
      const value = needsQuotes ? `"${t.value.replace(/(["\\])/g, '\\$1')}"` : t.value;
      return `${t.negate ? '-' : ''}${t.field ? `${t.field}:` : ''}${value}`;
    })
    .join(' ');
}

/** Singular form of an English word, roughly ("batteries" → "battery", "boxes" → "box"). */
export function stem(word: string): string {
  if (word.length <= 3 || !/[a-z]$/.test(word)) {
    return word;
  }
  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y';
  }
  if (/(?:ss|sh|ch|x|z)es$/.test(word)) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !/(?:ss|us|is)$/.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Words shoppers use interchangeably. A query word in a group also matches the other entries as
 * whole words; entries may be several words long.
 */
const SYNONYM_GROUPS = [
  ['fridge', 'refrigerator'],
  ['tv', 'television'],
  ['couch', 'sofa'],
  ['rug', 'carpet'],
  ['cabinet', 'cupboard'],
  ['vacuum', 'vac'],
  ['grill', 'bbq', 'barbecue'],
  ['chainsaw', 'chain saw'],
  ['lawnmower', 'lawn mower', 'mower'],
  ['weedeater', 'weed eater', 'weedwacker', 'weed wacker', 'string trimmer'],
  ['ac', 'air conditioner'],
  ['bulb', 'lightbulb', 'light bulb'],
  ['phone', 'cellphone', 'smartphone'],
  ['wrench', 'spanner'],
  ['nightstand', 'night stand', 'bedside table'],
  ['dishwasher', 'dish washer'],
  ['washer', 'washing machine'],
  ['dryer', 'clothes dryer'],
  ['bike', 'bicycle'],
  ['stroller', 'pram'],
  ['heater', 'space heater'],
  ['powerwasher', 'power washer', 'pressure washer'],
] as const;

const SYNONYMS = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) {
    if (!word.includes(' ')) {
      SYNONYMS.set(
        word,
        group.filter(w => w !== word),
      );
    }
  }
}

/** Other words that should match `word` (a lowercased query word). */
export function synonymsOf(word: string): readonly string[] {
  return SYNONYMS.get(word) ?? SYNONYMS.get(stem(word)) ?? [];
}

const isWordChar = (c: string | undefined) => c != null && /[\p{L}\p{N}]/u.test(c);

/**
 * How well `needle` occurs in `hay` (both lowercase): 1 as a whole word, 0.7 at the start of a
 * word, 0.3 inside one, 0 not at all.
 */
export function matchQuality(hay: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let best = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) {
    const start = !isWordChar(hay[i - 1]) || !isWordChar(needle[0]);
    const end = !isWordChar(hay[i + needle.length]) || !isWordChar(needle.at(-1));
    let q = 0.3;
    if (start) {
      q = end ? 1 : 0.7;
    }
    if (q > best) {
      best = q;
    }
    if (best === 1) {
      break;
    }
  }
  return best;
}

const WEIGHTS = {
  itemType: 6,
  brand: 5,
  model: 4,
  lotNumber: 4,
  title: 3,
  description: 1.5,
} as const;
type DocField = keyof typeof WEIGHTS;
const BASE_FIELDS: DocField[] = ['itemType', 'brand', 'model', 'lotNumber', 'title'];
const ALL_FIELDS: DocField[] = [...BASE_FIELDS, 'description'];

/** A document's fields, lowercased, ready for matching. */
export interface PreparedDoc {
  title: string;
  lotNumber: string;
  brand: string;
  model: string;
  itemType: string;
  description: string;
  all: string; // base fields, space separated
  allWithDesc: string; // base fields + description, space separated
  stems: Partial<Record<DocField, string>>; // title, item type and description with each word singular
}

const stemWords = (text: string) => text.replace(/[\p{L}\p{N}]+/gu, stem);

export function prepareDoc(doc: SearchDoc): PreparedDoc {
  // Fields are typed as present, but stored lots from older servers can lack them.
  const title = ((doc.title as string | undefined) ?? '').toLowerCase();
  const lotNumber = ((doc.lotNumber as string | undefined) ?? '').toLowerCase();
  const brand = (doc.brand ?? '').toLowerCase();
  const model = (doc.model ?? '').toLowerCase();
  const itemType = (doc.itemType ?? '').toLowerCase();
  const description = (doc.description ?? '').toLowerCase();
  const all = [`${title} ${lotNumber}`, brand, model, itemType].filter(Boolean).join(' ');
  return {
    title,
    lotNumber,
    brand,
    model,
    itemType,
    description,
    all,
    allWithDesc: description ? `${all} ${description}` : all,
    stems: {
      title: stemWords(title),
      itemType: stemWords(itemType),
      description: description ? stemWords(description) : '',
    },
  };
}

const FIELD_OF: Record<Field, DocField> = {
  brand: 'brand',
  model: 'model',
  type: 'itemType',
  desc: 'description',
};

/** MatchQuality, except one or two letters inside a word ("ac" in "back") don't count. */
function termQuality(text: string, value: string): number {
  const q = matchQuality(text, value);
  return value.length <= 2 && q < 0.7 ? 0 : q;
}

/** Best weighted score for one positive term in one field, or 0. */
function termFieldScore(term: Term, text: string, stems: string | undefined, weight: number) {
  if (!text) {
    return 0;
  }
  const exact = termQuality(text, term.value);
  if (term.phrase || term.field === 'brand' || term.field === 'model') {
    return exact * weight;
  }
  let best = exact;
  const singular = stem(term.value);
  if (singular !== term.value) {
    best = Math.max(best, termQuality(text, singular) * 0.9);
  }
  // Singular query, plural text ("battery" finds "batteries").
  if (stems != null && best < 1) {
    best = Math.max(best, termQuality(stems, singular) * 0.9);
  }
  for (const syn of synonymsOf(term.value)) {
    // Synonyms count only as whole words, so a short one like "ac" can't match inside "back".
    if (matchQuality(text, syn) === 1) {
      best = Math.max(best, 0.8);
    }
  }
  return best * weight;
}

/** Score of one term across the document (0 means it doesn't match). */
function termScore(term: Term, doc: PreparedDoc, includeDescription = false): number {
  if (term.field) {
    const f = FIELD_OF[term.field];
    return termFieldScore(term, doc[f], doc.stems[f], WEIGHTS[f]);
  }
  let best = 0;
  for (const f of includeDescription ? ALL_FIELDS : BASE_FIELDS) {
    best = Math.max(best, termFieldScore(term, doc[f], doc.stems[f], WEIGHTS[f]));
  }
  const hay = includeDescription ? doc.allWithDesc : doc.all;
  // Plain substring anywhere (e.g. across a title/lot-number boundary) still counts a little.
  return best || (term.value.length > 2 && hay.includes(term.value) ? 0.5 : 0);
}

/** A compiled query: `score` returns null when the document doesn't match. */
export interface CompiledQuery {
  terms: Term[];
  empty: boolean;
  score: (doc: PreparedDoc) => number | null;
}

export interface SearchOptions {
  includeDescription?: boolean;
}

/** Compile a plain (non-regex) query. */
export function compileQuery(query: string, opts: SearchOptions = {}): CompiledQuery {
  const includeDesc = Boolean(opts.includeDescription);
  const terms = parseQuery(query);
  const positive = terms.filter(t => !t.negate);
  const negative = terms.filter(t => t.negate && t.value);
  const words = positive
    .filter(t => !t.field)
    .map(t => t.value)
    .join(' ');
  return {
    terms,
    empty: !terms.length,
    score(doc) {
      let total = 0;
      for (const term of positive) {
        if (!term.value) {
          return null;
        }
        const s = termScore(term, doc, includeDesc);
        if (!s) {
          return null;
        }
        total += s;
      }
      for (const term of negative) {
        const allText = includeDesc ? doc.allWithDesc : doc.all;
        const text = term.field ? doc[FIELD_OF[term.field]] : allText;
        if (matchQuality(text, term.value) >= 0.7) {
          return null;
        }
      }
      // Bonus when the plain words appear together, in order, in the title, item type or description.
      if (words.includes(' ')) {
        if (doc.itemType === words) {
          total += 8;
        } else if (doc.title.includes(words) || doc.itemType.includes(words)) {
          total += 4;
        } else if (includeDesc && doc.description.includes(words)) {
          total += 2;
        }
      }
      return total;
    },
  };
}

// ---------------------------------------------------------------------------
// Spelling correction
// ---------------------------------------------------------------------------

/** Word frequencies across a set of documents, for spelling correction. */
export function buildVocabulary(
  docs: Iterable<PreparedDoc>,
  opts: SearchOptions = {},
): Map<string, number> {
  const includeDesc = Boolean(opts.includeDescription);
  const vocab = new Map<string, number>();
  for (const d of docs) {
    const text = includeDesc
      ? `${d.title} ${d.brand} ${d.itemType} ${d.description}`
      : `${d.title} ${d.brand} ${d.itemType}`;
    for (const w of text.split(/[^\p{L}\p{N}]+/u)) {
      if (w.length >= 3 && !/^\d+$/.test(w)) {
        vocab.set(w, (vocab.get(w) ?? 0) + 1);
      }
    }
  }
  return vocab;
}

/** Optimal string alignment distance, giving up (returning max + 1) past `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur.push(v);
      if (v < rowMin) {
        rowMin = v;
      }
    }
    if (rowMin > max) {
      return max + 1;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/** The likeliest intended word for a misspelt one, or null if none is close. */
function correctWord(word: string, vocab: Map<string, number>): string | null {
  if (vocab.has(word) || word.length < 3 || /\d/.test(word)) {
    return null;
  }
  const max = word.length <= 4 ? 1 : 2;
  let best: { word: string; dist: number; freq: number } | null = null;
  for (const [w, freq] of vocab) {
    const dist = editDistance(word, w, max);
    if (dist <= max && (!best || dist < best.dist || (dist === best.dist && freq > best.freq))) {
      best = { word: w, dist, freq };
    }
  }
  return best?.word ?? null;
}

/**
 * The query with misspelt plain words replaced by the closest word in the catalog, or null when
 * nothing needed correcting. Only words that match no document are corrected.
 */
export function correctQuery(
  query: string,
  docs: PreparedDoc[],
  vocab: Map<string, number>,
  opts: SearchOptions = {},
): string | null {
  const includeDesc = Boolean(opts.includeDescription);
  const terms = parseQuery(query);
  const fixed = terms.map(t => {
    if (t.phrase || t.negate || t.field === 'model' || !t.value) {
      return t;
    }
    if (docs.some(d => termScore(t, d, includeDesc) > 0)) {
      return t;
    }
    const better = correctWord(t.value, vocab);
    return better ? { ...t, value: better } : t;
  });
  return fixed.some((t, i) => t !== terms[i]) ? formatQuery(fixed) : null;
}
