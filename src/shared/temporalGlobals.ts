// Temporal.Duration and Temporal.Instant as the globals Duration and Instant (typed in
// global.d.ts). Installed by entry points once Temporal itself is available, like arrayToSet.
Object.assign(globalThis, { Duration: Temporal.Duration, Instant: Temporal.Instant });
