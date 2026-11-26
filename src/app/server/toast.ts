// Small transient messages (bid results, save errors), stored as reactive state.
import { signal } from '@preact/signals';

import { ms } from '../../shared/time';

export type ToastKind = 'good' | 'bad' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Toasts currently on screen (at most four). */
export const toasts = signal<Toast[]>([]);
let nextId = 1;

/** Show a message for `shown` (errors stay up longer). */
export function toast(
  kind: ToastKind,
  text: string,
  shown = Temporal.Duration.from({ seconds: kind === 'bad' ? 8 : 4 }),
) {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, kind, text }].slice(-4);
  setTimeout(() => dismissToast(id), ms(shown));
}

/** Remove a toast early (clicked) or when its time is up. */
export function dismissToast(id: number) {
  toasts.value = toasts.value.filter(t => t.id !== id);
}
