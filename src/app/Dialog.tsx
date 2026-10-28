// Modal popups as native <dialog> elements: the browser keeps them in the top
// layer (the newest on top), traps focus, and sends Escape to the top one only.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props extends Omit<JSX.HTMLAttributes<HTMLDialogElement>, 'onClose'> {
  /** Escape or a click outside the box; the caller unmounts the dialog to close it. */
  onClose: () => void;
  children: ComponentChildren;
}

/**
 * A modal dialog, open while mounted. The element covers the viewport and
 * centers `children` (the box). Focus goes to an `autofocus` element if there
 * is one, else to the box, and back to where it was on close.
 */
export function Dialog({ onClose, children, class: cls, ...rest }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const latest = useRef(onClose);
  latest.current = onClose;
  const unmounted = useRef(false);

  useEffect(() => {
    const d = ref.current!;
    const prevFocus = document.activeElement as HTMLElement | null;
    d.showModal();
    if (!d.querySelector('[autofocus]')) {
      (d.firstElementChild as HTMLElement | null)?.focus();
    }
    return () => {
      unmounted.current = true;
      d.close();
      prevFocus?.focus?.();
    };
  }, []);

  return (
    <dialog
      {...rest}
      ref={ref}
      class={`backdrop ${cls ?? ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && latest.current()}
      onCancel={(e) => {
        e.preventDefault();
        latest.current();
      }}
      // The browser may close it without a cancel event (repeated Escape); keep
      // it open until the caller unmounts it, since a caller can refuse to close.
      onClose={() => {
        if (!unmounted.current) {
          ref.current!.showModal();
          latest.current();
        }
      }}
    >
      {children}
    </dialog>
  );
}
