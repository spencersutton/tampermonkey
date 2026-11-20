// Pure logic for the tag rules editor: draft comparison, rule filtering, tag
// list merging, and code-point match-span slicing.
import { cleanTag } from '../shared/tags';

export interface TagDraft {
  id: number | null; // null for a new rule
  pattern: string;
  tags: string[];
}

export const EMPTY_DRAFT: TagDraft = { id: null, pattern: '', tags: [] };

export const sameDraft = (a: TagDraft, b: TagDraft): boolean =>
  a.id === b.id && a.pattern === b.pattern && a.tags.join('\n') === b.tags.join('\n');

export function filterTagRules<T extends { pattern: string; tags: string[] }>(
  rules: T[],
  filter: string,
): T[] {
  const q = filter.trim().toLowerCase();
  if (!q) {
    return rules;
  }
  return rules.filter(
    r => r.pattern.toLowerCase().includes(q) || r.tags.some(t => t.toLowerCase().includes(q)),
  );
}

/** Add comma-separated tags from `raw` to `tags`, deduplicating case-insensitively. */
export function mergeRuleTags(tags: string[], raw: string): string[] {
  const next = [...tags];
  for (const tag of raw.split(',').map(cleanTag)) {
    if (tag && !next.some(t => t.toLowerCase() === tag.toLowerCase())) {
      next.push(tag);
    }
  }
  return next;
}

/** Slice a title into [before, match, after] using the server's code-point span. */
export function splitMatchSpan(title: string, span: [number, number]): [string, string, string] {
  const chars = Array.from(title);
  const [start, end] = span;
  return [
    chars.slice(0, start).join(''),
    chars.slice(start, end).join(''),
    chars.slice(end).join(''),
  ];
}
