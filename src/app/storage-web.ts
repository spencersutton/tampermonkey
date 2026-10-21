// Settings storage for the web app: localStorage (as JSON), which every tab
// of the app shares; the `storage` event reports other tabs' changes.
const PREFIX = 'tlx:';

export function getValue<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback; // storage blocked (private mode) or a corrupt value
  }
}

export function setValue(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the value still lives in memory for this tab
  }
}

/** Call `fn` when another tab changes `key`. */
export function onRemoteChange(key: string, fn: (value: unknown) => void) {
  window.addEventListener('storage', (e) => {
    if (e.key === PREFIX + key) {
      fn(e.newValue == null ? undefined : JSON.parse(e.newValue));
    }
  });
}
