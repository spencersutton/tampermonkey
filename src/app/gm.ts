// Reactive access to GM storage (synced across tabs).
import { GM_addValueChangeListener, GM_getValue, GM_setValue } from 'vite-plugin-monkey/dist/client';
import { useSyncExternalStore } from 'preact/compat';
import { useCallback } from 'preact/hooks';
import { DEFAULTS } from '../shared/keys';

type Key = keyof typeof DEFAULTS;
type Value<K extends Key> = (typeof DEFAULTS)[K];

/** In-memory copy of each setting, so reads don't hit GM storage every render. */
const cache = new Map<Key, unknown>();
/** Dispatches an event named after a setting's key whenever it changes, here or in another tab. */
const changes = new EventTarget();

/** Read a setting (or its default); the first read also starts listening for other tabs' changes. */
export function getSetting<K extends Key>(key: K): Value<K> {
  if (!cache.has(key)) {
    cache.set(key, GM_getValue(key, DEFAULTS[key]));
    GM_addValueChangeListener(key, (_name, _old, value, remote) => {
      if (remote) {
        cache.set(key, value ?? DEFAULTS[key]);
        changes.dispatchEvent(new Event(key));
      }
    });
  }
  return cache.get(key) as Value<K>;
}

/** Save a setting and notify everything in this tab that depends on it. */
export function setSetting<K extends Key>(key: K, value: Value<K>) {
  cache.set(key, value);
  GM_setValue(key, value);
  changes.dispatchEvent(new Event(key));
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
