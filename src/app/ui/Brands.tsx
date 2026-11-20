import { batch } from '@preact/signals';

import { brandSearchQuery, googleSearchUrl, modelSearchQuery } from '../logic/brands';
import { DEFAULT_VIEW } from '../logic/view';
import { brandErrors, retryBrandDetail } from '../server/brands';
import { lotBrands, lotModels } from '../server/catalog';
import { openHandler } from './dom';
import { Icon } from './icons';
import { filteredOnly, highlight, openId, setView, sidebarOpen, storedView } from './state';

export function CardBrandModel({ id }: { id: number }) {
  const brand = lotBrands.value.get(id);
  const model = lotModels.value.get(id);
  const error = brandErrors.value.get(id);
  const failed = error && (!lotBrands.value.has(id) || !lotModels.value.has(id));
  if (!brand && !model && !failed) {
    return null;
  }
  return (
    <div class="card-identity">
      <BrandModel brand={brand ?? null} model={model ?? null} />
      {failed && (
        <button type="button" class="btn-text" title={error} onClick={() => retryBrandDetail(id)}>
          Item details unavailable - Retry
        </button>
      )}
    </div>
  );
}

/** Search the catalog by brand/model, with a separate link to Google. */
export function BrandModel({ brand, model }: { brand: string | null; model: string | null }) {
  if (!brand && !model) {
    return null;
  }
  const sort = storedView.value.sort;
  const catalogLink = (text: string, search: string) => (
    <a
      href={`?${new URLSearchParams({ search, sort })}`}
      title={`Search catalog for ${search}`}
      onClick={openHandler(() => {
        batch(() => {
          setView({ ...DEFAULT_VIEW, sort, search });
          openId.value = null;
          filteredOnly.value = false;
          highlight.value = null;
          sidebarOpen.value = false;
        });
        window.scrollTo(0, 0);
      })}
    >
      {text}
    </a>
  );
  const { query, href } = googleSearchUrl(brand, model);
  const googleLink = (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      title={`Search Google for “${query}”`}
      aria-label={`Search Google for “${query}”`}
    >
      <Icon name="google" size={14} />
    </a>
  );
  return (
    <dl class="brand-model">
      {brand && (
        <div>
          <dt>Brand</dt>
          <dd>
            {catalogLink(brand, brandSearchQuery(brand))} {!model && googleLink}
          </dd>
        </div>
      )}
      {model && (
        <div>
          <dt>Model</dt>
          <dd>
            {catalogLink(model, modelSearchQuery(brand, model))} {googleLink}
          </dd>
        </div>
      )}
    </dl>
  );
}
