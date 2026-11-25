import { descriptionTermsRegex, termsRegex } from '../logic/highlight';
import { effectiveSearch, storedView } from './state';

/** `text` with the current search's words marked. */
export function Highlight({ text, description }: { text: string; description?: boolean }) {
  const re = description
    ? descriptionTermsRegex(effectiveSearch.value, storedView.value.searchDescriptions)
    : termsRegex(effectiveSearch.value);
  if (!re) {
    return <>{text}</>;
  }
  // split() with a capturing group puts the matches at odd indexes.
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark>{part}</mark> : part))}</>;
}
