// Each filter is a case-insensitive regex tested against the lot title.
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
  re: RegExp | null;
}

/** Compile every non-blank filter word; invalid patterns keep `re: null` so the UI can flag them. */
export function buildRegexes(words: string[]): CompiledFilter[] {
  return words.filter((w) => w.trim()).map((w) => ({ word: w, re: compileFilter(w) }));
}

/** The first filter word whose regex matches the title, or null if none do. */
export function firstMatch(filters: CompiledFilter[], title: string): string | null {
  return filters.find(({ re }) => re?.test(title))?.word ?? null;
}
