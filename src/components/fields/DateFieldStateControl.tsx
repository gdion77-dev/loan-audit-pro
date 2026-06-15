/**
 * Loan Audit PRO — src/components/fields/DateFieldStateControl.tsx
 * ------------------------------------------------------------------
 * A controlled date input that PRESENTS dates as `dd/mm/yyyy` while the
 * underlying FieldState stays ISO `yyyy-mm-dd` (the format every engine,
 * the PDF and the audit layer require). Blank input is UNKNOWN. The
 * component performs no calculation; it only translates display↔ISO.
 */
import React from 'react';
import { fieldValue, fieldUnknown, fieldStatusLabel, type FieldState } from '../../ui-state/fieldState';
import { isoToDisplay, displayToIso } from '../../ui-state/dateDisplay';

export interface DateFieldStateControlProps {
  readonly id: string;
  readonly label: string;
  /** FieldState holding an ISO `yyyy-mm-dd` string (or unknown). */
  readonly field: FieldState<string>;
  readonly onChange: (next: FieldState<string>) => void;
  readonly placeholder?: string;
}

export const DateFieldStateControl: React.FC<DateFieldStateControlProps> = ({
  id,
  label,
  field,
  onChange,
  placeholder,
}) => {
  // Show the stored ISO value as dd/mm/yyyy; show raw text while it is
  // still being typed and not yet a complete ISO date.
  const stored = field.status === 'value' && field.value !== null ? field.value : '';
  const displayValue = stored === '' ? '' : isoToDisplay(stored);

  const handleChange = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      onChange(fieldUnknown<string>('manual'));
      return;
    }
    // Convert dd/mm/yyyy → ISO when possible; otherwise keep what was typed
    // so the user can finish entering the date.
    const iso = displayToIso(trimmed);
    onChange(fieldValue<string>(iso, 'manual'));
  };

  return (
    <div className="lap-field">
      <label className="lap-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className="lap-field__input"
        value={displayValue}
        placeholder={placeholder ?? 'ηη/μμ/εεεε'}
        onChange={(e: { target: { value: string } }) => handleChange(e.target.value)}
      />
      <span className={`lap-field__state lap-field__state--${field.status}`}>
        {fieldStatusLabel(field)}
      </span>
    </div>
  );
};
