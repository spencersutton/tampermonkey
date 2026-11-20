import { useRef, useState } from 'preact/hooks';

/** Saves the edited text; returns an error message to keep the editor open. */
export type SaveFn = (text: string) => string | void;

const selectText = (box: HTMLInputElement | HTMLTextAreaElement | null) => box?.select();

/**
 * Inline text editors, one open at a time (identified by an id). Enter or blur saves the trimmed
 * text (empty just closes), Escape cancels.
 */
export function useInlineEdit() {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Which editor is open, updated synchronously: Enter closes the editor, and
  // removing the focused box then fires a blur whose handler still sees the
  // old state – this keeps that second save from running.
  const open = useRef<string | null>(null);

  const start = (id: string, initial: string) => {
    open.current = id;
    setEditing(id);
    setText(initial);
    setError(null);
  };
  const close = () => {
    open.current = null;
    setEditing(null);
    setError(null);
  };
  const save = (id: string, onSave: SaveFn) => {
    if (open.current !== id) {
      return;
    }
    const next = text.trim();
    const err = next ? onSave(next) : undefined;
    if (err) {
      setError(err);
    } else {
      close();
    }
  };
  /** Props for the editor's input or textarea. */
  const boxProps = (id: string, onSave: SaveFn) => ({
    ref: selectText,
    value: text,
    onInput: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
      setText(e.currentTarget.value.replace(/\n/g, ''));
      setError(null);
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save(id, onSave);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    onBlur: () => save(id, onSave),
  });
  return { editing, text, error, start, save, boxProps };
}
