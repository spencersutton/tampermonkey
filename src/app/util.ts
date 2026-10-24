import type { RefObject } from 'preact';
import { useSyncExternalStore } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Time left until `endsAt` as a short label ("2d 3h", "1h 05m", "4m 09s"); `soon` is true within the last hour. */
export function timeLabel(endsAt: number, now: number) {
  const ms = endsAt - now;
  if (ms <= 0) {
    return { text: 'Closed', soon: true };
  }
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const soon = ms <= HOUR;
  if (h >= 24) {
    return { text: `${Math.floor(h / 24)}d ${h % 24}h`, soon };
  }
  if (h >= 1) {
    return { text: `${h}h ${pad2(m % 60)}m`, soon };
  }
  return { text: `${m}m ${pad2(s % 60)}s`, soon };
}

/** How long ago `ts` was, e.g. "just now", "12 min ago"; older than a day shows the date. */
export function ago(ts: number, now: number) {
  const m = Math.round((now - ts) / MINUTE);
  if (m < 1) {
    return 'just now';
  }
  if (m < 60) {
    return `${m} min ago`;
  }
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : new Date(ts).toLocaleString();
}

/** Remaining time as "m:ss", or "Ns" under a minute. */
export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${pad2(s % 60)}` : `${s}s`;
}

/** Weekday and time, e.g. "Tue 3:45 PM". */
export const shortTime = (ts: number) => new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

/** "Oct 22": a date in the past. */
export const shortDate = (ts: number) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Format a count with thousands separators. */
export const fmtCount = (n: number) => n.toLocaleString('en-US');

/** A count with its noun, e.g. "1 bid", "1,200 bids". */
export const plural = (n: number, noun: string) => `${fmtCount(n)} ${noun}${n === 1 ? '' : 's'}`;

/** Parse user-typed money/number input ("$1,200") into a number, or null if it isn't one. */
export function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Change listeners for a module-level store, shaped for useSyncExternalStore. */
export function emitter() {
  const listeners = new Set<() => void>();
  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    emit: () => listeners.forEach((fn) => fn()),
  };
}

/** A set of ids (e.g. lots with a request in flight) that components can watch. */
export function observableSet<T>() {
  const items = new Set<T>();
  const { subscribe, emit } = emitter();
  return {
    has: (v: T) => items.has(v),
    add(v: T) {
      items.add(v);
      emit();
    },
    delete(v: T) {
      items.delete(v);
      emit();
    },
    /** Preact hook: whether `v` is in the set, re-rendering when that changes. */
    useHas: (v: T) => useSyncExternalStore(subscribe, () => items.has(v)),
  };
}

/** Shared interval timers for useNow(), one per interval, with the setters subscribed to each. */
const clocks = new Map<number, { listeners: Set<(now: number) => void>; timer: number }>();

function startClock(every: number) {
  const listeners = new Set<(now: number) => void>();
  const clock = { listeners, timer: window.setInterval(() => listeners.forEach((f) => f(Date.now())), every) };
  clocks.set(every, clock);
  return clock;
}

/** Current time, re-rendering every `every` ms (one shared timer per interval). */
export function useNow(every = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const clock = clocks.get(every) ?? startClock(every);
    clock.listeners.add(setNow);
    return () => {
      clock.listeners.delete(setNow);
      if (!clock.listeners.size) {
        clearInterval(clock.timer);
        clocks.delete(every);
      }
    };
  }, [every]);
  return now;
}

/**
 * While a dialog is mounted: focus `ref`, send document keydowns to `onKey`,
 * and give focus back to whatever had it when the dialog closes. With
 * `capture`, keys reach this dialog before any dialog beneath it.
 */
export function useDialog(ref: RefObject<HTMLElement>, onKey: (e: KeyboardEvent) => void, capture = false) {
  const latest = useRef(onKey);
  latest.current = onKey;
  useEffect(() => {
    const listener = (e: KeyboardEvent) => latest.current(e);
    const prevFocus = document.activeElement as HTMLElement | null;
    document.addEventListener('keydown', listener, capture);
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', listener, capture);
      prevFocus?.focus?.();
    };
  }, []);
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
