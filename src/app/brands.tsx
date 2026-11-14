import { batch, effect, signal } from '@preact/signals';

import { loadDetail, lotBrands, lotModels, lots } from './catalog';
import { Icon } from './icons';
import {
  filteredOnly,
  highlight,
  onScreen,
  openId,
  setView,
  sidebarOpen,
  storedView,
} from './state';
import { openHandler } from './util';
import { DEFAULT_VIEW } from './view';

const errors = signal(new Map<number, string>());
const CONCURRENCY = 2;

/** Reuse the shared detail cache, fetching only for cards near the viewport. */
export function startBrandWatch() {
  const pending = new Set<number>();
  let active = true;

  function pump() {
    if (!active) {
      return;
    }
    for (const id of onScreen.peek()) {
      if (pending.size >= CONCURRENCY) {
        break;
      }
      const lot = lots.peek().get(id);
      if (
        !lot ||
        pending.has(id) ||
        (lotBrands.peek().has(id) && lotModels.peek().has(id)) ||
        errors.peek().has(id)
      ) {
        continue;
      }
      pending.add(id);
      void loadDetail(lot)
        .catch((err: unknown) => {
          errors.value = new Map(errors.peek()).set(
            id,
            err instanceof Error ? err.message : String(err),
          );
        })
        .finally(() => {
          pending.delete(id);
          pump();
        });
    }
  }

  const dispose = effect(() => {
    void onScreen.value;
    void lots.value;
    void lotBrands.value;
    void lotModels.value;
    void errors.value;
    pump();
  });
  return () => {
    active = false;
    dispose();
  };
}

export function CardBrandModel({ id }: { id: number }) {
  const brand = lotBrands.value.get(id);
  const model = lotModels.value.get(id);
  const error = errors.value.get(id);
  const failed = error && (!lotBrands.value.has(id) || !lotModels.value.has(id));
  if (!brand && !model && !failed) {
    return null;
  }
  return (
    <div class="card-identity">
      <BrandModel brand={brand ?? null} model={model ?? null} />
      {failed && (
        <button
          type="button"
          class="btn-text"
          title={error}
          onClick={() => {
            const next = new Map(errors.peek());
            next.delete(id);
            errors.value = next;
          }}
        >
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
  const term = (field: string, value: string) => `${field}:"${value.replace(/["\\]/g, '\\$&')}"`;
  const brandQuery = brand ? term('brand', brand) : '';
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
  const query = [brand, model].filter(Boolean).join(' ');
  const googleLink = (
    <a
      href={`https://www.google.com/search?q=${encodeURIComponent(query)}`}
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
            {catalogLink(brand, brandQuery)} {!model && googleLink}
          </dd>
        </div>
      )}
      {model && (
        <div>
          <dt>Model</dt>
          <dd>
            {catalogLink(model, [brandQuery, term('model', model)].filter(Boolean).join(' '))}{' '}
            {googleLink}
          </dd>
        </div>
      )}
    </dl>
  );
}
