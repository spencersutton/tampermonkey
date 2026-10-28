// Reactive access to settings. They're stored in localStorage (as JSON), and
// the SYNCED_KEYS also on the server (see source.ts). Each tab reads them once,
// so changes made in other tabs or devices show up after a refresh.
import { signal, type Signal } from '@preact/signals';
import { DEFAULTS } from '../shared/keys';

export type Key = keyof typeof DEFAULTS;
type Value<K extends Key> = (typeof DEFAULTS)[K];

const PREFIX = 'tlx:';

function load(key: Key): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? DEFAULTS[key] : JSON.parse(raw);
  } catch {
    return DEFAULTS[key]; // storage blocked (private mode) or a corrupt value
  }
}

function store(key: Key, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the value still lives in memory for this tab
  }
}

/** Each setting as a signal, loaded from localStorage on first use. */
const signals = new Map<Key, Signal<unknown>>();

function setting(key: Key): Signal<unknown> {
  let s = signals.get(key);
  if (!s) {
    s = signal(load(key));
    signals.set(key, s);
  }
  return s;
}

/** Read a setting (or its default). Read in a component or computed, it re-runs them when the setting changes in this tab. */
export function getSetting<K extends Key>(key: K): Value<K> {
  return setting(key).value as Value<K>;
}

/** Called with every setting saved here (source.ts sends synced ones to the server). */
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

/** [value, setter] for a setting, for components. */
export const useSetting = <K extends Key>(key: K): [Value<K>, (v: Value<K>) => void] => [getSetting(key), (v) => setSetting(key, v)];
