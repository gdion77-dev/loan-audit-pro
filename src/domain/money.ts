/**
 * Loan Audit PRO — src/domain/money.ts
 * ------------------------------------------------------------------
 * Money is stored as INTEGER CENTS. Never as floating euros.
 *   €647.08  -> { cents: 64708, currency: 'EUR' }
 *
 * Null-vs-zero rule (core audit rule of the app):
 *   - null  = value is missing / unknown in the source
 *   - 0     = the source EXPLICITLY states zero
 * Missing values must NEVER be silently converted to zero.
 *
 * This module contains conversion/validation utilities only.
 * No loan calculations (no amortization, no interest) live here.
 */

export type CurrencyCode = 'EUR' | 'CHF' | 'USD' | (string & {});

/** Amount in integer cents. May be negative (economic differences). */
export interface Money {
  /** Integer number of cents (minor units). */
  readonly cents: number;
  readonly currency: CurrencyCode;
}

/** A money value that may be missing in the source. null = unknown, NOT zero. */
export type NullableMoney = Money | null;

export class MoneyError extends Error {
  override name = 'MoneyError';
}

/** True if `value` is a structurally valid Money with integer cents. */
export function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cents' in value &&
    'currency' in value &&
    typeof (value as Money).cents === 'number' &&
    Number.isSafeInteger((value as Money).cents) &&
    typeof (value as Money).currency === 'string' &&
    (value as Money).currency.length > 0
  );
}

/** Construct Money from integer cents. Throws on non-integer input. */
export function moneyFromCents(cents: number, currency: CurrencyCode = 'EUR'): Money {
  if (!Number.isSafeInteger(cents)) {
    throw new MoneyError(
      `Money cents must be a safe integer, got: ${String(cents)}`,
    );
  }
  return Object.freeze({ cents, currency });
}

/**
 * Construct Money from a decimal major-unit amount (e.g. 647.08).
 * Accepts at most 2 decimal places; rejects values that are not
 * exactly representable in cents (no silent rounding).
 */
export function moneyFromDecimal(amount: number, currency: CurrencyCode = 'EUR'): Money {
  if (!Number.isFinite(amount)) {
    throw new MoneyError(`Money amount must be finite, got: ${String(amount)}`);
  }
  const cents = Math.round(amount * 100);
  // Reject inputs with more than 2 decimals (e.g. 1.005 -> 100.5 cents).
  if (Math.abs(amount * 100 - cents) > 1e-6) {
    throw new MoneyError(
      `Money amount has more than 2 decimal places: ${String(amount)}`,
    );
  }
  return moneyFromCents(cents, currency);
}

/**
 * Parse a money string into Money.
 * Supports Greek/EU format ("1.234,56", "647,08") and
 * EN format ("1,234.56", "647.08"). Sign supported ("-12,50").
 *
 * Returns null for empty / unknown markers — null means MISSING,
 * it is never coerced to zero.
 */
export function parseMoneyString(
  input: string | null | undefined,
  currency: CurrencyCode = 'EUR',
): NullableMoney {
  if (input === null || input === undefined) return null;
  const trimmed = input.replace(/\u00a0/g, ' ').trim();
  if (trimmed === '' || /^(-|—|–|n\/a|na|\?|άγνωστο|αγνωστο)$/i.test(trimmed)) {
    return null;
  }

  let s = trimmed.replace(/[€$\s]|CHF|EUR|USD/gi, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s === '') return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let integerPart: string;
  let fractionPart: string;

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the LAST separator is the decimal separator.
    const decSep = lastComma > lastDot ? ',' : '.';
    const decIdx = decSep === ',' ? lastComma : lastDot;
    integerPart = s.slice(0, decIdx).replace(/[.,]/g, '');
    fractionPart = s.slice(decIdx + 1);
  } else if (lastComma !== -1) {
    // Only comma: decimal sep if followed by 1-2 digits at the end, else grouping.
    const after = s.slice(lastComma + 1);
    if (/^\d{1,2}$/.test(after)) {
      integerPart = s.slice(0, lastComma).replace(/,/g, '');
      fractionPart = after;
    } else {
      integerPart = s.replace(/,/g, '');
      fractionPart = '';
    }
  } else if (lastDot !== -1) {
    const after = s.slice(lastDot + 1);
    if (/^\d{1,2}$/.test(after)) {
      integerPart = s.slice(0, lastDot).replace(/\./g, '');
      fractionPart = after;
    } else {
      // "1.234" -> grouping (Greek thousands), not decimals.
      integerPart = s.replace(/\./g, '');
      fractionPart = '';
    }
  } else {
    integerPart = s;
    fractionPart = '';
  }

  if (!/^\d+$/.test(integerPart) || (fractionPart !== '' && !/^\d{1,2}$/.test(fractionPart))) {
    throw new MoneyError(`Cannot parse money string: "${input}"`);
  }

  const cents =
    Number.parseInt(integerPart, 10) * 100 +
    (fractionPart === '' ? 0 : Number.parseInt(fractionPart.padEnd(2, '0'), 10));

  return moneyFromCents(negative ? -cents : cents, currency);
}

/** Render Money as a plain decimal string with 2 decimals, e.g. "647.08". */
export function moneyToDecimalString(money: Money): string {
  const sign = money.cents < 0 ? '-' : '';
  const abs = Math.abs(money.cents);
  const euros = Math.trunc(abs / 100);
  const cents = abs % 100;
  return `${sign}${euros}.${String(cents).padStart(2, '0')}`;
}

/** Render Money in Greek format, e.g. "1.234,56 €". Display only. */
export function formatMoneyGreek(money: Money): string {
  const sign = money.cents < 0 ? '-' : '';
  const abs = Math.abs(money.cents);
  const euros = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cents = String(abs % 100).padStart(2, '0');
  const symbol = money.currency === 'EUR' ? ' €' : ` ${money.currency}`;
  return `${sign}${euros},${cents}${symbol}`;
}

/** Strict equality of two money values (cents and currency). */
export function moneyEquals(a: Money, b: Money): boolean {
  return a.cents === b.cents && a.currency === b.currency;
}

/**
 * True if the value is explicitly zero (cents === 0).
 * A null (missing) value is NOT zero — callers must branch on null first.
 */
export function isExplicitZero(value: NullableMoney): value is Money {
  return value !== null && value.cents === 0;
}

/** True if the value is missing/unknown in the source. */
export function isMissing(value: NullableMoney): value is null {
  return value === null;
}
