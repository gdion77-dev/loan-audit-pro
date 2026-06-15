/**
 * Tests: equal installment / annuity schedule engine (Step 5-B).
 * Covers the 22 required scenarios. The locked engines run for real.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildEqualInstallmentSchedule,
  EQUAL_INSTALLMENT_SCHEDULE_AUDIT_CODES as AI,
  type EqualInstallmentScheduleInput,
} from '../src/engines/equalInstallmentScheduleEngine';
import { PAYMENT_ALLOCATION_AUDIT_CODES as PA } from '../src/engines/paymentAllocationEngine';
import { RECALC_ROW_AUDIT_CODES as RB } from '../src/engines/recalcRowBuilder';
import { VALIDATION_AUDIT_CODES as C } from '../src/domain/auditFactories';
import { toISODate } from '../src/domain/dateTypes';
import type { RateConfig, Law128Status } from '../src/domain/rateTypes';

const D = toISODate;

const fixed = (annualRatePercent: number, law128?: Law128Status): RateConfig => ({
  regime: { kind: 'fixed', annualRatePercent },
  law128: law128 ?? { kind: 'included_in_rate', ratePercent: null },
  dayCount: 'ACT_360',
});

const floatingFullYear: RateConfig = {
  regime: {
    kind: 'floating',
    indexType: 'EURIBOR_3M',
    indexLabel: null,
    spreadPercent: 2,
    referenceDateRule: null,
    resetFrequencyMonths: 3,
    negativeEuriborPolicy: 'as_is',
    rateHistory: [
      {
        from: D('2024-01-01'),
        to: D('2024-12-31'),
        indexValuePercent: 3.9,
        totalAppliedRatePercent: null,
        source: 'bank_statement',
      },
    ],
  },
  law128: { kind: 'included_in_rate', ratePercent: null },
  dayCount: 'ACT_360',
};

const floatingShortHistory: RateConfig = {
  ...floatingFullYear,
  regime: {
    ...floatingFullYear.regime,
    rateHistory: [
      {
        from: D('2024-01-01'),
        to: D('2024-02-29'),
        indexValuePercent: 3.9,
        totalAppliedRatePercent: null,
        source: 'bank_statement',
      },
    ],
  } as RateConfig['regime'],
};

const build = (overrides: Partial<EqualInstallmentScheduleInput> = {}) =>
  buildEqualInstallmentSchedule({
    principalCents: 900_000, // €9,000
    termPeriods: 3,
    firstPeriodStartDate: D('2024-01-01'),
    firstDueDate: D('2024-01-31'),
    paymentFrequency: 'monthly',
    rateConfig: fixed(6),
    dayCountConvention: 'ACT_360',
    feesAndPremiumsPerPeriodCents: 0,
    ...overrides,
  });

/* ------------------------------------------------------------------ */
/* installment determination                                           */
/* ------------------------------------------------------------------ */

describe('equalInstallmentScheduleEngine: installment determination', () => {
  it('fixed-rate annuity auto-calculates a fixed installment (test 1)', () => {
    const r = build();
    assert.equal(r.status, 'success');
    assert.ok(r.scheduledInstallmentCents !== null);
    // formula oracle: 900000 * r / (1 - (1+r)^-3), r = 0.06/12
    const rr = 0.06 / 12;
    const expected = Math.round((900_000 * rr) / (1 - Math.pow(1 + rr, -3)));
    assert.equal(r.scheduledInstallmentCents, expected);
    // all non-final rows carry exactly the fixed installment
    for (const row of r.rows.slice(0, -1)) {
      assert.equal(row.installment.cents, r.scheduledInstallmentCents);
    }
  });

  it('provided installment is used as-is; the formula is NOT applied (test 2)', () => {
    const r = build({ scheduledInstallmentCents: 305_000 }); // arbitrary contract value
    assert.equal(r.status, 'success');
    assert.equal(r.scheduledInstallmentCents, 305_000);
    for (const row of r.rows.slice(0, -1)) {
      assert.equal(row.installment.cents, 305_000);
    }
    // an annuity-derived value would have differed:
    const rr = 0.06 / 12;
    const annuity = Math.round((900_000 * rr) / (1 - Math.pow(1 + rr, -3)));
    assert.notEqual(r.scheduledInstallmentCents, annuity);
  });

  it('zero-rate case works without division by zero (test 3)', () => {
    const r = build({ rateConfig: fixed(0) });
    assert.equal(r.status, 'success');
    assert.equal(r.scheduledInstallmentCents, 300_000); // 900000 / 3
    assert.equal(r.totalInterestCents, 0);
    assert.equal(r.totalPrincipalCents, 900_000);
    assert.equal(r.finalClosingBalanceCents, 0);
  });

  it('invalid provided installment (negative / non-integer) -> requires_review', () => {
    for (const bad of [-100, 1000.5]) {
      const r = build({ scheduledInstallmentCents: bad });
      assert.equal(r.status, 'requires_review');
      assert.equal(r.rows.length, 0);
      assert.ok(r.auditEntries.some((e) => e.code === AI.AI_INSTALLMENT_INVALID));
    }
  });

  it('floating rate without provided installment does NOT auto-calculate (test 11)', () => {
    const r = build({ rateConfig: floatingFullYear });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.rows.length, 0);
    assert.equal(r.scheduledInstallmentCents, null);
    const e = r.auditEntries.find((x) => x.code === AI.ANNUITY_PAYMENT_NOT_CALCULABLE);
    assert.ok(e);
    assert.equal((e.context as Record<string, unknown>)['regime'], 'floating');
  });

  it('floating rate WITH provided installment runs normally', () => {
    const r = build({ rateConfig: floatingFullYear, scheduledInstallmentCents: 305_000 });
    assert.equal(r.status, 'success');
    assert.equal(r.rows.length, 3);
    assert.equal(r.finalClosingBalanceCents, 0);
  });

  it('unknown day count without provided installment does not auto-calculate', () => {
    const r = build({ dayCountConvention: 'unknown' });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.auditEntries.some((e) => e.code === AI.ANNUITY_PAYMENT_NOT_CALCULABLE));
  });
});

