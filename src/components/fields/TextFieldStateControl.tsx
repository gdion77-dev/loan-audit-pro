/**
 * Loan Audit PRO — src/components/fields/TextFieldStateControl.tsx
 * ------------------------------------------------------------------
 * A controlled text input bound to a FieldState<string>. A blank
 * input is UNKNOWN (never an empty "value"); any non-blank text is a
 * value. Shows a small Greek state label. Presentational — it reports
 * the new FieldState upward via onChange and performs no calculation.
 */
import React from 'react';
import {
  parseTextToField,
  fieldStatusLabel,
  type FieldState,
} from '../../ui-state/fieldState';

export interface TextFieldStateControlProps {
  readonly id: string;
  readonly label: string;
  readonly field: FieldState<string>;
  readonly onChange: (next: FieldState<string>) => void;
  readonly placeholder?: string;
}

export const TextFieldStateControl: React.FC<TextFieldStateControlProps> = ({
  id,
  label,
  field,
  onChange,
  placeholder,
}) => {
  const displayValue = field.status === 'value' && field.value !== null ? field.value : '';
  return (
    <div className="lap-field">
      <label className="lap-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        className="lap-field__input"
        value={displayValue}
        placeholder={placeholder ?? ''}
        onChange={(e: { target: { value: string } }) => onChange(parseTextToField(e.target.value))}
      />
      <span className={`lap-field__state lap-field__state--${field.status}`}>
        {fieldStatusLabel(field)}
      </span>
    </div>
  );
};
