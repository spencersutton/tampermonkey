// Each filter is a case-insensitive regex tested against the lot title, and
// also against the item type, where it must match the whole item type.
// Every pattern is implicitly whole-word: a match may not start or end inside
// a word. Unlike \b, this also holds next to punctuation, so `\(Gold\)` can
// match at the end of a title.
// Returns null for an invalid pattern.
const EDGE = '(?:(?<!\\w)|(?!\\w))';
export function compileFilter(pattern: string): RegExp | null {
  try {
    return new RegExp(`${EDGE}(?:${pattern})${EDGE}`, 'i');
  } catch {
    return null;
  }
}

interface CompiledFilter {
  word: string;
  re: RegExp | null; // tested against the title
  exact: RegExp | null; // must match the whole item type
}

/** Compile every non-blank filter word; invalid patterns keep `re: null` so the UI can flag them. */
export function buildRegexes(words: string[]): CompiledFilter[] {
  return words
    .filter(w => w.trim())
    .map(w => {
      const re = compileFilter(w);
      return { word: w, re, exact: re && new RegExp(`^(?:${w})$`, 'i') };
    });
}

/** Whether a compiled filter matches a lot's title, or its whole item type. */
export function filterMatches(
  { re, exact }: CompiledFilter,
  title: string,
  itemType: string | null | undefined,
): boolean {
  return Boolean(re?.test(title) || (itemType && exact?.test(itemType.trim())));
}