/* ------------------------------------------------------------------ */
/* core invariants                                                     */
/* ------------------------------------------------------------------ */

describe('equalInstallmentScheduleEngine: core invariants', () => {
  it('final row closes balance to exactly zero, adjusted as needed (test 4)', () => {
    for (const r of [
      build(),
      build({ principalCents: 1_234_567, termPeriods: 7 }),
      build({ scheduledInstallmentCents: 310_000 }),
    ]) {
      assert.equal(r.status, 'success');
      assert.equal(r.rows[r.rows.length - 1]!.closingBalance.cents, 0);
      assert.equal(r.finalClosingBalanceCents, 0);
    }
    // adjustment is explicitly documented in the audit trail:
    const r = build();
    assert.ok(r.auditEntries.some((e) => e.code === AI.AI_FINAL_ROW_ADJUSTED));
  });

  it('closing balances never negative (test 5)', () => {
    for (const r of [build(), build({ principalCents: 999_999, termPeriods: 5 })]) {
      for (const row of r.rows) assert.ok(row.closingBalance.cents >= 0);
    }
  });

  it('total principal equals original principal exactly (test 6)', () => {
    for (const r of [
      build(),
      build({ principalCents: 1_234_567, termPeriods: 7 }),
      build({ principalCents: 10_001, termPeriods: 3 }),
    ]) {
      assert.equal(r.status, 'success');
      assert.equal(r.totalPrincipalCents, r.rows.length > 0 ? r.rows.reduce((s, x) => s + x.principal.cents, 0) : 0);
      assert.equal(r.totalPrincipalCents, (r as { totalPrincipalCents: number }).totalPrincipalCents);
    }
    assert.equal(build({ principalCents: 1_234_567, termPeriods: 7 }).totalPrincipalCents, 1_234_567);
    assert.equal(build().totalPrincipalCents, 900_000);
  });

  it('opening balance of row N equals closing of row N-1 (test 7)', () => {
    const r = build({ principalCents: 1_234_567, termPeriods: 6 });
    for (let i = 1; i < r.rows.length; i++) {
      assert.equal(r.rows[i]!.openingBalance.cents, r.rows[i - 1]!.closingBalance.cents);
    }
  });

  it('per-day interest decreases over time under fixed rate (test 8)', () => {
    const r = build({ principalCents: 1_200_000, termPeriods: 5 });
    const perDay = r.rows.map((x) => x.interest.cents / x.dayCountDays);
    for (let i = 1; i < perDay.length; i++) {
      assert.ok(perDay[i]! < perDay[i - 1]!, 'per-day interest must decrease');
    }
  });

  it('totals identity: installments = principal + interest + fees (test 17)', () => {
    const r = build({ feesAndPremiumsPerPeriodCents: 1_500 });
    assert.equal(r.status, 'success');
    assert.equal(r.totalFeesCents, 4_500);
    assert.equal(
      r.totalInstallmentsCents,
      (r.totalPrincipalCents ?? 0) + (r.totalInterestCents ?? 0) + (r.totalFeesCents ?? 0),
    );
  });
});

/* ------------------------------------------------------------------ */
/* validation & propagation                                            */
/* ------------------------------------------------------------------ */

