import { effect, signal, type ReadonlySignal } from '@preact/signals';

import { errorMessage } from '../logic/util';
import { loadDetail, lotBrands, lotModels, lots } from './catalog';

export const brandErrors = signal(new Map<number, string>());
const CONCURRENCY = 2;

export function retryBrandDetail(id: number) {
  const next = new Map(brandErrors.peek());
  next.delete(id);
  brandErrors.value = next;
}

/** Reuse the shared detail cache, fetching only for cards near the viewport. */
export function startBrandWatch(onScreen: ReadonlySignal<number[]>) {
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
        brandErrors.peek().has(id)
      ) {
        continue;
      }
      pending.add(id);
      void loadDetail(lot)
        .catch((err: unknown) => {
          brandErrors.value = new Map(brandErrors.peek()).set(id, errorMessage(err));
        })
        .finally(() => {
          pending.delete(id);
          pump();
        });
    }
  }

  const dispose = effect(() => {
    // Subscribe explicitly: pump() uses .peek() so early breaks and async .finally() calls
    // don't drop or accidentally create signal dependencies.
    void onScreen.value;
    void lots.value;
    void brandErrors.value;
    pump();
  });
  return () => {
    active = false;
    dispose();
  };
}
