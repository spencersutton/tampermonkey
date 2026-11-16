import { tagGroup, tagKey, tagLabel } from '../shared/tags';
import { setView, storedView } from './state';
import type { Lot } from './types';

/**
 * A lot's tags on its card; clicking one filters by it (replacing another value of the same
 * attribute).
 */
export function CardTags({ lot }: { lot: Lot }) {
  if (!lot.tags?.length) return null;
  return (
    <ul class="card-tags" aria-label="Tags">
      {lot.tags.map((tag) => (
        <li key={tag}>
          <button
            type="button"
            class="card-tag"
            title={`Show only ${tagLabel(tag)}`}
            onClick={() => {
              const group = tagGroup(tag);
              const rest = storedView.peek().tags.filter((t) => tagGroup(t) !== group);
              setView({ tags: [...rest, tagKey(tag)] });
            }}
          >
            {tagLabel(tag)}
          </button>
        </li>
      ))}
    </ul>
  );
}
