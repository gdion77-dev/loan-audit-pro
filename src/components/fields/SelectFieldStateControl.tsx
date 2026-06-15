/**
 * Loan Audit PRO — src/components/fields/SelectFieldStateControl.tsx
 * ------------------------------------------------------------------
 * A controlled <select> bound to a FieldState<string>. Each option
 * carries a stable string `code` (the stored value) and a Greek
 * `label`. Exactly one option is marked `unknown: true`; selecting it
 * yields a FieldState with status 'unknown' and value null — never an
 * empty value. Selecting any other option yields a 'value' field
 * holding that option's code. Presentational — reports upward via
 * onChange and performs no calculation.
 */
import React from 'react';
import {
  fieldValue,
  fieldUnknown,
  fieldStatusLabel,
  type FieldState,
} from '../../ui-state/fieldState';

export interface SelectOption {
  /** Stable stored code for a real value (ignored for the unknown option). */
  readonly code: string;
  readonly label: string;
  /** Exactly one option should set this true to represent «Άγνωστο». */
  readonly unknown?: boolean;
}

export interface SelectFieldStateControlProps {
  readonly id: string;
  readonly label: string;
  readonly options: readonly SelectOption[];
  readonly field: FieldState<string>;
  readonly onChange: (next: FieldState<string>) => void;
}

const UNKNOWN_SENTINEL = '__unknown__';

export const SelectFieldStateControl: React.FC<SelectFieldStateControlProps> = ({
  id,
  label,
  options,
  field,
  onChange,
}) => {
  // current select value: the code for a real value, else the sentinel
  const current = field.status === 'value' && field.value !== null ? field.value : UNKNOWN_SENTINEL;

  const handle = (selected: string): void => {
    if (selected === UNKNOWN_SENTINEL) {
      onChange(fieldUnknown<string>('manual')); // unknown → null, never empty value
    } else {
      onChange(fieldValue<string>(selected, 'manual'));
    }
  };

  return (
    <div className="lap-field">
      <label className="lap-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="lap-field__input"
        value={current}
        onChange={(e: { target: { value: string } }) => handle(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.unknown ? UNKNOWN_SENTINEL : opt.code} value={opt.unknown ? UNKNOWN_SENTINEL : opt.code}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className={`lap-field__state lap-field__state--${field.status}`}>
        {fieldStatusLabel(field)}
      </span>
    </div>
  );
};
