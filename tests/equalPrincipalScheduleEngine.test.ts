/**
 * Tests: equal principal schedule engine (Step 5-A).
 * Covers the 20 required scenarios. The locked engines run for real.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildEqualPrincipalSchedule,
  EQUAL_PRINCIPAL_SCHEDULE_AUDIT_CODES as ES,
  type EqualPrincipalScheduleInput,
} from '../src/engines/equalPrincipalScheduleEngine';
import { PAYMENT_ALLOCATION_AUDIT_CODES as PA } from '../src/engines/paymentAllocationEngine';
import { RECALC_ROW_AUDIT_CODES as RB } from '../src/engines/recalcRowBuilder';
import { VALIDATION_AUDIT_CODES as C } from '../src/domain/auditFactories';
import { toISODate } from '../src/domain/dateTypes';
import type { RateConfig, Law128Status } from '../src/domain/rateTypes';

const D = toISODate;

const fixed6: RateConfig = {
  regime: { kind: 'fixed', annualRatePercent: 6 },
  law128: { kind: 'included_in_rate', ratePercent: null },
  dayCount: 'ACT_360',
};

const floatingShortHistory = (law128?: Law128Status): RateConfig => ({
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
        to: D('2024-02-29'), // covers only the first two due dates
        indexValuePercent: 3.9,
        totalAppliedRatePercent: null,
        source: 'bank_statement',
      },
    ],
  },
  law128: law128 ?? { kind: 'included_in_rate', ratePercent: null },
  dayCount: 'ACT_360',
});

const fullHistoryLaw128Unknown: RateConfig = {
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
  law128: { kind: 'unknown' },
  dayCount: 'ACT_360',
};

const build = (overrides: Partial<EqualPrincipalScheduleInput> = {}) =>
  buildEqualPrincipalSchedule({
    principalCents: 900_000, // €9,000
    termPeriods: 3,
    firstPeriodStartDate: D('2024-01-01'),
    firstDueDate: D('2024-01-31'),
    paymentFrequency: 'monthly',
    rateConfig: fixed6,
    dayCountConvention: 'ACT_360',
    feesAndPremiumsPerPeriodCents: 0,
    ...overrides,
  });

/* ------------------------------------------------------------------ */
/* core behavior                                                       */
/* ------------------------------------------------------------------ */

describe('equalPrincipalScheduleEngine: core behavior', () => {
  it('basic 3-period schedule: €9,000, fixed 6%, total principal exact, final 0 (test 1)', () => {
    const r = build();
    assert.equal(r.status, 'success');
    assert.equal(r.rows.length, 3);
    assert.equal(r.totalPrincipalCents, 900_000); // exact
    assert.equal(r.finalClosingBalanceCents, 0);
    // equal planned principal: 300,000 cents each
    for (const row of r.rows) assert.equal(row.principal.cents, 300_000);
    // due dates: monthly with end-of-month clamping
    assert.deepEqual(
      r.rows.map((x) => x.dueDate),
      ['2024-01-31', '2024-02-29', '2024-03-29'],
    );
  });

  it('cents distribution: 10000 cents over 3 periods sums exactly, earliest get the extra (test 2)', () => {
    const r = build({ principalCents: 10_000, termPeriods: 3 });
    assert.equal(r.status, 'success');
    // floor(10000/3)=3333, remainder 1 -> first period 3334
    assert.deepEqual(
      r.rows.map((x) => x.principal.cents),
      [3_334, 3_333, 3_333],
    );
    assert.equal(r.totalPrincipalCents, 10_000); // no cent lost
    assert.equal(r.finalClosingBalanceCents, 0);
  });

  it('opening balance of row N equals closing balance of row N-1 (test 3)', () => {
    const r = build({ principalCents: 1_234_567, termPeriods: 5 });
    assert.equal(r.status, 'success');
    for (let i = 1; i < r.rows.length; i++) {
      assert.equal(r.rows[i]!.openingBalance.cents, r.rows[i - 1]!.closingBalance.cents);
    }
    assert.equal(r.totalPrincipalCents, 1_234_567);
    assert.equal(r.finalClosingBalanceCents, 0);
  });

  it('interest decreases over time under fixed rate (test 4)', () => {
    // use dates with equal 30-day-ish months; strictly decreasing balance
    // guarantees non-increasing interest except for day-count variation,
    // so compare per-day interest to be robust:
    const r = build({ principalCents: 1_200_000, termPeriods: 4 });
    assert.equal(r.status, 'success');
    const perDay = r.rows.map((x) => x.interest.cents / x.dayCountDays);
    for (let i = 1; i < perDay.length; i++) {
      assert.ok(perDay[i]! < perDay[i - 1]!, 'per-day interest must decrease');
    }
  });

  it('totals: installments = principal + interest + fees (test 5)', () => {
    const r = build({ feesAndPremiumsPerPeriodCents: 1_500 }); // €15/period
    assert.equal(r.status, 'success');
    assert.equal(r.totalFeesCents, 4_500); // 3 × €15
    assert.equal(
      r.totalInstallmentsCents,
      (r.totalPrincipalCents ?? 0) + (r.totalInterestCents ?? 0) + (r.totalFeesCents ?? 0),
    );
    // and per-row: installment = planned principal + interest + fees
    for (const row of r.rows) {
      assert.equal(row.installment.cents, row.principal.cents + row.interest.cents + 1_500);
    }
  });
});

