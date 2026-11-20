// Small transient messages (bid results, save errors), stored as reactive state.
import { signal } from '@preact/signals';

export type ToastKind = 'good' | 'bad' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Toasts currently on screen (at most four). */
export const toasts = signal<Toast[]>([]);
let nextId = 1;

/** Show a message for `ms` (errors stay up longer). */
export function toast(kind: ToastKind, text: string, ms = kind === 'bad' ? 8000 : 4000) {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, kind, text }].slice(-4);
  setTimeout(() => dismissToast(id), ms);
}

/** Remove a toast early (clicked) or when its time is up. */
export function dismissToast(id: number) {
  toasts.value = toasts.value.filter(t => t.id !== id);
}
