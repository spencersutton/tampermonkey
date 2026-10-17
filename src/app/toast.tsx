// Small transient messages (bid results), shown bottom-center.
import { useEffect, useState } from 'preact/hooks';

export type ToastKind = 'good' | 'bad' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<(t: Toast[]) => void>();
const emit = () => subs.forEach((f) => f(toasts));

export function toast(kind: ToastKind, text: string, ms = kind === 'bad' ? 8000 : 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, kind, text }].slice(-4);
  emit();
  setTimeout(() => dismiss(id), ms);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

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
