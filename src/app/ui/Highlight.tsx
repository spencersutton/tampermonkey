import { termsRegex } from '../logic/highlight';
import { effectiveSearch } from './state';

/** `text` with the current search's words marked. */
export function Highlight({ text }: { text: string }) {
  const re = termsRegex(effectiveSearch.value);
  if (!re) {
    return <>{text}</>;
  }
  // split() with a capturing group puts the matches at odd indexes.
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark>{part}</mark> : part))}</>;
}
