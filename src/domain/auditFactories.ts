/**
 * Loan Audit PRO — src/domain/auditFactories.ts
 * ------------------------------------------------------------------
 * Step 1-B: severity-specific factory helpers around createAuditEntry
 * and the validation-related audit codes.
 *
 * Helpers only — no calculations, no inference, no data mutation.
 */

import {
  createAuditEntry,
  AUDIT_CODES,
  type AuditEntry,
  type AuditCode,
} from './auditTypes';

/**
 * Validation-specific audit codes (Step 1-B). Codes already present in
 * AUDIT_CODES (e.g. LAW128_UNKNOWN, DAYCOUNT_UNKNOWN) are reused, not
 * duplicated; this object spreads them so callers have one lookup.
 */
export const VALIDATION_AUDIT_CODES = {
  ...AUDIT_CODES,

  // CaseInfo
  CASE_DEBTOR_NAME_MISSING: 'CASE_DEBTOR_NAME_MISSING',
  CASE_CONTRACT_NUMBER_MISSING: 'CASE_CONTRACT_NUMBER_MISSING',
  CASE_INSTITUTION_MISSING: 'CASE_INSTITUTION_MISSING',
  CASE_PRINCIPAL_MISSING: 'CASE_PRINCIPAL_MISSING',
  CASE_CURRENCY_MISSING: 'CASE_CURRENCY_MISSING',
  CASE_START_DATE_MISSING: 'CASE_START_DATE_MISSING',
  CASE_TERM_OR_END_DATE_MISSING: 'CASE_TERM_OR_END_DATE_MISSING',
  CASE_DATE_INVALID: 'CASE_DATE_INVALID',

  // RateConfig
  RATE_FIXED_MISSING: 'RATE_FIXED_MISSING',
  RATE_FLOATING_INDEX_MISSING: 'RATE_FLOATING_INDEX_MISSING',
  RATE_SPREAD_MISSING: 'RATE_SPREAD_MISSING',
  RATE_HISTORY_MISSING: 'RATE_HISTORY_MISSING',

  // Bank schedule
  BANK_SCHEDULE_EMPTY: 'BANK_SCHEDULE_EMPTY',
  BANK_SCHEDULE_ROW_DUE_DATE_INVALID: 'BANK_SCHEDULE_ROW_DUE_DATE_INVALID',
  BANK_SCHEDULE_ROW_MISSING_AMOUNT: 'BANK_SCHEDULE_ROW_MISSING_AMOUNT',
  BANK_SCHEDULE_ROW_MISSING_PRINCIPAL: 'BANK_SCHEDULE_ROW_MISSING_PRINCIPAL',
  BANK_SCHEDULE_ROW_MISSING_INTEREST: 'BANK_SCHEDULE_ROW_MISSING_INTEREST',
  BANK_SCHEDULE_ROW_MISSING_BALANCE: 'BANK_SCHEDULE_ROW_MISSING_BALANCE',
  BANK_SCHEDULE_ROW_ALL_NUMERIC_FIELDS_MISSING:
    'BANK_SCHEDULE_ROW_ALL_NUMERIC_FIELDS_MISSING',
  BANK_SCHEDULE_DATES_NOT_CHRONOLOGICAL: 'BANK_SCHEDULE_DATES_NOT_CHRONOLOGICAL',
  BANK_SCHEDULE_ROW_LOW_CONFIDENCE: 'BANK_SCHEDULE_ROW_LOW_CONFIDENCE',
  BANK_SCHEDULE_DUPLICATE_ROW_ID: 'BANK_SCHEDULE_DUPLICATE_ROW_ID',

  // Payments
  PAYMENT_DATE_INVALID: 'PAYMENT_DATE_INVALID',
  PAYMENT_AMOUNT_MISSING: 'PAYMENT_AMOUNT_MISSING',
  PAYMENT_AMOUNT_EXPLICIT_ZERO: 'PAYMENT_AMOUNT_EXPLICIT_ZERO',
  PAYMENT_DUPLICATE_ID: 'PAYMENT_DUPLICATE_ID',
  PAYMENT_UNMATCHED: 'PAYMENT_UNMATCHED',

  // Report wording
  FORBIDDEN_REPORT_TERM: 'FORBIDDEN_REPORT_TERM',
} as const;

export type ValidationAuditCode =
  (typeof VALIDATION_AUDIT_CODES)[keyof typeof VALIDATION_AUDIT_CODES];

type Context = Record<string, unknown> | null | undefined;

/** severity: 'info' — πληροφοριακή καταγραφή. */
export function info(code: AuditCode, message: string, context?: Context): AuditEntry {
  return createAuditEntry({ severity: 'info', code, message, context: context ?? null });
}

/** severity: 'assumption' — ρητή υπόθεση που πρέπει να εμφανιστεί στη μεθοδολογία. */
export function assumption(code: AuditCode, message: string, context?: Context): AuditEntry {
  return createAuditEntry({
    severity: 'assumption',
    code,
    message,
    context: context ?? null,
  });
}

/** severity: 'warning' — ελλιπή/ασυνεπή δεδομένα που περιορίζουν τη μελέτη. */
export function warning(code: AuditCode, message: string, context?: Context): AuditEntry {
  return createAuditEntry({
    severity: 'warning',
    code,
    message,
    context: context ?? null,
  });
}

/** severity: 'requires_review' — «Απαιτείται έλεγχος» από τον συντάκτη. */
export function requiresReview(
  code: AuditCode,
  message: string,
  context?: Context,
): AuditEntry {
  return createAuditEntry({
    severity: 'requires_review',
    code,
    message,
    context: context ?? null,
  });
}
