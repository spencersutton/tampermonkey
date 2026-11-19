// Item identity and matching: which listings are the same item. Used for
// duplicate listings (`groupId`), relisted items and past closing prices.
//
// Ported from the earlier Python server, whose results (identity keys, item
// types and tags saved by brand/model) are in existing databases, so its rules
// are kept exactly: Python's whitespace and word-boundary rules, and its
// iteration order (grouping never joins two different known identities, so
// which joins happen first can change the result).
//
// Brand and model match exactly, ignoring case and whitespace, when both items
// have both fields. Otherwise titles match fuzzily (`namesMatch`): 90% of words
// in common, ignoring case, punctuation and word order, and no number that only
// one title has.

export const DEFAULT_NAME_MATCH = 90;

export interface Item {
  title: string;
  brand?: string | null | undefined;
  model?: string | null | undefined;
}

export interface Listing extends Item {
  id: number;
  condition?: { value: number } | null | undefined;
  groupId?: number | undefined;
}

// Python's str.split()/strip() whitespace, so keys match those saved by the earlier Python server.
const SPACE =
  '\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const SPACES = new RegExp(`[${SPACE}]+`, 'g');
const EDGES = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'g');

const collapse = (text: string) => text.toLowerCase().replace(SPACES, ' ').replace(EDGES, '');

/**
 * The brand and model as one key, lowercase with whitespace collapsed (model punctuation and word
 * order kept), or null unless both are known. Collapsing whitespace leaves no newline to collide
 * with the separator.
 */
export function brandModelKey(item: Item): string | null {
  const brand = collapse(item.brand ?? '');
  const model = collapse(item.model ?? '');
  return brand && model ? `${brand}\n${model}` : null;
}

export interface ItemTypeRecord extends Item {
  type: string;
  manual: boolean;
  at: number;
}

type Priority = [boolean, number, boolean, number, string, string];

function compare(a: Priority, b: Priority): number {
  for (let i = 0; i < a.length; i++) {
    const [x, y] = [a[i]!, b[i]!];
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Item-type labels by item: known identities first, exact titles when either side lacks one. */
export class ItemTypeIndex<R extends ItemTypeRecord = ItemTypeRecord> {
  private readonly byIdentity = new Map<string, R[]>();
  private readonly byTitle = new Map<string, R[]>();

  constructor(records: Iterable<R>) {
    for (const record of records) {
      const identity = brandModelKey(record);
      if (identity) {
        this.byIdentity.getOrInsertComputed(identity, () => []).push(record);
      }
      this.byTitle.getOrInsertComputed(record.title, () => []).push(record);
    }
  }

  match(item: Item): R | null {
    const identity = brandModelKey(item);
    const candidates = (this.byTitle.get(item.title) ?? []).filter(
      record => !identity || !brandModelKey(record),
    );
    if (identity) {
      candidates.push(...(this.byIdentity.get(identity) ?? []));
    }
    // Manual edits supersede earlier edits; automatic labels prefer complete identities.
    const priority = (r: R): Priority => [
      r.manual,
      r.manual ? r.at : 0,
      Boolean(identity && brandModelKey(r) === identity),
      r.at,
      r.title,
      r.type,
    ];
    let best: R | null = null;
    let bestPriority: Priority | null = null;
    for (const record of candidates) {
      const p = priority(record);
      if (!bestPriority || compare(p, bestPriority) > 0) {
        [best, bestPriority] = [record, p];
      }
    }
    return best;
  }
}

/** Python's \b and \s: "qty" not after a letter, digit or underscore, and its whitespace. */
const QTY = new RegExp(`(?<![\\p{L}\\p{N}_])qty\\.?[${SPACE}]*([0-9]+)`, 'gu');
const TOKEN = /qty[0-9]+|[0-9]+(?:[./][0-9]+)*|[a-z]+/g;

/**
 * The words of a title for matching: lowercase letter runs and numbers ("4.0", "1/2"), with "Qty 3"
 * as one word.
 */
export function nameTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(QTY, ' qty$1 ').match(TOKEN));
}

/** A token set as a map key: its words in order. */
const tokensKey = (tokens: ReadonlySet<string>) => tokens.values().toArray().toSorted().join(' ');
/** A title without words as a map key, distinct from every `tokensKey`. */
const titleKey = (title: string) => `\0${title}`;

const HAS_DIGIT = /[0-9]/;

/** Code-unit order, like Python's string comparison for these ASCII words. */
const byCode = (a: string, b: string) => (a < b ? -1 : Number(a > b));

