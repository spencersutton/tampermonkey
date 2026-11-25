import { parseQuery, stem, type Field } from '../../shared/search';
import { memoLast } from './util';

function compileHighlight(
  search: string,
  matchField: (field: Field | null) => boolean,
): RegExp | null {
  const words = parseQuery(search)
    .filter(t => !t.negate && matchField(t.field) && t.value)
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
}

/** A regex matching the plain words and phrases of a search, or null when there are none. */
export const termsRegex = memoLast((search: string): RegExp | null =>
  compileHighlight(search, field => field === null),
);

const descWithPlainRegex = memoLast((search: string): RegExp | null =>
  compileHighlight(search, field => field === null || field === 'desc'),
);
const descOnlyRegex = memoLast((search: string): RegExp | null =>
  compileHighlight(search, field => field === 'desc'),
);

/** A regex matching search terms that apply to a lot's description. */
export const descriptionTermsRegex = (search: string, includePlain: boolean): RegExp | null =>
  includePlain ? descWithPlainRegex(search) : descOnlyRegex(search);
