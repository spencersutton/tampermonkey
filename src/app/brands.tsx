import { effect, signal } from '@preact/signals';
import { loadDetail, lotBrands, lots } from './catalog';
import { onScreen } from './state';

const errors = signal(new Map<number, string>());
const CONCURRENCY = 2;

/** Reuse the shared detail cache, fetching only for cards near the viewport. */
export function startBrandWatch() {
  const pending = new Set<number>();
  let active = true;

  function pump() {
    if (!active) return;
    for (const id of onScreen.peek()) {
      if (pending.size >= CONCURRENCY) break;
      const lot = lots.peek().get(id);
      if (!lot || pending.has(id) || lotBrands.peek().has(id) || errors.peek().has(id)) continue;
      pending.add(id);
      void loadDetail(lot).catch((err: unknown) => {
        errors.value = new Map(errors.peek()).set(id, err instanceof Error ? err.message : String(err));
      }).finally(() => {
        pending.delete(id);
        pump();
      });
    }
  }

  const dispose = effect(() => {
    void onScreen.value;
    void lots.value;
    void lotBrands.value;
    void errors.value;
    pump();
  });
  return () => {
    active = false;
    dispose();
  };
}

export function CardBrand({ id }: { id: number }) {
  const brand = lotBrands.value.get(id);
  const error = errors.value.get(id);
  if (brand) {
    return <div class="card-meta"><span>Brand: {brand}</span></div>;
  }
  if (error && !lotBrands.value.has(id)) {
    return (
      <div class="card-meta">
        <button type="button" class="btn-text" title={error} onClick={() => {
          const next = new Map(errors.peek());
          next.delete(id);
          errors.value = next;
        }}>
          Brand unavailable - Retry
        </button>
      </div>
    );
  }
  return null;
}
