/**
 * Tests: single recalculation row builder (Step 4-B).
 * Covers the 19 required scenarios. The four locked engines are
 * composed for real (no mocks).
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
  buildSingleRecalcRow,
  RECALC_ROW_AUDIT_CODES as RB,
  type SingleRecalcRowInput,
} from '../src/engines/recalcRowBuilder';
import { PAYMENT_ALLOCATION_AUDIT_CODES as PA } from '../src/engines/paymentAllocationEngine';
import { INTEREST_ACCRUAL_AUDIT_CODES as IC } from '../src/engines/interestAccrualEngine';
import { DAY_COUNT_AUDIT_CODES as DC } from '../src/engines/dayCountEngine';
import { VALIDATION_AUDIT_CODES as C } from '../src/domain/auditFactories';
import { toISODate } from '../src/domain/dateTypes';
import type { RateConfig, Law128Status, NegativeEuriborPolicy } from '../src/domain/rateTypes';

const D = toISODate;

const fixed6: RateConfig = {
  regime: { kind: 'fixed', annualRatePercent: 6 },
  law128: { kind: 'included_in_rate', ratePercent: null },
  dayCount: 'ACT_360',
};

function floatingConfig(args: {
  indexValuePercent: number | null;
  spreadPercent: number;
  negativeEuriborPolicy?: NegativeEuriborPolicy;
  law128?: Law128Status;
  emptyHistory?: boolean;
}): RateConfig {
  return {
    regime: {
      kind: 'floating',
      indexType: 'EURIBOR_3M',
      indexLabel: null,
      spreadPercent: args.spreadPercent,
      referenceDateRule: null,
      resetFrequencyMonths: 3,
      negativeEuriborPolicy: args.negativeEuriborPolicy ?? 'as_is',
      rateHistory: args.emptyHistory
        ? []
        : [
            {
              from: D('2024-01-01'),
              to: D('2024-06-30'),
              indexValuePercent: args.indexValuePercent,
              totalAppliedRatePercent: null,
              source: 'bank_statement',
            },
          ],
    },
    law128: args.law128 ?? { kind: 'included_in_rate', ratePercent: null },
    dayCount: 'ACT_360',
  };
}

const build = (overrides: Partial<SingleRecalcRowInput> = {}) =>
  buildSingleRecalcRow({
    rowId: 'R-001',
    periodStartDate: D('2024-01-01'),
    dueDate: D('2024-01-31'), // 30 days ACT (start excluded, end included)
    openingBalanceCents: 1_000_000, // €10,000
    paymentAmountCents: 50_000, // €500
    feesAndPremiumsCents: 0,
    rateConfig: fixed6,
    dayCountConvention: 'ACT_360',
    ...overrides,
  });

/* ------------------------------------------------------------------ */
/* happy paths                                                         */
/* ------------------------------------------------------------------ */

describe('recalcRowBuilder: happy paths', () => {
  it('normal successful row: €10,000 / 6% / 30/360 / payment €500 (test 1)', () => {
    const r = build();
    assert.equal(r.status, 'success');
    assert.ok(r.row);
    assert.equal(r.row.rowId, 'R-001');
    assert.equal(r.row.dueDate, '2024-01-31');
    assert.equal(r.row.openingBalance.cents, 1_000_000);
    assert.equal(r.row.interest.cents, 5_000); // €50
    assert.equal(r.row.principal.cents, 45_000); // €450
    assert.equal(r.row.installment.cents, 50_000); // €500
    assert.equal(r.row.closingBalance.cents, 955_000); // €9,550
    assert.equal(r.row.dayCountDays, 30);
    assert.equal(r.row.appliedAnnualRatePercent, 6);
    assert.equal(r.row.rateBreakdown.totalPercent, 6);
  });

  it('fees first row: fees €20 / payment €500 (test 2)', () => {
    const r = build({ feesAndPremiumsCents: 2_000 });
    assert.equal(r.status, 'success');
    assert.ok(r.row && r.allocation);
    assert.equal(r.allocation.allocatedToFeesCents, 2_000); // €20
    assert.equal(r.allocation.allocatedToInterestCents, 5_000); // €50
    assert.equal(r.row.principal.cents, 43_000); // €430
    assert.equal(r.row.closingBalance.cents, 957_000); // €9,570
  });

  it('explicit zero payment: row with zero principal, unpaid interest visible (test 7)', () => {
    const r = build({ paymentAmountCents: 0 });
    assert.equal(r.status, 'success'); // zero is data, not missing
    assert.ok(r.row && r.allocation);
    assert.equal(r.row.principal.cents, 0);
    assert.equal(r.row.installment.cents, 0);
    assert.equal(r.row.closingBalance.cents, 1_000_000); // unchanged
    assert.equal(r.allocation.unpaidInterestCents, 5_000); // visible via allocation
    assert.equal(
      r.auditEntries.some((e) => e.code === PA.PAYMENT_AMOUNT_MISSING),
      false,
    );
  });
});