/* ------------------------------------------------------------------ */
/* input validation                                                    */
/* ------------------------------------------------------------------ */

describe('equalPrincipalScheduleEngine: input validation', () => {
  it('missing principal -> missing_data (test 6)', () => {
    const r = build({ principalCents: null });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.rows.length, 0);
    assert.equal(r.totalPrincipalCents, null); // null, not 0
    assert.ok(r.auditEntries.some((e) => e.code === ES.SCHEDULE_PRINCIPAL_MISSING));
  });

  it('missing term -> missing_data (test 7)', () => {
    const r = build({ termPeriods: null });
    assert.equal(r.status, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === ES.SCHEDULE_TERM_MISSING));
  });

  it('invalid term <= 0 or non-integer -> requires_review (test 8)', () => {
    for (const bad of [0, -3, 2.5]) {
      const r = build({ termPeriods: bad });
      assert.equal(r.status, 'requires_review');
      assert.equal(r.rows.length, 0);
      assert.ok(r.auditEntries.some((e) => e.code === ES.SCHEDULE_TERM_INVALID));
    }
  });

  it('explicit zero principal -> success, empty schedule, explicit zero totals', () => {
    const r = build({ principalCents: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.rows.length, 0);
    assert.equal(r.totalPrincipalCents, 0); // explicit zero, not null
    assert.equal(r.finalClosingBalanceCents, 0);
    assert.ok(r.auditEntries.some((e) => e.code === ES.SCHEDULE_PRINCIPAL_EXPLICIT_ZERO));
  });
});

/* ------------------------------------------------------------------ */
/* upstream propagation                                                */
/* ------------------------------------------------------------------ */

describe('equalPrincipalScheduleEngine: upstream propagation', () => {
  it('missing rate period mid-schedule -> missing_data, prior rows kept, totals null (test 9)', () => {
    // history covers due dates 1-2 only; period 3 (2024-03-29) is uncovered
    const r = build({ rateConfig: floatingShortHistory() });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.rows.length, 2); // partial rows preserved
    assert.equal(r.totalPrincipalCents, null); // totals not finalized
    assert.equal(r.finalClosingBalanceCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === C.RATE_HISTORY_MISSING));
    const abort = r.auditEntries.find((e) => e.code === ES.SCHEDULE_ABORTED_AT_ROW);
    assert.ok(abort);
    assert.equal((abort.context as Record<string, unknown>)['period'], 3);
  });

  it('Law128 unknown preview -> full schedule, status requires_review, never success (test 10)', () => {
    const r = build({ rateConfig: fullHistoryLaw128Unknown });
    assert.equal(r.status, 'requires_review');
    assert.notEqual(r.status, 'success' as never);
    assert.equal(r.rows.length, 3); // preview rows produced
    assert.equal(r.finalClosingBalanceCents, 0);
    assert.ok(r.auditEntries.some((e) => e.code === C.LAW128_UNKNOWN));
    assert.ok(r.auditEntries.some((e) => e.code === RB.ROW_PREVIEW_REQUIRES_REVIEW));
  });

  it('null fees -> FEES_ASSUMED_ZERO present (test 11)', () => {
    const r = build({ feesAndPremiumsPerPeriodCents: null });
    assert.equal(r.status, 'success');
    const e = r.auditEntries.find((x) => x.code === PA.FEES_ASSUMED_ZERO);
    assert.ok(e);
    assert.equal(e.severity, 'assumption');
  });

  it('explicit zero fees -> no FEES_ASSUMED_ZERO (test 12)', () => {
    const r = build({ feesAndPremiumsPerPeriodCents: 0 });
    assert.equal(r.auditEntries.some((e) => e.code === PA.FEES_ASSUMED_ZERO), false);
  });
});

