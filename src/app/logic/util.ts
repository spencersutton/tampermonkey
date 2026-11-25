const duration = new Intl.DurationFormat([], { style: 'narrow' });

/**
 * Time left until `endsAt` as a short label ("2d 3h", "1h 5m", "4m 9s"); `soon` is true within the
 * last hour.
 */
export function timeLabel(endsAt: number, now: number) {
  const left = Temporal.Duration.from({ milliseconds: endsAt - now }).round({ largestUnit: 'day' });
  if (left.sign <= 0) {
    return { text: 'Closed', soon: true };
  }
  let smallestUnit: Temporal.TimeUnit = 'second';
  if (left.days > 0) {
    smallestUnit = 'hour';
  } else if (left.hours > 0) {
    smallestUnit = 'minute';
  }
  const rounded = left.round({ smallestUnit, roundingMode: 'trunc' });
  return {
    text: duration.format(rounded),
    soon: Temporal.Duration.compare(left, { hours: 1 }) <= 0,
  };
}

const relative = new Intl.RelativeTimeFormat([], { numeric: 'auto' });

/**
 * How long ago `ts` was, in its largest whole unit: "now", "12 minutes ago", "5 hours ago",
 * "yesterday".
 */
export function ago(ts: number, now: number) {
  const elapsed = Temporal.Duration.from({ milliseconds: now - ts }).round({ largestUnit: 'day' });
  if (elapsed.days > 0) {
    return relative.format(-elapsed.days, 'day');
  }
  if (elapsed.hours > 0) {
    return relative.format(-elapsed.hours, 'hour');
  }
  if (elapsed.minutes > 0) {
    return relative.format(-elapsed.minutes, 'minute');
  }
  return relative.format(0, 'second');
}

/** Remaining time as "m:ss", or "Ns" under a minute. */
export function countdown(ms: number) {
  const left = Temporal.Duration.from({ milliseconds: Math.max(0, ms) }).round({
    largestUnit: 'minute',
    smallestUnit: 'second',
    roundingMode: 'ceil',
  });
  if (left.minutes === 0) {
    return `${left.seconds}s`;
  }
  return `${left.minutes}:${String(left.seconds).padStart(2, '0')}`;
}

/** Message from an Error, or the thrown value as text. */
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Parse user-typed money/number input ("$1,200") into a number, or null if it isn't one. */
export function parseNum(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
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

export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message ?? 'Assertion failed');
  }
}
