// Adds toSet() to Array and Iterator (every builtin with toArray); imported for its side effect by each entry point.
declare global {
  interface Array<T> {
    toSet(): Set<T>;
  }
  interface ReadonlyArray<T> {
    toSet(): Set<T>;
  }
  interface IteratorObject<T, TReturn, TNext> {
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

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Iterator.prototype, 'toSet', {
  value: function toSet<T>(this: Iterator<T>): Set<T> {
    return new Set({ [Symbol.iterator]: () => this });
  },
  configurable: true,
  writable: true,
});

export const arrayToSetInstalled = true;
