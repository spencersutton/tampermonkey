// Reactive access to GM storage (synced across tabs).
import { GM_addValueChangeListener, GM_getValue, GM_setValue } from 'vite-plugin-monkey/dist/client';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULTS } from '../shared/keys';

type Key = keyof typeof DEFAULTS;
type Value<K extends Key> = (typeof DEFAULTS)[K];

/** In-memory copy of each setting, so reads don't hit GM storage every render. */
const cache = new Map<Key, unknown>();
/** Callbacks to run when a setting changes, here or in another tab. */
const listeners = new Map<Key, Set<() => void>>();

/** Read a setting (or its default); the first read also starts listening for other tabs' changes. */
export function getSetting<K extends Key>(key: K): Value<K> {
  if (!cache.has(key)) {
    cache.set(key, GM_getValue(key, DEFAULTS[key]));
    GM_addValueChangeListener(key, (_n, _old, val, remote) => {
      if (!remote) return;
      cache.set(key, val ?? DEFAULTS[key]);
      listeners.get(key)?.forEach((l) => l());
    });
  }
  return cache.get(key) as Value<K>;
}

/** Save a setting and notify everything in this tab that depends on it. */
export function setSetting<K extends Key>(key: K, value: Value<K>) {
  cache.set(key, value);
  GM_setValue(key, value);
  listeners.get(key)?.forEach((l) => l());
}

/** Subscribe to changes of one setting; returns an unsubscribe function. */
export function onSetting(key: Key, fn: () => void): () => void {
  getSetting(key);
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => listeners.get(key)!.delete(fn);
}

/** Preact hook: [value, setter] for a setting, re-rendering when it changes in any tab. */
export function useSetting<K extends Key>(key: K): [Value<K>, (v: Value<K>) => void] {
  const [, force] = useState(0);
  const value = getSetting(key);
  useEffect(() => {
    const off = onSetting(key, () => force((n) => n + 1));
    // Catch up on a change between render and this (possibly delayed) effect.
    if (getSetting(key) !== value) force((n) => n + 1);
    return off;
  }, [key]);
  return [value, (v) => setSetting(key, v)];
}
