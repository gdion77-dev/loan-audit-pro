/**
 * Loan Audit PRO — src/components/fields/MoneyFieldStateControl.tsx
 * ------------------------------------------------------------------
 * A controlled euro input bound to a FieldState<number> in integer
 * CENTS. The user types major units (e.g. «1.234,56»); blank is
 * UNKNOWN, exactly zero is EXPLICIT_ZERO, invalid text becomes
 * UNKNOWN (NEVER 0). Shows the Greek state label plus, for a real
 * value, the formatted euro amount derived from the stored cents.
 * Presentational — reports the new FieldState upward via onChange.
 */
import React from 'react';
import { useState } from 'react';
import {
  parseMoneyToField,
  fieldStatusLabel,
  isValue,
  type FieldState,
} from '../../ui-state/fieldState';
import { moneyFromCents, formatMoneyGreek } from '../../domain/money';

export interface MoneyFieldStateControlProps {
  readonly id: string;
  readonly label: string;
  readonly field: FieldState<number>;
  readonly onChange: (next: FieldState<number>) => void;
  readonly placeholder?: string;
}

export const MoneyFieldStateControl: React.FC<MoneyFieldStateControlProps> = ({
  id,
  label,
  field,
  onChange,
  placeholder,
}) => {
  const [raw, setRaw] = useState<string>('');
  const [invalid, setInvalid] = useState<boolean>(false);

  const handle = (text: string): void => {
    setRaw(text);
    const result = parseMoneyToField(text);
    setInvalid(result.invalid);
    onChange(result.field); // invalid → unknown, never 0 cents
  };

  // euro display for a real cents value (formatting only — no calc):
  const euroDisplay = isValue(field) ? formatMoneyGreek(moneyFromCents(field.value)) : null;

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
      {euroDisplay !== null ? <span className="lap-field__euro">{euroDisplay}</span> : null}
      {invalid ? (
        <span className="lap-field__hint">Μη έγκυρο ποσό· παραμένει «Άγνωστο».</span>
      ) : null}
    </div>
  );
};
