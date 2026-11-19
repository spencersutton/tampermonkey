// Item types: what an item is ("pressure washer"), named by the LLM or corrected by hand.
export const MAX_TYPE_LENGTH = 60;

/** A type tidied: lowercase, no quotes or trailing punctuation, single spaces. */
export function cleanType(text: string): string {
  const t = text
    .trim()
    .replace(/^["'`*]+|["'`*]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return t
    .replace(/[.,;:]+$/, '')
    .trim()
    .slice(0, MAX_TYPE_LENGTH);
}
