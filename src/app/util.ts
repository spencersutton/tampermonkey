import { signal, type Signal } from '@preact/signals';

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
const clocks = new Map<number, Signal<number>>();

/** Current time, updated every `every` ms; read in a component or computed, it re-runs them on each tick. */
export function clock(every = 1000): number {
  let s = clocks.get(every);
  if (!s) {
    let timer = 0;
    s = signal(Date.now(), {
      watched() {
        this.value = Date.now();
        timer = window.setInterval(() => (this.value = Date.now()), every);
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
