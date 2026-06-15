/**
 * Loan Audit PRO — src/ui-state/fieldState.ts
 * ------------------------------------------------------------------
 * The reusable three-state field model for UI drafts. Mirrors the
 * domain's null-discipline at the UI layer: a field is either a
 * concrete value, an EXPLICIT zero (the source states zero), or
 * UNKNOWN (no value yet). Unknown is NEVER represented as 0 and a
 * blank is NEVER coerced to 0.
 *
 * Pure types + tiny constructors/guards. No engine imports, no
 * calculation, no React.
 */

export type FieldStatus = 'value' | 'explicit_zero' | 'unknown';

export type FieldSource = 'manual' | 'imported' | 'derived';

export interface FieldState<T> {
  readonly status: FieldStatus;
  /** Non-null for 'value'; null for 'unknown'; 0 for numeric 'explicit_zero'. */
  readonly value: T | null;
  readonly source?: FieldSource;
  readonly note?: string;
}

/** True when the field carries a usable concrete value. */
export function isValue<T>(field: FieldState<T>): field is FieldState<T> & { value: T } {
  return field.status === 'value' && field.value !== null;
}

/** True when the field is an explicit zero (numeric). */
export function isExplicitZero<T>(field: FieldState<T>): boolean {
  return field.status === 'explicit_zero';
}

/** True when the field is unknown (value must be null). */
export function isUnknown<T>(field: FieldState<T>): boolean {
  return field.status === 'unknown';
}

/* ------------------------------------------------------------------ */
/* Constructors — the only sanctioned way to build a FieldState        */
/* ------------------------------------------------------------------ */

/** A concrete value. Throws if null is passed (a null value is unknown). */
export function fieldValue<T>(value: T, source?: FieldSource, note?: string): FieldState<T> {
  if (value === null) {
    throw new FieldStateError("Η κατάσταση «value» απαιτεί μη κενή τιμή· χρησιμοποιήστε «unknown» για ελλείπουσα τιμή.");
  }
  return {
    status: 'value',
    value,
    ...(source !== undefined ? { source } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/** An explicit numeric zero — distinct from unknown. */
export function fieldExplicitZero(source?: FieldSource, note?: string): FieldState<number> {
  return {
    status: 'explicit_zero',
    value: 0,
    ...(source !== undefined ? { source } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/** Unknown / not yet provided. Value is always null. */
export function fieldUnknown<T>(source?: FieldSource, note?: string): FieldState<T> {
  return {
    status: 'unknown',
    value: null,
    ...(source !== undefined ? { source } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Validation / normalization                                          */
/* ------------------------------------------------------------------ */

export class FieldStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FieldStateError';
  }
}

export interface FieldStateIssue {
  readonly code: 'VALUE_NULL' | 'UNKNOWN_NOT_NULL' | 'EXPLICIT_ZERO_NOT_ZERO';
  readonly message: string;
}

/**
 * Returns the consistency issue with a raw field, or null if valid:
 *   - 'value' must have a non-null value,
 *   - 'unknown' must have a null value (never a stray number),
 *   - 'explicit_zero' must be exactly 0 when numeric.
 * Pure check — does not mutate.
 */
export function validateField<T>(field: FieldState<T>): FieldStateIssue | null {
  if (field.status === 'value' && field.value === null) {
    return { code: 'VALUE_NULL', message: 'Κατάσταση «value» με κενή τιμή· μη έγκυρη.' };
  }
  if (field.status === 'unknown' && field.value !== null) {
    return { code: 'UNKNOWN_NOT_NULL', message: 'Κατάσταση «unknown» με μη κενή τιμή· μη έγκυρη.' };
  }
  if (field.status === 'explicit_zero' && typeof field.value === 'number' && field.value !== 0) {
    return { code: 'EXPLICIT_ZERO_NOT_ZERO', message: 'Κατάσταση «explicit_zero» με μη μηδενική τιμή· μη έγκυρη.' };
  }
  return null;
}

/**
 * Normalizes a possibly-inconsistent field SAFELY, never inventing a
 * zero: a 'value' with null becomes 'unknown'; an 'unknown' with a
 * stray non-null value is forced back to null (the value is dropped,
 * NOT converted to a number). Returns the field unchanged if valid.
 */
export function normalizeField<T>(field: FieldState<T>): FieldState<T> {
  if (field.status === 'value' && field.value === null) {
    return { ...field, status: 'unknown', value: null };
  }
  if (field.status === 'unknown' && field.value !== null) {
    return { ...field, value: null }; // drop the stray value; never coerce to 0
  }
  return field;
}

/* ------------------------------------------------------------------ */
/* Input parsing (UI → FieldState) — never coerces blanks to zero      */
/* ------------------------------------------------------------------ */

/**
 * A raw text input → FieldState<string>. A blank/whitespace-only
 * string is UNKNOWN, not an empty value. A non-empty string is a
 * value (trimmed of surrounding whitespace only).
 */
export function parseTextToField(
  raw: string,
  source: FieldSource = 'manual',
): FieldState<string> {
  // Only a fully-blank string is UNKNOWN. Otherwise keep the text exactly
  // as typed — including spaces between or after words.
  if (raw.trim() === '') return fieldUnknown<string>(source);
  return fieldValue<string>(raw, source);
}

export interface NumberParseResult {
  readonly field: FieldState<number>;
  /** True when the input was non-blank but not a valid number. */
  readonly invalid: boolean;
}

/**
 * A raw numeric input → FieldState<number>, with the critical rule
 * that invalid text NEVER becomes 0:
 *   - blank / whitespace      → unknown (value null)
 *   - exactly zero ("0","0,0")→ explicit_zero (value 0)
 *   - any other valid number  → value
 *   - non-numeric text        → unknown + invalid flag (NOT zero)
 * Accepts Greek decimal comma and thousands dots.
 */
export function parseNumberToField(
  raw: string,
  source: FieldSource = 'manual',
): NumberParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { field: fieldUnknown<number>(source), invalid: false };
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    // invalid text stays UNKNOWN — never silently zero
    return { field: fieldUnknown<number>(source), invalid: true };
  }
  if (parsed === 0) return { field: fieldExplicitZero(source), invalid: false };
  return { field: fieldValue<number>(parsed, source), invalid: false };
}

/**
 * A raw euro input (major units, e.g. "1.234,56") → FieldState<number>
 * in integer CENTS. Same three-state discipline as parseNumberToField;
 * invalid text never becomes 0.
 */
export function parseMoneyToField(
  raw: string,
  source: FieldSource = 'manual',
): NumberParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { field: fieldUnknown<number>(source), invalid: false };
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const major = Number(normalized);
  if (!Number.isFinite(major)) {
    return { field: fieldUnknown<number>(source), invalid: true };
  }
  const cents = Math.round(major * 100);
  if (cents === 0) return { field: fieldExplicitZero(source), invalid: false };
  return { field: fieldValue<number>(cents, source), invalid: false };
}

/* ------------------------------------------------------------------ */
/* Display helpers (FieldState → UI)                                   */
/* ------------------------------------------------------------------ */

/** Greek state label for a field's status. */
export function fieldStatusLabel<T>(field: FieldState<T>): string {
  switch (field.status) {
    case 'value':
      return 'Τιμή';
    case 'explicit_zero':
      return 'Ρητό μηδέν';
    case 'unknown':
      return 'Άγνωστο';
  }
}
