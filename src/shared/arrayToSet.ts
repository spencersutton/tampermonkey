// Adds Array.prototype.toSet(); imported for its side effect by each entry point.
declare global {
  interface Array<T> {
    toSet(): Set<T>;
  }
  interface ReadonlyArray<T> {
    toSet(): Set<T>;
  }
}

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Array.prototype, 'toSet', {
  value: function toSet<T>(this: readonly T[]): Set<T> {
    return new Set(this);
  },
  configurable: true,
  writable: true,
});

export const arrayToSetInstalled = true;