/* ------------------------------------------------------------------ */
/* invariants                                                          */
/* ------------------------------------------------------------------ */

describe('equalPrincipalScheduleEngine: invariants', () => {
  it('final closing balance never negative (test 13)', () => {
    const cases = [
      build(),
      build({ principalCents: 1, termPeriods: 1 }),
      build({ principalCents: 999_999, termPeriods: 7 }),
    ];
    for (const r of cases) {
      assert.ok((r.finalClosingBalanceCents ?? 0) >= 0);
      for (const row of r.rows) assert.ok(row.closingBalance.cents >= 0);
    }
  });

  it('last row closes to exactly zero (test 14)', () => {
    for (const r of [
      build(),
      build({ principalCents: 10_001, termPeriods: 3 }),
      build({ principalCents: 123_457, termPeriods: 11 }),
    ]) {
      assert.equal(r.status, 'success');
      assert.equal(r.rows[r.rows.length - 1]!.closingBalance.cents, 0);
      assert.equal(r.finalClosingBalanceCents, 0);
    }
  });

  it('audit entries are preserved with row context, aggregated without spam (test 15)', () => {
    const r = build({ feesAndPremiumsPerPeriodCents: null, rateConfig: fullHistoryLaw128Unknown });
    // LAW128_UNKNOWN happens on every row but appears ONCE, aggregated:
    const law = r.auditEntries.filter((e) => e.code === C.LAW128_UNKNOWN);
    assert.equal(law.length, 1);
    const ctx = law[0]!.context as Record<string, unknown>;
    assert.deepEqual(ctx['rowIds'], ['EP-001', 'EP-002', 'EP-003']);
    assert.equal(ctx['occurrences'], 3);
    // allocation-level assumption also aggregated with row context:
    const fees = r.auditEntries.filter((e) => e.code === PA.FEES_ASSUMED_ZERO);
    assert.equal(fees.length, 1);
    assert.equal((fees[0]!.context as Record<string, unknown>)['occurrences'], 3);
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('equalPrincipalScheduleEngine: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/engines/equalPrincipalScheduleEngine.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no equal-installment / annuity formula exists (test 16)', () => {
    assert.equal(/Math\.pow|\*\*\s*term|annuit/i.test(codeOnly), false);
    // no constant-installment solving: payment is built additively
    assert.ok(/plannedPrincipal\(i\)\s*\+\s*accrual\.interestCents/.test(codeOnly));
  });

  it('no interest-only or balloon logic exists (test 17)', () => {
    assert.equal(/interest[_-]?only|balloon/i.test(codeOnly), false);
  });

  it('no comparison / economicDifference logic exists (test 18)', () => {
    assert.equal(/economicDifference|ComparisonRow|bankInstallment|bankBalance/i.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula exists (test 19)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });

  it('interest formula is not duplicated; interest comes from the accrual engine (test 20)', () => {
    assert.equal(/fractionOfYear\s*\*|\*\s*fraction|ratePercent\s*\/\s*100|toPrecision/.test(codeOnly), false);
    assert.ok(/calculateAccruedInterest/.test(codeOnly)); // locked engine used
    // behavior check: row interest equals an independent accrual run
    const r = build();
    assert.equal(r.rows[0]!.interest.cents, 4_500); // 9000€ * 6% * 30/360 = €45
  });
});
