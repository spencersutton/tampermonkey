import { collator } from './sortKey';

// Adds toSet() to Array and Iterator (every builtin with toArray), toArray() to Set, toUnique() (deduplicated array) sum(), sumBy() and sortBy() (sorted copy by key) to Array and Iterator; imported for its side effect by each entry point.
declare global {
  interface Array<T> {
    toSet(): Set<T>;
    toUnique(): T[];
    sum(this: readonly number[]): number;
    sumBy(fn: (value: T, index: number) => number): number;
    sortBy<U>(key: (value: T) => U, compareFn?: (a: U, b: U) => number): T[];
  }
  interface ReadonlyArray<T> {
    toSet(): Set<T>;
    toUnique(): T[];
    sum(this: readonly number[]): number;
    sumBy(fn: (value: T, index: number) => number): number;
    sortBy<U>(key: (value: T) => U, compareFn?: (a: U, b: U) => number): T[];
  }
  interface Set<T> {
    toArray(): T[];
  }
  interface ReadonlySet<T> {
    toArray(): T[];
  }
  interface IteratorObject<T, TReturn, TNext> {
    toSet(): Set<T>;
    toUnique(): T[];
    sum(this: IteratorObject<number>): number;
    sumBy(fn: (value: T, index: number) => number): number;
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

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Set.prototype, 'toArray', {
  value: function toArray<T>(this: ReadonlySet<T>): T[] {
    return [...this];
  },
  configurable: true,
  writable: true,
});

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Array.prototype, 'toUnique', {
  value: function toUnique<T>(this: readonly T[]): T[] {
    return [...new Set(this)];
  },
  configurable: true,
  writable: true,
});

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Iterator.prototype, 'toUnique', {
  value: function toUnique<T>(this: Iterator<T>): T[] {
    return [...new Set({ [Symbol.iterator]: () => this })];
  },
  configurable: true,
  writable: true,
});

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Array.prototype, 'sum', {
  value: function sum(this: readonly number[]): number {
    return this.reduce((n, x) => n + x, 0);
  },
  configurable: true,
  writable: true,
});

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Iterator.prototype, 'sum', {
  value: function sum(this: IteratorObject<number>): number {
    return this.reduce((n, x) => n + x, 0);
  },
  configurable: true,
  writable: true,
});

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Array.prototype, 'sumBy', {
  value: function sumBy<T>(this: readonly T[], fn: (value: T, index: number) => number): number {
    return this.reduce((n, x, i) => n + fn(x, i), 0);
  },
  configurable: true,
  writable: true,
});

// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Iterator.prototype, 'sumBy', {
  value: function sumBy<T>(
    this: IteratorObject<T>,
    fn: (value: T, index: number) => number,
  ): number {
    return this.reduce((n, x, i) => n + fn(x, i), 0);
  },
  configurable: true,
  writable: true,
});

const compareKeys = (a: unknown, b: unknown): number => collator.compare(String(a), String(b));

// An ascending sorted copy, ordered by a key: numbers/bigints numerically, anything else via the
// collator, unless a comparator on the keys is given. Chain .reverse() for descending.
// oxlint-disable-next-line no-extend-native -- deliberate
Object.defineProperty(Array.prototype, 'sortBy', {
  value: function sortBy<T, U>(
    this: readonly T[],
    key: (value: T) => U,
    compareFn: (a: U, b: U) => number = compareKeys,
  ): T[] {
    return this.toSorted((a, b) => compareFn(key(a), key(b)));
  },
  configurable: true,
  writable: true,
});

export const arrayToSetInstalled = true;
