// Temporal helpers shared by the app and the server. Durations and in-memory timestamps are
// Temporal values; epoch milliseconds appear only where timer APIs, JSON or storage need them.

/** `d` in milliseconds, for setTimeout, AbortSignal.timeout and other ms-based APIs. */
export const ms = (d: Duration): number => d.total('milliseconds');

/** Time elapsed since `at`. */
export const since = (at: Instant): Duration => Temporal.Now.instant().since(at);

/** Whether `at` was less than `age` ago. */
export const within = (at: Instant, age: Duration): boolean => Duration.compare(since(at), age) < 0;

/** A promise that resolves after `d`. */
export const sleep = (d: Duration): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms(d)));
