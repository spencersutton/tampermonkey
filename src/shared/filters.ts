// Each filter is a case-insensitive regex tested against the lot title.
// Every pattern is implicitly whole-word: \b(?:pattern)\b.
// Returns null for an invalid pattern.
export function compileFilter(pattern: string): RegExp | null {
  try {
    return new RegExp(`\\b(?:${pattern})\\b`, 'i');
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
  for (const { word, re } of filters) if (re && re.test(title)) return word;
  return null;
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
      cur += ch;
      escaped = false;
    } else if (ch === '\\') {
      cur += ch;
      escaped = true;
    } else if (inClass) {
      if (ch === ']') inClass = false;
      cur += ch;
    } else if (ch === '[') {
      inClass = true;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      if (ch === '(' || ch === '{') depth++;
      else if ((ch === ')' || ch === '}') && depth > 0) depth--;
      cur += ch;
    }
  }
  out.push(cur);
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}
