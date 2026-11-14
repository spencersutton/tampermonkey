import type { InputHTMLAttributes } from 'preact';
import { useState } from 'preact/hooks';

type NumberInputProps<T> = {
  label: string;
  value: T;
  parse: (text: string) => T;
  onChange: (v: T) => void;
} & Omit<InputHTMLAttributes, 'label' | 'value' | 'onChange'>;

/** Number input that commits on blur or Enter; `parse` turns the typed text into the value. */
export function NumberInput<T extends number | null>(props: NumberInputProps<T>) {
  return <NumberInputDraft key={String(props.value)} {...props} />;
}

function NumberInputDraft<T extends number | null>({
  label,
  value,
  parse,
  onChange,
  ...input
}: NumberInputProps<T>) {
  const format = (v: T) => (v == null ? '' : String(v));
  const [text, setText] = useState(format(value));
  const commit = () => {
    const v = parse(text);
    setText(format(v));
    if (v !== value) {
      onChange(v);
    }
  };
  return (
    <label class="field">
      <span>{label}</span>
      <input
        {...input}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
    </label>
  );
}
