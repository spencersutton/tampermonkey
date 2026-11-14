// Reactive access to settings. Shared settings live only on the server;
// browser-only UI settings use localStorage.
import { signal, type Signal } from '@preact/signals';

import { DEFAULTS, SERVER_KEYS } from '../shared/keys';

export type Key = keyof typeof DEFAULTS;
type Value<K extends Key> = (typeof DEFAULTS)[K];

const PREFIX = 'tlx:';
const serverKeys = new Set<Key>(SERVER_KEYS);

function load(key: Key): unknown {
  if (serverKeys.has(key)) {
    return DEFAULTS[key];
  }
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) {
      return DEFAULTS[key];
    }
    return JSON.parse(raw);
  } catch {
    return DEFAULTS[key]; // storage blocked (private mode) or a corrupt value
  }
}

function store(key: Key, value: unknown) {
  if (serverKeys.has(key)) {
    return;
  }
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the value still lives in memory for this tab
  }
}

/** Server settings are held in memory; browser settings load from localStorage. */
const signals = new Map<Key, Signal<unknown>>();

function setting(key: Key): Signal<unknown> {
  let s = signals.get(key);
  if (!s) {
    s = signal(load(key));
    signals.set(key, s);
  }
  return s;
}

/**
 * Read a setting (or its default). Read in a component or computed, it re-runs them when the
 * setting changes in this tab.
 */
export function getSetting<K extends Key>(key: K): Value<K> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return setting(key).value as Value<K>;
}

/** Called with every setting saved here (source.ts persists shared ones to the server). */
let onSave: (key: Key, value: unknown) => void = () => {};
export const setSaveHook = (fn: (key: Key, value: unknown) => void) => void (onSave = fn);

/** Store a setting without calling the save hook (for values from the server). */
export function applySetting<K extends Key>(key: K, value: Value<K>) {
  setting(key).value = value;
  store(key, value);
}

/** Save a setting. */
export function setSetting<K extends Key>(key: K, value: Value<K>) {
  applySetting(key, value);
  onSave(key, value);
}