/**
 * Whether two titles' words are close enough: the same words, or (below 100%) at least `minPct`% of
 * all their words in common and no number that only one has (so "10 oz." never matches "29 oz.",
 * nor "Qty 4" "Qty 6").
 */
export function namesMatch(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
  minPct: number,
): boolean {
  let common = 0;
  for (const t of a) {
    if (b.has(t)) {
      common++;
    } else if (HAS_DIGIT.test(t)) {
      return false;
    }
  }
  if (common === a.size && common === b.size) {
    return a.size > 0;
  }
  if (minPct >= 100 || !a.size || !b.size) {
    return false;
  }
  for (const t of b) {
    if (!a.has(t) && HAS_DIGIT.test(t)) {
      return false;
    }
  }
  return common * 100 >= minPct * (a.size + b.size - common);
}

/** Same brand and model when both have both; otherwise matching names. */
export function itemsMatch(a: Item, b: Item, minPct = DEFAULT_NAME_MATCH): boolean {
  const [left, right] = [brandModelKey(a), brandModelKey(b)];
  if (left && right) {
    return left === right;
  }
  return namesMatch(nameTokens(a.title), nameTokens(b.title), minPct);
}

/**
 * Finds which of many token sets match a given one, without comparing to each.
 *
 * Prefix filtering: with the words of every set in one fixed order (rarest first), two sets with at
 * least t of their words in common must share one of the first |x| - ceil(t·|x|) + 1 words of each.
 * Only those prefixes are indexed and probed; candidates are then checked in full. Sets are
 * identified by their key (`tokensKey`), which `matches` returns.
 */
export class NameIndex {
  private readonly keys: string[] = [];
  private readonly sets: Set<string>[] = [];
  private readonly freq = new Map<string, number>();
  private readonly postings = new Map<string, number[]>();
  private readonly minPct: number;

  constructor(sets: Iterable<ReadonlySet<string>>, minPct: number) {
    this.minPct = minPct;
    for (const set of sets) {
      if (set.size) {
        this.keys.push(tokensKey(set));
        this.sets.push(new Set(set));
      }
    }
    for (const set of this.sets) {
      for (const t of set) {
        this.freq.set(t, (this.freq.get(t) ?? 0) + 1);
      }
    }
    this.sets.forEach((set, i) => {
      for (const t of this.prefix(set)) {
        this.postings.getOrInsertComputed(t, () => []).push(i);
      }
    });
  }

  private prefix(set: ReadonlySet<string>): string[] {
    const freq = (t: string) => this.freq.get(t) ?? 0;
    const ordered = set
      .values()
      .toArray()
      .toSorted((a, b) => freq(a) - freq(b) || byCode(a, b));
    return ordered.slice(
      0,
      set.size - Math.ceil((set.size * Math.min(this.minPct, 100)) / 100) + 1,
    );
  }

  matches(set: ReadonlySet<string>): string[] {
    const seen = new Set<number>();
    const out: string[] = [];
    if (!set.size) {
      return out;
    }
    for (const t of this.prefix(set)) {
      for (const i of this.postings.get(t) ?? []) {
        if (!seen.has(i)) {
          seen.add(i);
          if (namesMatch(set, this.sets[i]!, this.minPct)) {
            out.push(this.keys[i]!);
          }
        }
      }
    }
    return out;
  }
}

interface Entry {
  condition: number | null;
  identity: string | null;
  words: Set<string> | string; // the title's words, or its trimmed lowercase text when it has none
  ids: number[];
}

/**
 * Each lot's group, as the smallest lot id in it: lots whose items match, directly or through
 * another lot in the group. The same known brand and model is the same item in any condition;
 * matching by title (when a lot has no brand/model) stays within one condition. A group never joins
 * two different known brand/models, even when a title without one matches both. Processed in id
 * order, so the result doesn't depend on the order lots are given in.
 */
