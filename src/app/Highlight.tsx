import { parseQuery, stem } from '../shared/search';
import { effectiveSearch } from './state';
import { memoLast } from './util';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A regex matching the plain words and phrases of a search, or null when there are none. */
const termsRegex = memoLast((search: string): RegExp | null => {
  const words = parseQuery(search)
    .filter(t => !t.negate && !t.field && t.value)
    .flatMap(t => (t.phrase ? [t.value] : [t.value, stem(t.value)]));
  if (!words.length) {
    return null;
  }
  const alternatives = new Set(words)
    .values()
    .toArray()
    .toSorted((a, b) => b.length - a.length)
    .map(escape);
  return new RegExp(`(${alternatives.join('|')})`, 'gi');
});

/** `text` with the current search's words marked. */
export function Highlight({ text }: { text: string }) {
  const re = termsRegex(effectiveSearch.value);
  if (!re) {
    return <>{text}</>;
  }
  // split() with a capturing group puts the matches at odd indexes.
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark>{part}</mark> : part))}</>;
}
