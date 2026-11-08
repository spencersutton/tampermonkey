// Modal popups as native <dialog> elements: the browser keeps them in the top
// layer (the newest on top), traps focus, and sends Escape to the top one only.
import type { ComponentChildren, JSX } from 'preact';
import { useCallback } from 'preact/hooks';

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
function showDialog(dialog: HTMLDialogElement | null) {
  if (!dialog) return;
  const previous = document.activeElement;
  dialog.showModal();
  if (!dialog.querySelector('[autofocus]') && dialog.firstElementChild instanceof HTMLElement) {
    dialog.firstElementChild.focus();
  }
  return () => {
    dialog.close();
    if (previous instanceof HTMLElement) previous.focus();
  };
}

export function Dialog({ onClose, children, class: cls, ...rest }: Props) {
  // Preact stores ref cleanup on the callback, so each dialog needs its own.
  const ref = useCallback((dialog: HTMLDialogElement | null) => showDialog(dialog), []);
  return (
    <dialog
      {...rest}
      ref={ref}
      class={`backdrop ${cls ?? ''}`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // The browser may close it without a cancel event (repeated Escape); keep
      // it open until the caller unmounts it, since a caller can refuse to close.
      onClose={(e) => {
        if (e.currentTarget.isConnected) {
          e.currentTarget.showModal();
          onClose();
        }
      }}
    >
      {children}
    </dialog>
  );
}