export function groupLots(
  lots: Iterable<Listing>,
  minPct = DEFAULT_NAME_MATCH,
): Map<number, number> {
  // Lots with the same identity and the same words (or, without words, the same title) always
  // match: one entry each.
  const entries = new Map<string, Entry>();
  for (const lot of [...lots].toSorted((a, b) => a.id - b.id)) {
    const tokens = nameTokens(lot.title);
    const words = tokens.size ? tokens : lot.title.replace(EDGES, '').toLowerCase();
    const condition = lot.condition?.value ?? null;
    const identity = brandModelKey(lot);
    const wordsKey = typeof words === 'string' ? titleKey(words) : tokensKey(words);
    const key = JSON.stringify([condition, identity, wordsKey]);
    entries
      .getOrInsertComputed(key, () => ({ condition, identity, words, ids: [] }))
      .ids.push(lot.id);
  }
  const keys = entries.values().toArray();
  const parent = keys.map((_, i) => i);
  const identity = keys.map(entry => entry.identity);

  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  const join = (i: number, j: number) => {
    const [a, b] = [find(i), find(j)];
    if (a === b || (identity[a] && identity[b] && identity[a] !== identity[b])) {
      return;
    }
    parent[b] = a;
    identity[a] = identity[a] || (identity[b] ?? null);
  };

  const known = new Map<string, number>();
  keys.forEach((entry, i) => {
    if (entry.identity) {
      const first = known.getOrInsert(entry.identity, i);
      if (first !== i) {
        join(first, i);
      }
    }
  });
  const byCondition = new Map<number | null, number[]>();
  keys.forEach((entry, i) => byCondition.getOrInsertComputed(entry.condition, () => []).push(i));
  for (const members of byCondition.values()) {
    const byWords = new Map<string, number[]>();
    const sets: Set<string>[] = [];
    for (const i of members) {
      const words = keys[i]!.words;
      const key = typeof words === 'string' ? titleKey(words) : tokensKey(words);
      if (typeof words !== 'string' && !byWords.has(key)) {
        sets.push(words);
      }
      byWords.getOrInsertComputed(key, () => []).push(i);
    }
    const names = new NameIndex(sets, minPct);
    for (const i of members) {
      const { identity: ident, words } = keys[i]!;
      const similar = typeof words === 'string' ? [titleKey(words)] : names.matches(words);
      for (const w of similar) {
        for (const j of byWords.get(w) ?? []) {
          const other = keys[j]!.identity;
          if (j !== i && find(i) !== find(j) && (!ident || !other || ident === other)) {
            join(j, i);
          }
        }
      }
    }
  }

  const smallest = new Map<number, number>();
  keys.forEach((entry, i) => {
    const root = find(i);
    smallest.set(root, Math.min(smallest.get(root) ?? entry.ids[0]!, entry.ids[0]!));
  });
  const groups = new Map<number, number>();
  keys.forEach((entry, i) => {
    for (const id of entry.ids) {
      groups.set(id, smallest.get(find(i))!);
    }
  });
  return groups;
}

/** Set `groupId` on lots that share their group with another lot; drop it from the rest. */
export function setGroups(lots: Iterable<Listing>): void {
  const all = [...lots];
  const groups = groupLots(all);
  const sizes = new Map<number, number>();
  for (const group of groups.values()) {
    sizes.set(group, (sizes.get(group) ?? 0) + 1);
  }
  for (const lot of all) {
    const group = groups.get(lot.id)!;
    if (sizes.get(group)! > 1) {
      lot.groupId = group;
    } else {
      delete lot.groupId;
    }
  }
}

export interface Row extends Item {
  id: number;
  endsAt?: number | null | undefined;
}

/** Exact brand/model matches plus title fallbacks for incomplete identities. */
export class ItemIndex<R extends Row = Row> {
  private readonly byTitle = new Map<string, R[]>();
  private readonly byIdentity = new Map<string, R[]>();
  private readonly names: NameIndex;

  constructor(rows: Iterable<R>, minPct: number) {
    const sets: Set<string>[] = [];
    for (const row of rows) {
      const tokens = nameTokens(row.title);
      const key = tokensKey(tokens);
      if (!this.byTitle.has(key)) {
        sets.push(tokens);
      }
      this.byTitle.getOrInsertComputed(key, () => []).push(row);
      const identity = brandModelKey(row);
      if (identity) {
        this.byIdentity.getOrInsertComputed(identity, () => []).push(row);
      }
    }
    this.names = new NameIndex(sets, minPct);
  }

  /** Rows of the same item as `item` (never itself), most recently ended first. */
  matches(item: Row): R[] {
    const identity = brandModelKey(item);
    const rows = identity ? [...(this.byIdentity.get(identity) ?? [])] : [];
    for (const key of this.names.matches(nameTokens(item.title))) {
      for (const row of this.byTitle.get(key) ?? []) {
        if (!identity || !brandModelKey(row)) {
          rows.push(row);
        }
      }
    }
    return rows
      .filter(row => row.id !== item.id)
      .toSorted((a, b) => (b.endsAt || 0) - (a.endsAt || 0));
  }
}