/* ------------------------------------------------------------------ */
/* missing data propagation                                            */
/* ------------------------------------------------------------------ */

describe('recalcRowBuilder: missing data propagation', () => {
  it('rate missing_data -> missing_data, row null (test 3)', () => {
    const r = build({
      rateConfig: floatingConfig({ indexValuePercent: 3.9, spreadPercent: 2, emptyHistory: true }),
    });
    assert.equal(r.rateResolution.status, 'missing_data'); // sanity
    assert.equal(r.status, 'missing_data');
    assert.equal(r.row, null);
    assert.equal(r.allocation, null);
    assert.ok(r.auditEntries.some((e) => e.code === C.RATE_HISTORY_MISSING));
  });

  it('day count missing_data -> missing_data, row null (test 4)', () => {
    const r = build({ periodStartDate: '' as never });
    assert.equal(r.dayCount.status, 'missing_data'); // sanity
    assert.equal(r.status, 'missing_data');
    assert.equal(r.row, null);
    assert.ok(r.auditEntries.some((e) => e.code === DC.DAYCOUNT_DATE_MISSING));
  });

  it('opening balance null -> missing_data, row null (test 5)', () => {
    const r = build({ openingBalanceCents: null });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.row, null);
    assert.ok(r.auditEntries.some((e) => e.code === IC.BALANCE_MISSING));
  });

  it('payment null -> missing_data, row null, allocation reports the gap (test 6)', () => {
    const r = build({ paymentAmountCents: null });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.row, null);
    assert.ok(r.allocation); // allocation ran and reported the missing payment
    assert.equal(r.allocation.status, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === PA.PAYMENT_AMOUNT_MISSING));
  });
});

/* ------------------------------------------------------------------ */
/* requires_review propagation                                         */
/* ------------------------------------------------------------------ */

describe('recalcRowBuilder: requires_review propagation', () => {
  it('Law128 unknown with numeric preview -> preview row, requires_review, marked (test 8)', () => {
    const r = build({
      rateConfig: floatingConfig({
        indexValuePercent: 3.9,
        spreadPercent: 2,
        law128: { kind: 'unknown' },
      }),
    });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.row); // preview row produced
    // preview rate 5.9% -> interest 10000 * 0.059 * 30/360 = 49.1666 -> 4917
    assert.equal(r.row.interest.cents, 4_917);
    assert.equal(r.row.appliedAnnualRatePercent, 5.9);
    // explicit marks from accrual AND the builder:
    assert.ok(r.auditEntries.some((e) => e.code === IC.INTEREST_PREVIEW_REQUIRES_REVIEW));
    const mark = r.auditEntries.find((e) => e.code === RB.ROW_PREVIEW_REQUIRES_REVIEW);
    assert.ok(mark);
    assert.equal(mark.severity, 'requires_review');
    // the unknown levy appears as null in the breakdown, not 0... but
    // included-levy 0 is distinct: here it must be null:
    assert.equal(r.row.rateBreakdown.law128Percent, null);
  });

  it('negative index with unknown floor policy -> requires_review, no row (test 9)', () => {
    const r = build({
      rateConfig: floatingConfig({
        indexValuePercent: -0.5,
        spreadPercent: 3,
        negativeEuriborPolicy: 'unknown',
      }),
    });
    assert.equal(r.rateResolution.status, 'requires_review');
    assert.equal(r.rateResolution.appliedAnnualRatePercent, null);
    assert.equal(r.status, 'requires_review');
    assert.equal(r.row, null); // no applied rate -> no row
    assert.equal(r.allocation, null);
    assert.ok(r.auditEntries.some((e) => e.code === C.NEGATIVE_INDEX_POLICY_UNKNOWN));
  });

  it('negative accrued interest -> review propagated, no forced allocation, no row (test 10 area)', () => {
    // floating -3.5 as_is + 2.0 => applied -1.5% => negative interest
    const r = build({
      rateConfig: floatingConfig({ indexValuePercent: -3.5, spreadPercent: 2 }),
    });
    assert.ok((r.interestAccrual?.interestCents ?? 0) < 0); // accrual produced it
    assert.equal(r.status, 'requires_review'); // allocation refused it
    assert.equal(r.row, null);
    assert.ok(r.auditEntries.some((e) => e.code === PA.NEGATIVE_INTEREST_REQUIRES_REVIEW));
    assert.ok(r.auditEntries.some((e) => e.code === IC.NEGATIVE_INTEREST_PRODUCED));
  });
});

/* ------------------------------------------------------------------ */
/* fees & audit preservation                                           */
/* ------------------------------------------------------------------ */

