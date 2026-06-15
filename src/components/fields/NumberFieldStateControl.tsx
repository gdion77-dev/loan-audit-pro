/**
 * Loan Audit PRO — src/components/fields/NumberFieldStateControl.tsx
 * ------------------------------------------------------------------
 * A controlled numeric input bound to a FieldState<number>. Blank is
 * UNKNOWN, exactly zero is EXPLICIT_ZERO, any other valid number is a
 * value, and invalid text becomes UNKNOWN (NEVER 0). Shows a Greek
 * state label and a small hint when the last input was invalid.
 * Presentational — reports the new FieldState upward via onChange.
 */
import React from 'react';
import { useState } from 'react';
import {
  parseNumberToField,
  fieldStatusLabel,
  type FieldState,
} from '../../ui-state/fieldState';

export interface NumberFieldStateControlProps {
  readonly id: string;
  readonly label: string;
  readonly field: FieldState<number>;
  readonly onChange: (next: FieldState<number>) => void;
  readonly placeholder?: string;
}

export const NumberFieldStateControl: React.FC<NumberFieldStateControlProps> = ({
  id,
  label,
  field,
  onChange,
  placeholder,
}) => {
  const [raw, setRaw] = useState<string>(
    field.status === 'unknown' || field.value === null ? '' : String(field.value),
  );
  const [invalid, setInvalid] = useState<boolean>(false);

  const handle = (text: string): void => {
    setRaw(text);
    const result = parseNumberToField(text);
    setInvalid(result.invalid);
    onChange(result.field); // invalid → unknown, never 0
  };

  return (
    <div className="lap-field">
      <label className="lap-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        className="lap-field__input"
        value={raw}
        placeholder={placeholder ?? ''}
        onChange={(e: { target: { value: string } }) => handle(e.target.value)}
      />
      <span className={`lap-field__state lap-field__state--${field.status}`}>
        {fieldStatusLabel(field)}
      </span>
      {invalid ? (
        <span className="lap-field__hint">Μη έγκυρη αριθμητική τιμή· παραμένει «Άγνωστο».</span>
      ) : null}
    </div>
  );
};
