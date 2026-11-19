// Tag rules: tags given to every lot whose title matches a regular expression
// (case-insensitive, anywhere in the title). A tag can use what the pattern
// captured: $1 for the first group, ${name} for (?<name>...), $0 for the whole
// match, $$ for a dollar sign. Patterns are JavaScript regular expressions;
// Python's (?P<name>...) and (?P=name), which rules saved by the old Python
// server may use, are read as their JavaScript equivalents.
import { cleanTag, tagKey } from '../shared/tags';

const MAX_TAG_PATTERN = 300;
const MAX_RULE_TAGS = 20;

export interface TagRule {
  id: number;
  pattern: string;
  tags: string[];
}

/** A rule's pattern is blank, too long or not a valid regular expression. */
export class PatternError extends Error {}
/** A rule's tag refers to a group its pattern doesn't have. */
export class TagTemplateError extends Error {}
/** A rule that can't be saved for another reason (no tags, too many). */
export class RuleError extends Error {}

/** Python's repr of a string, which the error messages quote as. */
const repr = (s: string) => `'${s.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;

/** Tags without repeats (ignoring case), each kept as first written, in their original order. */
export function uniqueTags(tags: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const tag of tags) {
    if (!seen.has(tagKey(tag))) {
      seen.set(tagKey(tag), tag);
    }
  }
  return [...seen.values()];
}

/** Tidied tags without blanks or repeats (ignoring case), in their original order. */
export function cleanTags(tags: Iterable<string>): string[] {
  return uniqueTags([...tags].map(cleanTag).filter((t): t is string => Boolean(t)));
}

/** The compiled rule pattern; throws PatternError for a blank or invalid one. */
export function compileTagPattern(pattern: string): RegExp {
  if (!pattern.trim()) {
    throw new PatternError('empty pattern');
  }
  if (pattern.length > MAX_TAG_PATTERN) {
    throw new PatternError(`pattern is over ${MAX_TAG_PATTERN} characters`);
  }
  const source = pattern.replaceAll('(?P<', '(?<').replace(/\(\?P=(\w+)\)/g, '\\k<$1>');
  try {
    return new RegExp(source, 'i');
  } catch (e) {
    const message =
      e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : String(e);
    throw new PatternError(`invalid pattern ${repr(pattern)}: ${message}`);
  }
}

const TAG_REF = /\$(?:(\$)|(\d+)|\{(\w+)\})/g;

/** A group reference in a tag: a number, or a group name as the pattern spells it. */
type Ref = number | string;

/**
 * A rule ready to apply: its pattern compiled and each tag's group references checked (tags are
 * stored tidied, so group names are looked up ignoring case, which they may not keep).
 */
export class CompiledRule {
  readonly rx: RegExp;
  // Each tag as literal parts and the groups between them: parts[0] g[0] parts[1] g[1] ... parts[-1].
  private readonly templates: { parts: string[]; refs: Ref[] }[] = [];

  constructor(pattern: string, tags: Iterable<string>) {
    this.rx = compileTagPattern(pattern);
    // Matching the empty alternative reports every group (all unset) without matching anything else.
    const probe = new RegExp(`(?:${this.rx.source})|`, 'i').exec('');
    const groups = (probe?.length ?? 1) - 1;
    const names = new Map(Object.keys(probe?.groups ?? {}).map(n => [n.toLowerCase(), n]));
    for (const tag of tags) {
      const parts: string[] = [];
      const refs: Ref[] = [];
      let at = 0;
      for (const ref of tag.matchAll(TAG_REF)) {
        const [, dollar, digits, label]: (string | undefined)[] = ref;
        if (dollar) {
          continue; // $$: a literal dollar sign, kept in the literal text
        }
        let group: Ref;
        if (digits !== undefined) {
          group = Number(digits);
          if (group > groups) {
            const have = groups ? `only ${groups} group${groups === 1 ? '' : 's'}` : 'no groups';
            throw new TagTemplateError(`${repr(tag)} uses $${group}, but the pattern has ${have}`);
          }
        } else {
          const name = names.get((label ?? '').toLowerCase());
          if (name === undefined) {
            throw new TagTemplateError(
              `${repr(tag)} uses \${${label}}, but the pattern has no group named ${repr(label ?? '')}`,
            );
          }
          group = name;
        }
        parts.push(tag.slice(at, ref.index));
        refs.push(group);
        at = ref.index + ref[0].length;
      }
      parts.push(tag.slice(at));
      this.templates.push({ parts: parts.map(p => p.replaceAll('$$', '$')), refs });
    }
  }

  /**
   * The tags this rule gives a title, or null when the pattern doesn't match it. A tag whose groups
   * captured nothing is left out.
   */
  tagsFor(title: string): string[] | null {
    const m = this.rx.exec(title);
    if (!m) {
      return null;
    }
    const out: string[] = [];
    for (const { parts, refs } of this.templates) {
      const values = refs.map(r => (typeof r === 'number' ? m[r] : m.groups?.[r]));
      if (!values.every(Boolean)) {
        continue;
      }
      const text = parts[0] + values.map((v, i) => `${v}${parts[i + 1]}`).join('');
      const tag = cleanTag(text);
      if (tag) {
        out.push(tag);
      }
    }
    return out;
  }
}

/**
 * A rule's tags tidied, after checking the rule; throws for a bad pattern, a reference to a missing
 * group, or no (or too many) tags.
 */
export function ruleTags(pattern: string, tags: Iterable<string>): string[] {
  const cleaned = cleanTags(tags);
  void new CompiledRule(pattern, cleaned); // throws for a bad pattern or group reference
  if (!cleaned.length) {
    throw new RuleError('no tags given');
  }
  if (cleaned.length > MAX_RULE_TAGS) {
    throw new RuleError(`at most ${MAX_RULE_TAGS} tags per rule`);
  }
  return cleaned;
}
