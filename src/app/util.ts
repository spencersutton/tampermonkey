import { signal, type Signal } from '@preact/signals';

import { DAY, HOUR, MINUTE } from '../shared/constants';
import * as format from '../shared/format';

/** Weekday and time, e.g. "Tue 3:45 PM". */
export const shortTime = format.shortTime;

/** "Oct 22": a date in the past. */
export const shortDate = format.shortDate;

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Time left until `endsAt` as a short label ("2d 3h", "1h 05m", "4m 09s"); `soon` is true within
 * the last hour.
 */
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

const relative = new Intl.RelativeTimeFormat([], { numeric: 'auto' });

/**
 * How long ago `ts` was, in its largest whole unit: "now", "12 minutes ago", "5 hours ago",
 * "yesterday".
 */
export function ago(ts: number, now: number) {
  const ms = now - ts;
  if (ms < MINUTE) {
    return relative.format(0, 'second');
  }
  if (ms < HOUR) {
    return relative.format(-Math.floor(ms / MINUTE), 'minute');
  }
  if (ms < DAY) {
    return relative.format(-Math.floor(ms / HOUR), 'hour');
  }
  return relative.format(-Math.floor(ms / DAY), 'day');
}

/** Remaining time as "m:ss", or "Ns" under a minute. */
export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${pad2(s % 60)}` : `${s}s`;
}

/** A count with its noun, e.g. "1 bid", "1,200 bids". */
export const plural = (n: number, noun: string) => `${format.num(n)} ${noun}${n === 1 ? '' : 's'}`;

/** Parse user-typed money/number input ("$1,200") into a number, or null if it isn't one. */
export function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const PLAIN_NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Canonical plain decimal text, without rounding large numbers or precise fractions. */
export function numericLabel(text: string): string | null {
  const value = text.trim();
  if (!PLAIN_NUMBER.test(value)) {
    return null;
  }
  const [whole = '', fraction = ''] = value.replace(/^[-+]/, '').split('.');
  const integer = whole.replace(/^0+/, '') || '0';
  const decimal = fraction.replace(/0+$/, '');
  const sign = value.startsWith('-') && (integer !== '0' || decimal) ? '-' : '';
  return `${sign}${integer}${decimal ? `.${decimal}` : ''}`;
}

/**
 * `items` sorted by value, smallest first, when every one's text is a plain number ("8", "1.5",
 * "-.25"); null when any isn't (or there are none). Equal numbers keep their order.
 */
export function numericOrder<T>(items: T[], text: (item: T) => string): T[] | null {
  const nums = items.map(item => text(item).trim());
  if (!nums.length || !nums.every(n => PLAIN_NUMBER.test(n))) {
    return null;
  }
  return items
    .map((item, i) => ({ item, n: Number(nums[i]) }))
    .toSorted((a, b) => a.n - b.n)
    .map(x => x.item);
}

/**
 * A set of ids (e.g. lots with a request in flight); reading it in a component re-renders that
 * component when it changes.
 */
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

/**
 * Current time, updated every `every` ms; read in a component or computed, it re-runs them on each
 * tick.
 */
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

/**
 * Click handler for a link: a plain click runs `open` in-app; modified/middle clicks follow the
 * real link.
 */
export function openHandler(open: () => void) {
  return (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    open();
  };
}

/**
 * `fn`, cached per argument object; an entry goes when nothing else holds its key (e.g. a lot
 * object replaced by a live update).
 */
export function memoizeWeak<T extends object, R>(fn: (arg: T) => R): (arg: T) => R {
  const cache = new WeakMap<T, R>();
  return arg => cache.getOrInsertComputed(arg, fn);
}

/** `fn`, cached per argument forever: only for keys from a small or short-lived set. */
export function memoize<T, R>(fn: (arg: T) => R): (arg: T) => R {
  const cache = new Map<T, R>();
  return arg => cache.getOrInsertComputed(arg, fn);
}

/**
 * `fn`, recomputed only when its argument changes (by identity), e.g. to compile a settings list
 * once.
 */
export function memoLast<A, R>(fn: (arg: A) => R): (arg: A) => R {
  let last: { arg: A; result: R } | null = null;
  return function (arg) {
    if (last?.arg === arg) {
      return last.result;
    } else {
      last = { arg, result: fn(arg) };
      return last.result;
    }
  };
}