describe('recalcRowBuilder: fees and audit preservation', () => {
  it('null fees -> FEES_ASSUMED_ZERO via allocation entries (test 10)', () => {
    const r = build({ feesAndPremiumsCents: null });
    assert.equal(r.status, 'success');
    const e = r.auditEntries.find((x) => x.code === PA.FEES_ASSUMED_ZERO);
    assert.ok(e);
    assert.equal(e.severity, 'assumption');
    // and the assumption is referenced on the row itself:
    assert.ok(r.row?.assumptions.includes(PA.FEES_ASSUMED_ZERO));
  });

  it('explicit zero fees -> no FEES_ASSUMED_ZERO (test 11)', () => {
    const r = build({ feesAndPremiumsCents: 0 });
    assert.equal(r.auditEntries.some((e) => e.code === PA.FEES_ASSUMED_ZERO), false);
  });

  it('all upstream audit entries are preserved (test 12)', () => {
    // unknown day-count in rateConfig (rate audit) + Law128 unknown
    // (rate audit) + null fees (allocation audit) in one build:
    const r = build({
      rateConfig: {
        ...floatingConfig({
          indexValuePercent: 3.9,
          spreadPercent: 2,
          law128: { kind: 'unknown' },
        }),
        dayCount: 'unknown',
      },
      feesAndPremiumsCents: null,
    });
    // rate engine entries:
    assert.ok(r.auditEntries.some((e) => e.code === C.LAW128_UNKNOWN));
    assert.ok(r.auditEntries.some((e) => e.code === C.DAYCOUNT_UNKNOWN));
    // accrual preview mark:
    assert.ok(r.auditEntries.some((e) => e.code === IC.INTEREST_PREVIEW_REQUIRES_REVIEW));
    // allocation entries:
    assert.ok(r.auditEntries.some((e) => e.code === PA.FEES_ASSUMED_ZERO));
    // builder mark:
    assert.ok(r.auditEntries.some((e) => e.code === RB.ROW_PREVIEW_REQUIRES_REVIEW));
  });

  it('no negative closing balance when payment exceeds full payoff (test 13)', () => {
    const r = build({ paymentAmountCents: 1_010_000 }); // payoff 1,005,000
    assert.equal(r.status, 'success');
    assert.ok(r.row);
    assert.equal(r.row.closingBalance.cents, 0); // never negative
    assert.equal(r.allocation?.overpaymentCents, 5_000);
    assert.ok(r.auditEntries.some((e) => e.code === PA.OVERPAYMENT_AFTER_FULL_PRINCIPAL));
  });

  it('row principal equals allocatedToPrincipalCents (test 14)', () => {
    for (const r of [build(), build({ feesAndPremiumsCents: 2_000 }), build({ paymentAmountCents: 3_000 })]) {
      assert.ok(r.row && r.allocation);
      assert.equal(r.row.principal.cents, r.allocation.allocatedToPrincipalCents);
    }
  });

  it('row closing balance equals allocation closingBalanceCents (test 15)', () => {
    for (const r of [build(), build({ paymentAmountCents: 1_010_000 }), build({ paymentAmountCents: 0 })]) {
      assert.ok(r.row && r.allocation);
      assert.equal(r.row.closingBalance.cents, r.allocation.closingBalanceCents);
    }
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('recalcRowBuilder: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../src/engines/recalcRowBuilder.ts'), 'utf8');
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no loops over periods / no schedule generation (test 16)', () => {
    // no iteration constructs over periods; the only allowed iteration
    // forms are audit-entry projections (.filter/.map on auditEntries)
    assert.equal(/\bfor\s*\(|\bwhile\s*\(|\bdo\s*\{/.test(codeOnly), false);
    assert.equal(/\.forEach\(/.test(codeOnly), false);
    assert.equal(/nextDueDate|addMonths|generateSchedule|periods\b/i.test(codeOnly), false);
    assert.equal(/RecalcRow\[\]/.test(codeOnly), false); // single row only
  });

  it('no comparison / economicDifference logic (test 17)', () => {
    assert.equal(/economicDifference|ComparisonRow|bankInstallment|bankBalance/i.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula (test 18)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });

  it('interest formula is NOT duplicated here (test 19)', () => {
    // no interest arithmetic: no rate/fraction multiplication, no /100
    // conversions on balances, no rounding of raw interest:
    assert.equal(/fractionOfYear\s*\*|\*\s*fraction|ratePercent\s*\/\s*100/.test(codeOnly), false);
    assert.equal(/rawInterest|toPrecision|Math\.round|Math\.floor|Math\.ceil/.test(codeOnly), false);
    // interest enters the row only via the accrual result:
    assert.ok(/interestAccrual\.interestCents/.test(codeOnly));
  });
});