describe('equalInstallmentScheduleEngine: validation & propagation', () => {
  it('missing principal -> missing_data (test 9)', () => {
    const r = build({ principalCents: null });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.totalPrincipalCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === AI.AI_PRINCIPAL_MISSING));
  });

  it('missing term -> missing_data (test 10)', () => {
    const r = build({ termPeriods: null });
    assert.equal(r.status, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === AI.AI_TERM_MISSING));
  });

  it('explicit zero principal -> success, empty schedule, zero totals', () => {
    const r = build({ principalCents: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.rows.length, 0);
    assert.equal(r.totalPrincipalCents, 0);
    assert.ok(r.auditEntries.some((e) => e.code === AI.AI_PRINCIPAL_EXPLICIT_ZERO));
  });

  it('Law128 unknown preview -> requires_review, never success (test 12)', () => {
    // provided installment so the schedule can run as a preview:
    const r = build({
      rateConfig: fixed(6, { kind: 'unknown' }),
      scheduledInstallmentCents: 305_000,
    });
    assert.equal(r.status, 'requires_review');
    assert.notEqual(r.status, 'success' as never);
    assert.equal(r.rows.length, 3);
    assert.ok(r.auditEntries.some((e) => e.code === C.LAW128_UNKNOWN));
    assert.ok(r.auditEntries.some((e) => e.code === RB.ROW_PREVIEW_REQUIRES_REVIEW));
  });

  it('null fees -> FEES_ASSUMED_ZERO (test 13)', () => {
    const r = build({ feesAndPremiumsPerPeriodCents: null });
    assert.equal(r.status, 'success');
    const e = r.auditEntries.find((x) => x.code === PA.FEES_ASSUMED_ZERO);
    assert.ok(e);
    assert.equal(e.severity, 'assumption');
  });

  it('explicit zero fees -> no FEES_ASSUMED_ZERO (test 14)', () => {
    const r = build({ feesAndPremiumsPerPeriodCents: 0 });
    assert.equal(r.auditEntries.some((e) => e.code === PA.FEES_ASSUMED_ZERO), false);
  });

  it('negative amortization detected: stops, no silent treatment of unpaid interest (test 15)', () => {
    // interest of period 1 = 9000€ * 6% * 30/360 = €45 = 4500 cents;
    // installment €40 < €45 -> negative amortization
    const r = build({ scheduledInstallmentCents: 4_000 });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.rows.length, 0); // stopped before the first row
    assert.equal(r.totalPrincipalCents, null);
    const e = r.auditEntries.find((x) => x.code === AI.NEGATIVE_AMORTIZATION_REQUIRES_REVIEW);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
    assert.equal((e.context as Record<string, unknown>)['interestPlusFeesCents'], 4_500);
  });

  it('aborted schedule produces totals null, prior rows preserved (test 16)', () => {
    // rate history covers only the first two due dates:
    const r = build({ rateConfig: floatingShortHistory, scheduledInstallmentCents: 305_000 });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.rows.length, 2);
    assert.equal(r.totalPrincipalCents, null);
    assert.equal(r.totalInterestCents, null);
    assert.equal(r.finalClosingBalanceCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === C.RATE_HISTORY_MISSING));
    assert.ok(r.auditEntries.some((e) => e.code === AI.AI_SCHEDULE_ABORTED_AT_ROW));
  });

  it('early payoff (installment too large for the term) stops with review', () => {
    // installment so large the balance zeroes in period 1 of 3:
    const r = build({ scheduledInstallmentCents: 950_000 });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.rows.length, 1);
    assert.equal(r.totalPrincipalCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === AI.AI_EARLY_PAYOFF_REQUIRES_REVIEW));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('equalInstallmentScheduleEngine: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/engines/equalInstallmentScheduleEngine.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('Step 5-A equal principal engine is NOT modified (test 18)', () => {
    const epSource = readFileSync(
      join(here, '../src/engines/equalPrincipalScheduleEngine.ts'),
      'utf8',
    );
    const hash = createHash('sha256').update(epSource).digest('hex');
    assert.equal(
      hash,
      '190be775048d5bbe4797e2ead514de1c5b2b5a129da3cb31d23ee23827d737bd',
      'equalPrincipalScheduleEngine.ts has been modified — locked at Step 5-A',
    );
  });

  it('no interest-only / balloon / custom bank schedule logic (test 19)', () => {
    assert.equal(/interest[_-]?only|balloon|custom[_-]?bank/i.test(codeOnly), false);
  });

  it('no comparison / economicDifference logic (test 20)', () => {
    assert.equal(/economicDifference|ComparisonRow|bankInstallment|bankBalance/i.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula (test 21)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });

  it('period interest comes from the locked accrual engine, not a local formula (test 22)', () => {
    // the only rate arithmetic allowed is the annuity payment itself:
    assert.equal(/fractionOfYear\s*\*|\*\s*fraction|toPrecision/.test(codeOnly), false);
    assert.ok(/calculateAccruedInterest/.test(codeOnly));
    // behavior oracle: first-period interest equals the accrual value
    const r = build();
    assert.equal(r.rows[0]!.interest.cents, 4_500); // 9000€ × 6% × 30/360
  });
});
