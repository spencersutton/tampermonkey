// Settings storage for the userscript: Tampermonkey's GM storage, which every
// /tlx tab shares and reports changes from.
import { GM_addValueChangeListener, GM_getValue, GM_setValue } from 'vite-plugin-monkey/dist/client';

export const getValue = <T>(key: string, fallback: T): T => GM_getValue(key, fallback);
export const setValue = (key: string, value: unknown) => GM_setValue(key, value);

/** Call `fn` when another tab changes `key`. */
export function onRemoteChange(key: string, fn: (value: unknown) => void) {
  GM_addValueChangeListener(key, (_name, _old, value, remote) => remote && fn(value));
}
