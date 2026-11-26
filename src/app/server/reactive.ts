import { signal, type Signal } from '@preact/signals';

import { ms } from '../../shared/time';

/**
 * A set of ids (e.g. lots with a request in flight); reading it in a component re-renders that
 * component when it changes.
 */
export function observableSet<T>() {
  const items = signal<ReadonlySet<T>>(new Set());
  return {
    has: (v: T) => items.value.has(v),
    add(v: T) {
      const next = new Set(items.value);
      next.add(v);
      items.value = next;
    },
    delete(v: T) {
      const next = new Set(items.value);
      next.delete(v);
      items.value = next;
    },
  };
}

/** One clock signal per interval (in ms); its timer runs only while something reads it. */
const clocks = new Map<number, Signal<number>>();

function createClock(every: number): Signal<number> {
  let timer: ReturnType<typeof setInterval> | undefined;
  return signal(Date.now(), {
    watched() {
      this.value = Date.now();
      timer = setInterval(() => {
        this.value = Date.now();
      }, every);
    },
    unwatched() {
      clearInterval(timer);
    },
  });
}

/**
 * Current time in epoch ms, updated every `every`; read in a component or computed, it re-runs them
 * on each tick.
 */
export function clock(every: Temporal.DurationLike = { seconds: 1 }): number {
  return clocks.getOrInsertComputed(ms(Temporal.Duration.from(every)), createClock).value;
}
