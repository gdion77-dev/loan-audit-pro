/**
 * Tests: audit factory helpers (info / assumption / warning /
 * requiresReview) and validation audit codes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  info,
  assumption,
  warning,
  requiresReview,
  VALIDATION_AUDIT_CODES,
} from '../src/domain/auditFactories';
import { AUDIT_CODES } from '../src/domain/auditTypes';

describe('audit factory helpers', () => {
  it('info creates an info entry with null context by default', () => {
    const e = info('X_CODE', 'πληροφορία');
    assert.equal(e.severity, 'info');
    assert.equal(e.code, 'X_CODE');
    assert.equal(e.message, 'πληροφορία');
    assert.equal(e.context, null);
    assert.ok(Object.isFrozen(e));
  });

  it('assumption creates an assumption entry', () => {
    const e = assumption(VALIDATION_AUDIT_CODES.DAYCOUNT_UNKNOWN, 'ρητή υπόθεση', { dayCount: 'unknown' });
    assert.equal(e.severity, 'assumption');
    assert.deepEqual(e.context, { dayCount: 'unknown' });
  });

  it('warning creates a warning entry', () => {
    const e = warning(VALIDATION_AUDIT_CODES.RATE_SPREAD_MISSING, 'ελλιπή δεδομένα');
    assert.equal(e.severity, 'warning');
  });

  it('requiresReview creates a requires_review entry', () => {
    const e = requiresReview(VALIDATION_AUDIT_CODES.LAW128_UNKNOWN, 'απαιτείται έλεγχος');
    assert.equal(e.severity, 'requires_review');
  });

  it('VALIDATION_AUDIT_CODES reuses existing AUDIT_CODES (no duplication)', () => {
    assert.equal(VALIDATION_AUDIT_CODES.LAW128_UNKNOWN, AUDIT_CODES.LAW128_UNKNOWN);
    assert.equal(VALIDATION_AUDIT_CODES.DAYCOUNT_UNKNOWN, AUDIT_CODES.DAYCOUNT_UNKNOWN);
    assert.equal(
      VALIDATION_AUDIT_CODES.NEGATIVE_INDEX_POLICY_UNKNOWN,
      AUDIT_CODES.NEGATIVE_INDEX_POLICY_UNKNOWN,
    );
  });

  it('defines the new validation codes', () => {
    for (const code of [
      'CASE_PRINCIPAL_MISSING',
      'CASE_DATE_INVALID',
      'RATE_FIXED_MISSING',
      'RATE_FLOATING_INDEX_MISSING',
      'RATE_SPREAD_MISSING',
      'RATE_HISTORY_MISSING',
      'BANK_SCHEDULE_EMPTY',
      'BANK_SCHEDULE_ROW_MISSING_AMOUNT',
      'BANK_SCHEDULE_ROW_MISSING_BALANCE',
      'BANK_SCHEDULE_ROW_ALL_NUMERIC_FIELDS_MISSING',
      'BANK_SCHEDULE_DATES_NOT_CHRONOLOGICAL',
      'PAYMENT_AMOUNT_MISSING',
      'PAYMENT_DUPLICATE_ID',
      'PAYMENT_UNMATCHED',
      'FORBIDDEN_REPORT_TERM',
    ] as const) {
      assert.equal((VALIDATION_AUDIT_CODES as Record<string, string>)[code], code);
    }
  });
});
