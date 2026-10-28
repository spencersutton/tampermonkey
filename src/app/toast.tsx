// Small transient messages (bid results), shown bottom-center.
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';

export type ToastKind = 'good' | 'bad' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Toasts currently on screen (at most four). */
const toasts = signal<Toast[]>([]);
let nextId = 1;

/** Show a message for `ms` (errors stay up longer). */
export function toast(kind: ToastKind, text: string, ms = kind === 'bad' ? 8000 : 4000) {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, kind, text }].slice(-4);
  setTimeout(() => dismiss(id), ms);
}

/** Remove a toast early (clicked) or when its time is up. */
function dismiss(id: number) {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/** Renders the toast stack; mounted once by App. */
export function Toasts() {
  const list = toasts.value;
  const box = useRef<HTMLDivElement>(null);
  // A popover, so it sits in the top layer with the dialogs; shown again on each change to stay above any opened since.
  useLayoutEffect(() => {
    const el = box.current!;
    if (el.matches(':popover-open')) {
      el.hidePopover();
    }
    if (list.length) {
      el.showPopover();
    }
  }, [list]);
  return (
    <div class="toasts" popover="manual" role="status" aria-live="polite" ref={box}>
      {list.map((t) => (
        <button type="button" key={t.id} class={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} title="Dismiss">
          {t.text}
        </button>
      ))}
    </div>
  );
}
