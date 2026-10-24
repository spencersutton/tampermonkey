// Fuzzy lot-name matching, for combining duplicate listings. The server's
// history.py has the same rules (name_tokens, names_match, NameIndex) for
// past closing prices; keep the two in step.
//
// How fuzzy is the `tlxNameMatch` setting: the share of words two titles must
// have in common, 100 meaning the same words (ignoring case, punctuation and
// word order). A number only one of them has never matches ("10 oz." vs
// "29 oz.", "Qty 4" vs "Qty 6"), however many other words they share.

export const DEFAULT_NAME_MATCH = 90;
export const MIN_NAME_MATCH = 50;

const QTY = /\bqty\.?\s*([0-9]+)/g;
const TOKEN = /qty[0-9]+|[0-9]+(?:[./][0-9]+)*|[a-z]+/g;

/** The words of a title for matching: lowercase letter runs and numbers ("4.0", "1/2"), with "Qty 3" as one word. */
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

/** The setting as a percentage, defaulted and clamped. */
export const nameMatchPct = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(MIN_NAME_MATCH, v)) : DEFAULT_NAME_MATCH;

/**
 * Group titles whose names match, directly or through another title in the
 * group. Returns each title's group as the first title of it, for use as a key.
 *
 * Prefix filtering keeps this from comparing every pair: with each title's
 * words in one fixed order (rarest first), two titles with at least t of their
 * words in common share one of the first |x| - ceil(t·|x|) + 1 words of each.
 */
export function groupNames(titles: Iterable<string>, minPct: number): Map<string, string> {
  const byKey = new Map<string, { words: Set<string>; titles: string[] }>();
  for (const title of titles) {
    const words = nameTokens(title);
    const key = words.size ? [...words].sort().join(' ') : `\u0000${title.trim().toLowerCase()}`;
    const entry = byKey.get(key);
    if (entry) {
      entry.titles.push(title);
    } else {
      byKey.set(key, { words, titles: [title] });
    }
  }
  const entries = [...byKey.values()];
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  if (minPct < 100) {
    const freq = new Map<string, number>();
    for (const { words } of entries) {
      for (const t of words) {
        freq.set(t, (freq.get(t) ?? 0) + 1);
      }
    }
    const postings = new Map<string, number[]>();
    entries.forEach(({ words }, i) => {
      const ordered = [...words].sort((x, y) => freq.get(x)! - freq.get(y)! || (x < y ? -1 : x > y ? 1 : 0));
      const seen = new Set<number>();
      for (const t of ordered.slice(0, words.size - Math.ceil((words.size * minPct) / 100) + 1)) {
        const list = postings.get(t) ?? [];
        for (const j of list) {
          if (seen.has(j)) {
            continue;
          }
          seen.add(j);
          if (find(i) !== find(j) && namesMatch(words, entries[j].words, minPct)) {
            parent[find(i)] = find(j);
          }
        }
        list.push(i);
        postings.set(t, list);
      }
    });
  }

  const out = new Map<string, string>();
  entries.forEach(({ titles: ts }, i) => {
    const head = entries[find(i)].titles[0];
    for (const t of ts) {
      out.set(t, head);
    }
  });
  return out;
}
