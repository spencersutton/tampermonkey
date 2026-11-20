// Tags: any number of labels per lot beyond its item type. A plain tag
// ("cabinet knob") is a label; "name: value" ("finish: satin nickel") is an
// attribute, filtered per name like a shop's "Finish" dropdown. The server
// stores them tidied ("name: value"; see clean_tag in store.py) in any case;
// they are compared ignoring case, by toLower, and filters hold keys.

export interface ParsedTag {
  name: string | null; // attribute name, or null for a plain tag
  value: string;
}

const TAG_PARTS = /^(?:([^:]*):)?(.*)$/s;

export function parseTag(tag: string): ParsedTag {
  const [, name, value] = TAG_PARTS.exec(tag) ?? [];
  return { name: name?.trim() ?? null, value: value?.trim() ?? '' };
}

/** What tags are compared by: "Finish: Brass" and "finish: brass" are the same tag. */
export const toLower = (tag: string) => tag.toLowerCase();

/** Filter group of a tag: its attribute name (lowercase), or '' for plain tags. */
export const tagGroup = (tag: string) => parseTag(tag).name?.toLowerCase() ?? '';

/** Heading for a tag group: "Finish", or "Tags" for plain tags. */
export function groupLabel(group: string): string {
  return group ? group.charAt(0).toUpperCase() + group.slice(1) : 'Tags';
}

/**
 * The filter value for lots with no tag of an attribute ("finish:", an empty value, which stored
 * tags never have).
 */
export const noneTag = (group: string) => `${group}:`;

/** Whether a filter value is an attribute's "none" (see noneTag). */
export function isNoneTag(tag: string): boolean {
  const { name, value } = parseTag(tag);
  return Boolean(name) && !value;
}

/** A tag as shown on its own: "Finish: satin nickel", "Finish: none", or the plain tag. */
export function tagLabel(tag: string): string {
  const { name, value } = parseTag(tag);
  return name ? `${groupLabel(name)}: ${value || 'none'}` : value;
}

const MAX_TAG_PART = 60;

/**
 * A tag tidied the way the server stores it (clean_tag in store.py), keeping its case; null when
 * nothing is left.
 */
export function cleanTag(text: string): string | null {
  const tidy = (part: string) =>
    part
      .split(/\s+/)
      .filter(Boolean)
      .join(' ')
      .replace(/^[\s"'`.,;]+|[\s"'`.,;]+$/g, '')
      .slice(0, MAX_TAG_PART);
  const i = text.indexOf(':');
  if (i >= 0) {
    const left = tidy(text.slice(0, i));
    const right = tidy(text.slice(i + 1));
    if (left && right) {
      return `${left}: ${right}`;
    }
  }
  return tidy(text.replaceAll(':', ' ')) || null;
}
