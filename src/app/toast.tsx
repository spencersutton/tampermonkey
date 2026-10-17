// Small transient messages (bid results), shown bottom-center.
import { useEffect, useState } from 'preact/hooks';

export type ToastKind = 'good' | 'bad' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Toasts currently on screen (at most four). */
let toasts: Toast[] = [];
let nextId = 1;
/** Setters of mounted <Toasts> components. */
const subs = new Set<(t: Toast[]) => void>();
/** Push the current toast list to subscribers. */
const emit = () => subs.forEach((f) => f(toasts));

/** Show a message for `ms` (errors stay up longer). */
export function toast(kind: ToastKind, text: string, ms = kind === 'bad' ? 8000 : 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, kind, text }].slice(-4);
  emit();
  setTimeout(() => dismiss(id), ms);
}

/** Remove a toast early (clicked) or when its time is up. */
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Renders the toast stack; mounted once by App. */
export function Toasts() {
  const [list, set] = useState(toasts);
  useEffect(() => {
    subs.add(set);
    return () => void subs.delete(set);
  }, []);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <button type="button" key={t.id} class={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} title="Dismiss">
          {t.text}
        </button>
      ))}
    </div>
  );
}
