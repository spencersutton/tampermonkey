import { DAY, HOUR, MINUTE } from '../../shared/constants';
import * as format from '../../shared/format';

const duration = new Intl.DurationFormat([], { style: 'narrow' });

/**
 * Time left until `endsAt` as a short label ("2d 3h", "1h 5m", "4m 9s"); `soon` is true within the
 * last hour.
 */
export function timeLabel(endsAt: number, now: number) {
  const ms = endsAt - now;
  if (ms <= 0) {
    return { text: 'Closed', soon: true };
  }
  let smallestUnit: Temporal.TimeUnit = 'second';
  if (ms >= DAY) {
    smallestUnit = 'hour';
  } else if (ms >= HOUR) {
    smallestUnit = 'minute';
  }
  const left = Temporal.Duration.from({ milliseconds: ms }).round({
    largestUnit: 'day',
    smallestUnit,
    roundingMode: 'trunc',
  });
  return { text: duration.format(left), soon: ms <= HOUR };
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
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/** A count with its noun, e.g. "1 bid", "1,200 bids". */
export const plural = (n: number, noun: string) => `${format.num(n)} ${noun}${n === 1 ? '' : 's'}`;

/** Message from an Error, or the thrown value as text. */
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  const isZero = integer === '0' && decimal === '';
  const sign = value.startsWith('-') && !isZero ? '-' : '';
  return decimal ? `${sign}${integer}.${decimal}` : `${sign}${integer}`;
}

/**
 * `items` sorted by value, smallest first, when every one's text is a plain number ("8", "1.5",
 * "-.25"); null when any isn't (or there are none). Equal numbers keep their order.
 */
export function numericOrder<T>(items: T[], text: (item: T) => string): T[] | null {
  if (items.length === 0) {
    return null;
  }
  const entries: { item: T; value: number }[] = [];
  for (const item of items) {
    const raw = text(item).trim();
    if (!PLAIN_NUMBER.test(raw)) {
      return null;
    }
    entries.push({ item, value: Number(raw) });
  }
  return entries.toSorted((a, b) => a.value - b.value).map(e => e.item);
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
  return arg => {
    if (last && last.arg === arg) {
      return last.result;
    }
    const result = fn(arg);
    last = { arg, result };
    return result;
  };
}
