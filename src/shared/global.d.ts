type Nullable<T> = T | null | undefined;

// The lot shape app and server share (defined in ./lot), used nearly everywhere without an import.
type Lot = import('./lot').Lot;

// Temporal's Duration and Instant without the namespace (installed by ./temporalGlobals).
declare const Duration: typeof Temporal.Duration;
type Duration = Temporal.Duration;

declare const Instant: typeof Temporal.Instant;
type Instant = Temporal.Instant;
