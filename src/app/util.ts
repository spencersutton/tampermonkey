import { signal, type Signal } from '@preact/signals';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Weekday and time, e.g. "Tue 3:45 PM". */
export const shortTime = (ts: Temporal.Instant) => new Date(ts.epochMilliseconds).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** "Oct 22": a date in the past. */
export const shortDate = (ts: Temporal.Instant) => new Date(ts.epochMilliseconds).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Format a count with thousands separators. */
export const fmtCount = (n: number) => n.toLocaleString('en-US');

/** A count with its noun, e.g. "1 bid", "1,200 bids". */
export const plural = (n: number, noun: string) => `${fmtCount(n)} ${noun}${n === 1 ? '' : 's'}`;

/** Parse user-typed money/number input ("$1,200") into a number, or null if it isn't one. */
export function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** A set of ids (e.g. lots with a request in flight); reading it in a component re-renders that component when it changes. */
export function observableSet<T>() {
  const items = signal<ReadonlySet<T>>(new Set());
  return {
    has: (v: T) => items.value.has(v),
    add: (v: T) => void (items.value = new Set(items.value).add(v)),
    delete(v: T) {
      const next = new Set(items.value);
      next.delete(v);
      items.value = next;
    },
  };
}

/** One clock signal per interval; its timer runs only while something reads it. */
const clocks = new Map<number, Signal<Temporal.Instant>>();

/** Current time, updated every `every` ms; read in a component or computed, it re-runs them on each tick. */
export function clock(every = 1000): Temporal.Instant {
  let s = clocks.get(every);
  if (!s) {
    let timer = 0;
    s = signal(Temporal.Now.instant(), {
      watched() {
        this.value = Temporal.Now.instant();
        timer = window.setInterval(() => (this.value = Temporal.Now.instant()), every);
      },
      unwatched: () => clearInterval(timer),
    });
    clocks.set(every, s);
  }
  return s.value;
}

/** Click handler for a link: a plain click runs `open` in-app; modified/middle clicks follow the real link. */
export function openHandler(open: () => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    open();
  };
}

export function memoize<T, R>(f: (arg1: T) => R): (arg1: T) => R {
  const cache = new Map<T, R>();

  return function (arg1: T) {
    if (cache.has(arg1)) {
      return cache.get(arg1)!;
    }

    const result = f(arg1);
    cache.set(arg1, result);
    return result;
  }
}