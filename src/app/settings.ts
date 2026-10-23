// Reactive access to settings, synced across tabs. They're stored in
// localStorage (as JSON), and the SYNCED_KEYS also on the server (see source.ts).
import { useSyncExternalStore } from 'preact/compat';
import { useCallback } from 'preact/hooks';
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

/** In-memory copy of each setting, so reads don't hit localStorage every render. */
const cache = new Map<Key, unknown>();
/** Dispatches an event named after a setting's key whenever it changes, here or in another tab. */
const changes = new EventTarget();

// Another tab saved a setting.
window.addEventListener('storage', (e) => {
  const key = e.key?.startsWith(PREFIX) && (e.key.slice(PREFIX.length) as Key);
  if (key && cache.has(key)) {
    cache.set(key, e.newValue == null ? DEFAULTS[key] : JSON.parse(e.newValue));
    changes.dispatchEvent(new Event(key));
  }
});

/** Read a setting (or its default). */
export function getSetting<K extends Key>(key: K): Value<K> {
  if (!cache.has(key)) {
    cache.set(key, load(key));
  }
  return cache.get(key) as Value<K>;
}

/** Called with every setting saved here (source.ts sends synced ones to the server). */
let onSave: (key: Key, value: unknown) => void = () => {};
export const setSaveHook = (fn: (key: Key, value: unknown) => void) => void (onSave = fn);

/** Store a setting and notify everything in this tab that depends on it, without calling the save hook (for values from the server). */
export function applySetting<K extends Key>(key: K, value: Value<K>) {
  cache.set(key, value);
  store(key, value);
  changes.dispatchEvent(new Event(key));
}

/** Save a setting and notify everything in this tab that depends on it. */
export function setSetting<K extends Key>(key: K, value: Value<K>) {
  applySetting(key, value);
  onSave(key, value);
}

/** Preact hook: [value, setter] for a setting, re-rendering when it changes in any tab. */
export function useSetting<K extends Key>(key: K): [Value<K>, (v: Value<K>) => void] {
  const subscribe = useCallback(
    (fn: () => void) => {
      changes.addEventListener(key, fn);
      return () => changes.removeEventListener(key, fn);
    },
    [key],
  );
  return [useSyncExternalStore(subscribe, () => getSetting(key)), (v) => setSetting(key, v)];
}
