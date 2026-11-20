// Renders the toast stack; mounted once by App.
import { useLayoutEffect, useRef } from 'preact/hooks';

import { dismissToast, toasts } from '../server/toast';

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
      {list.map(t => (
        <button
          type="button"
          key={t.id}
          class={`toast toast-${t.kind}`}
          onClick={() => dismissToast(t.id)}
          title="Dismiss"
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
