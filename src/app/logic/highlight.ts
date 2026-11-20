import { parseQuery, stem } from '../../shared/search';
import { memoLast } from './util';
import '../../shared/arrayToSet';

/** A regex matching the plain words and phrases of a search, or null when there are none. */
export const termsRegex = memoLast((search: string): RegExp | null => {
  const words = parseQuery(search)
    .filter(t => !t.negate && !t.field && t.value)
    .flatMap(t => (t.phrase ? [t.value] : [t.value, stem(t.value)]));
  if (!words.length) {
    return null;
  }
  const alternatives = words
    .toUnique()
    .sortBy(w => w.length)
    .toReversed()
    .map(w => RegExp.escape(w));
  return new RegExp(`(${alternatives.join('|')})`, 'gi');
});
