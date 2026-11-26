// Temporal helpers shared by the app and the server. Durations and in-memory timestamps are
// Temporal values; epoch milliseconds appear only where timer APIs, JSON or storage need them.

/** `d` in milliseconds, for setTimeout, AbortSignal.timeout and other ms-based APIs. */
export const ms = (d: Temporal.Duration): number => d.total('milliseconds');

/** Time elapsed since `at`. */
export const since = (at: Temporal.Instant): Temporal.Duration => Temporal.Now.instant().since(at);

/** Whether `at` was less than `age` ago. */
export const within = (at: Temporal.Instant, age: Temporal.Duration): boolean =>
  Temporal.Duration.compare(since(at), age) < 0;

/** A promise that resolves after `d`. */
export const sleep = (d: Temporal.Duration): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms(d)));
