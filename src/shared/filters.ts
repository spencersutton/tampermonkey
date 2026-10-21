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

export interface CompiledFilter {
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

// Split a comma-separated filter list. Commas inside (...), [...], {...} or
// escaped as \, stay part of the pattern, so quantifiers like {1,3} survive.
export function splitFilters(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let inClass = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else if (inClass) {
      inClass = ch !== ']';
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    } else if (ch === '(' || ch === '{') {
      depth++;
    } else if ((ch === ')' || ch === '}') && depth > 0) {
      depth--;
    }
    cur += ch;
  }
  out.push(cur);
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}
