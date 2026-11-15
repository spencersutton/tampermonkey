// Tags: any number of labels per lot beyond its item type. A plain tag
// ("cabinet knob") is a label; "name: value" ("finish: satin nickel") is an
// attribute, filtered per name like a shop's "Finish" dropdown. The server
// stores them tidied (lowercase, "name: value"; see clean_tag in store.py).

export interface ParsedTag {
  name: string | null; // attribute name, or null for a plain tag
  value: string;
}

export function parseTag(tag: string): ParsedTag {
  const i = tag.indexOf(':');
  if (i < 0) return { name: null, value: tag.trim() };
  return { name: tag.slice(0, i).trim(), value: tag.slice(i + 1).trim() };
}

/** Filter group of a tag: its attribute name, or '' for plain tags. */
export const tagGroup = (tag: string) => parseTag(tag).name ?? '';

/** Heading for a tag group: "Finish", or "Tags" for plain tags. */
export function groupLabel(group: string): string {
  return group ? group.charAt(0).toUpperCase() + group.slice(1) : 'Tags';
}

/** A tag as shown on its own: "Finish: satin nickel", or the plain tag. */
export function tagLabel(tag: string): string {
  const { name, value } = parseTag(tag);
  return name ? `${groupLabel(name)}: ${value}` : value;
}

const MAX_TAG_PART = 60;

/** A tag tidied the way the server stores it (clean_tag in store.py); null when nothing is left. */
export function cleanTag(text: string): string | null {
  const tidy = (part: string) =>
    part
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .join(' ')
      .replace(/^[\s"'`.,;]+|[\s"'`.,;]+$/g, '')
      .slice(0, MAX_TAG_PART);
  const i = text.indexOf(':');
  if (i >= 0 && tidy(text.slice(0, i)) && tidy(text.slice(i + 1))) {
    return `${tidy(text.slice(0, i))}: ${tidy(text.slice(i + 1))}`;
  }
  return tidy(text.replaceAll(':', ' ')) || null;
}
