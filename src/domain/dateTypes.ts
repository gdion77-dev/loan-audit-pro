/**
 * Loan Audit PRO — src/domain/dateTypes.ts
 * ------------------------------------------------------------------
 * Date primitives and the day-count convention enumeration.
 *
 * No day-count ARITHMETIC lives here (that belongs to later
 * calculation engines). Only types, validation and comparison.
 */

/** Calendar date as 'YYYY-MM-DD' (branded string). */
export type ISODate = string & { readonly __brand?: 'ISODate' };

/** Timestamp as ISO 8601 string, e.g. '2026-06-12T10:30:00.000Z'. */
export type ISODateTime = string & { readonly __brand?: 'ISODateTime' };

export class DateError extends Error {
  override name = 'DateError';
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True if the string is a valid 'YYYY-MM-DD' calendar date. */
export function isValidISODate(value: string): value is ISODate {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Validate and brand a date string. Throws on invalid input. */
export function toISODate(value: string): ISODate {
  if (!isValidISODate(value)) {
    throw new DateError(`Invalid ISO date: "${value}" (expected YYYY-MM-DD)`);
  }
  return value;
}

/** Lexicographic comparison is chronological for ISO dates. */
export function compareISODate(a: ISODate, b: ISODate): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Day-count convention for interest accrual.
 * 'unknown' is a legitimate state: later engines MUST register an
 * assumption + warning when it is encountered (default assumption
 * ACT_360 — common Greek banking practice — must be made explicit,
 * never silent).
 */
export type DayCountConvention =
  | 'ACT_360'
  | 'ACT_365'
  | '30_360'
  | '30E_360'
  | 'unknown';

export const DAY_COUNT_CONVENTIONS: readonly DayCountConvention[] = [
  'ACT_360',
  'ACT_365',
  '30_360',
  '30E_360',
  'unknown',
] as const;

export function isDayCountConvention(value: unknown): value is DayCountConvention {
  return (
    typeof value === 'string' &&
    (DAY_COUNT_CONVENTIONS as readonly string[]).includes(value)
  );
}
