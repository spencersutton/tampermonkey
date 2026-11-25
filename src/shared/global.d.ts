type Nullable<T> = T | null | undefined;
// The lot shape app and server share (defined in ./lot), used nearly everywhere without an import.
type Lot = import('./lot').Lot;
