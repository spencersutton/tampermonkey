// Reactive access to settings, synced across tabs. Where they're stored depends
// on the build ('@storage'): GM storage in the userscript, localStorage in the
// web app (which also keeps the SYNCED_KEYS on the server; see source-web.tsx).
import { getValue, onRemoteChange, setValue } from '@storage';
import { useSyncExternalStore } from 'preact/compat';
import { useCallback } from 'preact/hooks';
import { DEFAULTS } from '../shared/keys';

export type Key = keyof typeof DEFAULTS;
type Value<K extends Key> = (typeof DEFAULTS)[K];

/** In-memory copy of each setting, so reads don't hit GM storage every render. */
const cache = new Map<Key, unknown>();
/** Dispatches an event named after a setting's key whenever it changes, here or in another tab. */
const changes = new EventTarget();

/** Read a setting (or its default); the first read also starts listening for other tabs' changes. */
export function getSetting<K extends Key>(key: K): Value<K> {
  if (!cache.has(key)) {
    cache.set(key, getValue(key, DEFAULTS[key]));
    onRemoteChange(key, (value) => {
      cache.set(key, value ?? DEFAULTS[key]);
      changes.dispatchEvent(new Event(key));
    });
  }
  return cache.get(key) as Value<K>;
}

/** Called with every setting saved here (the server build sends synced ones to the server). */
let onSave: (key: Key, value: unknown) => void = () => {};
export const setSaveHook = (fn: (key: Key, value: unknown) => void) => void (onSave = fn);

/** Store a setting and notify everything in this tab that depends on it, without calling the save hook (for values from the server). */
export function applySetting<K extends Key>(key: K, value: Value<K>) {
  cache.set(key, value);
  setValue(key, value);
  changes.dispatchEvent(new Event(key));
}

/** Save a setting and notify everything in this tab that depends on it. */
export function setSetting<K extends Key>(key: K, value: Value<K>) {
  applySetting(key, value);
  onSave(key, value);
}

/** Subscribe to changes of one setting; returns an unsubscribe function. */
export function onSetting(key: Key, fn: () => void): () => void {
  getSetting(key);
  changes.addEventListener(key, fn);
  return () => changes.removeEventListener(key, fn);
}

/** Preact hook: [value, setter] for a setting, re-rendering when it changes in any tab. */
export function useSetting<K extends Key>(key: K): [Value<K>, (v: Value<K>) => void] {
  const subscribe = useCallback((fn: () => void) => onSetting(key, fn), [key]);
  return [useSyncExternalStore(subscribe, () => getSetting(key)), (v) => setSetting(key, v)];
}
