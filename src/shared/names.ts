// Fuzzy lot-name matching, for combining duplicate listings. The server's
// history.py has the same rules (name_tokens, names_match, NameIndex) for
// past closing prices; keep the two in step.
//
// Title fallback requires 90% of words in common, ignoring case, punctuation
// and word order. A number only one of them has never matches ("10 oz." vs
// "29 oz.", "Qty 4" vs "Qty 6"), however many other words they share.

export const DEFAULT_NAME_MATCH = 90;

export interface ItemIdentity {
  title: string;
  brand?: string | null | undefined;
  model?: string | null | undefined;
}

export interface ItemDetails {
  brands: ReadonlyMap<number, string | null>;
  models: ReadonlyMap<number, string | null>;
}

const normalizeIdentity = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Model punctuation and word order are significant; this is not fuzzy title matching. */
export function brandModelKey(item: ItemIdentity): string | null {
  const brand = normalizeIdentity(item.brand);
  const model = normalizeIdentity(item.model);
  return brand && model ? JSON.stringify([brand, model]) : null;
}

/** Detail caches can be newer than the price-versioned catalog entry. */
export function itemIdentity(
  item: ItemIdentity & { id: number },
  details?: ItemDetails,
): ItemIdentity {
  const brand = details?.brands.get(item.id);
  const model = details?.models.get(item.id);
  return {
    title: item.title,
    brand: brand == null ? item.brand : brand,
    model: model == null ? item.model : model,
  };
}

export function itemsMatch(a: ItemIdentity, b: ItemIdentity, minPct: number): boolean {
  const left = brandModelKey(a);
  const right = brandModelKey(b);
  return left && right
    ? left === right
    : namesMatch(nameTokens(a.title), nameTokens(b.title), minPct);
}

/** Item types retain exact-title fallback rather than fuzzy title matching. */
export function sameItemType(a: ItemIdentity, b: ItemIdentity): boolean {
  const left = brandModelKey(a);
  const right = brandModelKey(b);
  return left && right ? left === right : a.title === b.title;
}

const QTY = /\bqty\.?\s*([0-9]+)/g;
const TOKEN = /qty[0-9]+|[0-9]+(?:[./][0-9]+)*|[a-z]+/g;

/**
 * The words of a title for matching: lowercase letter runs and numbers ("4.0", "1/2"), with "Qty 3"
 * as one word.
 */
export function nameTokens(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(QTY, ' qty$1 ').match(TOKEN));
}

/** Whether two titles' words are close enough (see the top of this file). */
export function namesMatch(a: Set<string>, b: Set<string>, minPct: number): boolean {
  let common = 0;
  for (const t of a) {
    if (b.has(t)) {
      common++;
    } else if (minPct >= 100 || /[0-9]/.test(t)) {
      return false;
    }
  }
  if (common === b.size && common === a.size) {
    return common > 0;
  }
  for (const t of b) {
    if (!a.has(t) && /[0-9]/.test(t)) {
      return false;
    }
  }
  return minPct < 100 && common * 100 >= minPct * (a.size + b.size - common);
}

/**
 * Group titles whose names match, directly or through another title in the group. Returns each
 * title's group as the first title of it, for use as a key.
 *
 * Prefix filtering keeps this from comparing every pair: with each title's words in one fixed order
 * (rarest first), two titles with at least t of their words in common share one of the first |x| -
 * ceil(t·|x|) + 1 words of each.
 */
export function groupNames(titles: Iterable<string>, minPct: number): Map<string, string> {
  const items = [...new Set(titles)].map((title, id) => ({ title, id }));
  const groups = groupItems(items, minPct);
  return new Map(items.map(({ title, id }) => [title, items[groups.get(id)!]!.title]));
}

/** Group identity matches first, then title fallbacks without bridging conflicting known models. */
export function groupItems(
  lots: (ItemIdentity & { id: number })[],
  minPct: number,
): Map<number, number> {
  const entries = new Map<string, { item: ItemIdentity & { id: number }; ids: number[] }>();
  for (const item of lots) {
    const words = [...nameTokens(item.title)].toSorted();
    const key = JSON.stringify([
      brandModelKey(item),
      words.length ? words : item.title.trim().toLowerCase(),
    ]);
    const entry = entries.get(key);
    if (entry) {
      entry.ids.push(item.id);
    } else {
      entries.set(key, { item, ids: [item.id] });
    }
  }
  const members = [...entries.values()];
  const items = members.map(({ item }) => item);
  const parents = items.map((_, i) => i);
  const identities = items.map(brandModelKey);
  const find = (i: number): number => (parents[i] === i ? i : (parents[i] = find(parents[i]!)));
  const join = (i: number, j: number) => {
    const a = find(i),
      b = find(j);
    if (a === b || (identities[a] && identities[b] && identities[a] !== identities[b])) {
      return;
    }
    parents[b] = a;
    identities[a] ||= identities[b] ?? null;
  };
  const known = new Map<string, number>();
  items.forEach((item, i) => {
    const key = brandModelKey(item);
    if (key) {
      const previous = known.get(key);
      if (previous !== undefined) {
        join(previous, i);
      } else {
        known.set(key, i);
      }
    }
  });

  const words = items.map((item) => nameTokens(item.title));
  const freq = new Map<string, number>();
  for (const tokens of words) {
    for (const token of tokens) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }
  const postings = new Map<string, number[]>();
  words.forEach((tokens, i) => {
    const ordered = [...tokens].toSorted((a, b) => {
      const frequency = freq.get(a)! - freq.get(b)!;
      if (frequency) {
        return frequency;
      }
      if (a < b) {
        return -1;
      }
      return a > b ? 1 : 0;
    });
    const prefix = ordered.slice(0, tokens.size - Math.ceil((tokens.size * minPct) / 100) + 1);
    if (!prefix.length) {
      prefix.push(`\u0000${items[i]!.title.trim().toLowerCase()}`);
    }
    const seen = new Set<number>();
    for (const token of prefix) {
      const list = postings.get(token) ?? [];
      for (const j of list) {
        if (seen.has(j) || find(i) === find(j)) {
          continue;
        }
        seen.add(j);
        if (
          (tokens.size === 0 && words[j]!.size === 0) ||
          itemsMatch(items[i]!, items[j]!, minPct)
        ) {
          join(j, i);
        }
      }
      list.push(i);
      postings.set(token, list);
    }
  });
  return new Map(
    members.flatMap(({ ids }, i) => ids.map((id): [number, number] => [id, items[find(i)]!.id])),
  );
}
