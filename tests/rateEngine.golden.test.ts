/**
 * Loan Audit PRO — tests/rateEngine.golden.test.ts
 * ------------------------------------------------------------------
 * Step 2-B: golden verification fixtures for the rate engine.
 * Verification ONLY: no amortization, no installments, no interest
 * amounts, no money calculations. Independent of Ν.3869/2010 and
 * ΑΠ 6/2026.
 *
 * Runner: node:test via tsx (registry unavailable; structure is
 * vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveRateForDate } from '../src/engines/rateEngine';
import { VALIDATION_AUDIT_CODES as C } from '../src/domain/auditFactories';
import {
  TARGET_DATE,
  goldenFixedConfig,
  goldenFloatingConfig,
  goldenPeriod,
} from './fixtures/rateFixtures';
import { toISODate } from '../src/domain/dateTypes';

const close = (actual: number | null, expected: number, eps = 1e-9): void => {
  assert.ok(actual !== null, `expected ${expected}, got null`);
  assert.ok(
    Math.abs(actual - expected) < eps,
    `expected ${actual} ≈ ${expected} (±${eps})`,
  );
};

describe('rateEngine golden: fixed rates', () => {
  it('G1: fixed 6.10 with Ν.128/75 included — result 6.10, NEVER 6.70', () => {
    const r = resolveRateForDate(
      goldenFixedConfig(6.1, { kind: 'included_in_rate', ratePercent: 0.6 }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'success');
    close(r.appliedAnnualRatePercent, 6.1);
    close(r.law128Percent, 0); // 0 for addition purposes
    close(r.totalBeforeLaw128Percent, 6.1);
    close(r.totalAfterLaw128Percent, 6.1);
    // the configured-but-included 0.60 must not be re-added:
    assert.ok(Math.abs((r.appliedAnnualRatePercent ?? 0) - 6.7) > 1e-9, 'must NOT produce 6.70');
  });

  it('G2: fixed 5.50 + Ν.128/75 0.60 added separately — result 6.10', () => {
    const r = resolveRateForDate(
      goldenFixedConfig(5.5, { kind: 'added_separately', ratePercent: 0.6 }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'success');
    close(r.law128Percent, 0.6);
    close(r.totalBeforeLaw128Percent, 5.5);
    close(r.totalAfterLaw128Percent, 6.1);
    close(r.appliedAnnualRatePercent, 6.1);
  });
});

describe('rateEngine golden: floating rates', () => {
  it('G3: Euribor 3M 3.971636 + spread 2.00 + Ν.128/75 0.12 — 6.091636', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({
        indexValuePercent: 3.971636,
        spreadPercent: 2.0,
        law128: { kind: 'added_separately', ratePercent: 0.12 },
      }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'success');
    close(r.nominalIndexPercent, 3.971636);
    close(r.effectiveIndexPercent, 3.971636);
    close(r.spreadPercent, 2.0);
    close(r.law128Percent, 0.12);
    close(r.totalBeforeLaw128Percent, 5.971636);
    close(r.totalAfterLaw128Percent, 6.091636);
    close(r.appliedAnnualRatePercent, 6.091636);
  });

  it('G4: same index/spread, Ν.128/75 included — 5.971636, 0.12 NOT re-added', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({
        indexValuePercent: 3.971636,
        spreadPercent: 2.0,
        law128: { kind: 'included_in_rate', ratePercent: 0.12 },
      }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'success');
    close(r.law128Percent, 0);
    close(r.appliedAnnualRatePercent, 5.971636);
    assert.ok(
      Math.abs((r.appliedAnnualRatePercent ?? 0) - 6.091636) > 1e-9,
      'must NOT add 0.12 again',
    );
  });
});

describe('rateEngine golden: negative index policies', () => {
  const negativeArgs = {
    indexValuePercent: -0.5,
    spreadPercent: 3.0,
    law128: { kind: 'added_separately', ratePercent: 0.6 } as const,
  };

  it('G5: -0.50 with as_is — effective -0.50, applied 3.10', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({ ...negativeArgs, negativeEuriborPolicy: 'as_is' }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'success');
    close(r.effectiveIndexPercent, -0.5);
    close(r.totalBeforeLaw128Percent, 2.5);
    close(r.appliedAnnualRatePercent, 3.1);
  });

  it('G6: -0.50 with floor_zero — effective 0, applied 3.60, explicit audit entry', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({ ...negativeArgs, negativeEuriborPolicy: 'floor_zero' }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'success');
    close(r.nominalIndexPercent, -0.5);
    close(r.effectiveIndexPercent, 0);
    close(r.totalBeforeLaw128Percent, 3.0);
    close(r.appliedAnnualRatePercent, 3.6);
    // flooring must be explicit in the audit trail, never silent:
    const e = r.auditEntries.find(
      (x) => x.severity === 'info' && x.message.includes('floor_zero'),
    );
    assert.ok(e, 'expected explicit floor_zero audit entry');
  });

  it('G7: -0.50 with unknown policy — requires_review, applied null, no silent floor', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({ ...negativeArgs, negativeEuriborPolicy: 'unknown' }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'requires_review');
    assert.equal(r.appliedAnnualRatePercent, null);
    assert.equal(r.effectiveIndexPercent, null); // neither -0.50 nor 0 chosen
    close(r.nominalIndexPercent, -0.5); // the fact stays visible
    const e = r.auditEntries.find((x) => x.code === C.NEGATIVE_INDEX_POLICY_UNKNOWN);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
    // no silent floor: a floored result would have been 3.60
    assert.notEqual(r.appliedAnnualRatePercent, 3.6);
  });
});

describe('rateEngine golden: Ν.128/75 unknown preview', () => {
  it('G8: unknown Ν.128/75 — preview 5.971636, requires_review, never success', () => {
    // Note: in the domain model the 'unknown' status deliberately
    // carries NO ratePercent — an unconfirmed levy value (e.g. 0.12)
    // cannot be attached to an unknown status by design, so it cannot
    // leak into the arithmetic.
    const r = resolveRateForDate(
      goldenFloatingConfig({
        indexValuePercent: 3.971636,
        spreadPercent: 2.0,
        law128: { kind: 'unknown' },
      }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'requires_review');
    assert.notEqual(r.status, 'success'); // never success
    close(r.appliedAnnualRatePercent, 5.971636); // preview BEFORE levy
    assert.equal(r.law128Percent, null); // not applied, not zeroed
    assert.equal(r.totalAfterLaw128Percent, null);
    const e = r.auditEntries.find((x) => x.code === C.LAW128_UNKNOWN);
    assert.ok(e);
  });
});

describe('rateEngine golden: missing data', () => {
  it('G9: no applicable period — missing_data, RATE_HISTORY_MISSING, no nearest-rate', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({
        indexValuePercent: 3.9,
        spreadPercent: 2.0,
        law128: { kind: 'added_separately', ratePercent: 0.12 },
        rateHistory: [
          goldenPeriod(3.9, { from: toISODate('2023-01-01'), to: toISODate('2023-06-30') }),
        ],
      }),
      TARGET_DATE, // 2024-03-15: outside the only period
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.appliedAnnualRatePercent, null);
    assert.equal(r.nominalIndexPercent, null); // 3.9 from 2023 must NOT leak
    assert.ok(r.auditEntries.some((x) => x.code === C.RATE_HISTORY_MISSING));
  });

  it('G10: applicable period with null index — missing_data, null is not 0', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({
        indexValuePercent: null,
        spreadPercent: 2.0,
        law128: { kind: 'added_separately', ratePercent: 0.12 },
      }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.appliedAnnualRatePercent, null);
    assert.equal(r.nominalIndexPercent, null);
    // if null had been treated as 0: 0 + 2.00 + 0.12 = 2.12
    assert.notEqual(r.appliedAnnualRatePercent, 2.12);
    assert.equal(r.totalBeforeLaw128Percent, null);
    assert.ok(r.auditEntries.some((x) => x.code === C.MISSING_INDEX_VALUE));
  });
});

describe('rateEngine golden: precision', () => {
  it('G11: 3.9716364 + 2.123456 + 0.12 preserves full precision, no 2-decimal rounding', () => {
    const r = resolveRateForDate(
      goldenFloatingConfig({
        indexValuePercent: 3.9716364,
        spreadPercent: 2.123456,
        law128: { kind: 'added_separately', ratePercent: 0.12 },
      }),
      TARGET_DATE,
    );
    assert.equal(r.status, 'success');
    close(r.totalBeforeLaw128Percent, 6.0950924, 1e-9);
    close(r.appliedAnnualRatePercent, 6.2150924, 1e-9);
    // engine must not have rounded to 2 decimals:
    assert.notEqual(r.appliedAnnualRatePercent, 6.22);
    assert.notEqual(r.appliedAnnualRatePercent, 6.21);
  });
});

describe('rateEngine golden: documentation guard', () => {
  const here = dirname(fileURLToPath(import.meta.url));

  it('G12: economic-difference sign convention is documented and unchanged', () => {
    const comparisonTypes = readFileSync(
      join(here, '../src/domain/comparisonTypes.ts'),
      'utf8',
    );
    // convention: economicDifference = bankOrFundAmount - recalculatedAmount
    assert.ok(
      /economicDifference\s*=\s*bank\s*(value)?\s*[−-]\s*recalculated/i.test(comparisonTypes),
      'comparisonTypes.ts must document economicDifference = bank − recalculated',
    );
    assert.ok(
      /[>＞]\s*0.*bank.*(higher|υψηλότερ)/is.test(comparisonTypes) ||
        /θετικ/i.test(comparisonTypes) ||
        /Positive/i.test(comparisonTypes),
      'positive-sign meaning must be documented',
    );

    const readme = readFileSync(join(here, '../README.md'), 'utf8');
    assert.ok(
      readme.includes('economicDifference = bankOrFundAmount − recalculatedAmount'),
      'README must state the sign convention',
    );
    assert.ok(readme.includes('Θετική τιμή'), 'README must explain the positive sign');
    assert.ok(readme.includes('Αρνητική τιμή'), 'README must explain the negative sign');
  });
});
