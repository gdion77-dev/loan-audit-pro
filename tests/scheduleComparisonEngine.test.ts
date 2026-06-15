/**
 * Tests: schedule comparison engine (Step 6-A).
 * Covers the 22 required scenarios.
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
  compareSchedules,
  SCHEDULE_COMPARISON_AUDIT_CODES as SC,
} from '../src/engines/scheduleComparisonEngine';
import { findForbiddenTerms } from '../src/domain/reportTypes';
import { moneyFromCents, type NullableMoney } from '../src/domain/money';
import { toISODate } from '../src/domain/dateTypes';
import type { BankScheduleRow, RecalcRow } from '../src/domain/scheduleTypes';

const D = toISODate;
const M = (cents: number) => moneyFromCents(cents);

function bankRow(args: {
  rowId: string;
  dueDate: string;
  installment?: number | null;
  principal?: number | null;
  interest?: number | null;
  balance?: number | null;
}): BankScheduleRow {
  const c = (v: number | null | undefined, def: number): NullableMoney =>
    v === null ? null : M(v ?? def);
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    installmentAmount: c(args.installment, 64_708),
    principalPortion: c(args.principal, 40_000),
    interestPortion: c(args.interest, 24_708),
    feesAndPremiums: M(0),
    balanceAfter: c(args.balance, 960_000),
    paymentStatus: 'unknown',
    rawText: null,
    sourcePage: null,
    sourceConfidence: 'manual_entry',
  };
}

function recalcRow(args: {
  rowId: string;
  dueDate: string;
  installment?: number;
  principal?: number;
  interest?: number;
  balance?: number;
  opening?: number;
}): RecalcRow {
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    openingBalance: M(args.opening ?? 1_000_000),
    appliedAnnualRatePercent: 6,
    rateBreakdown: { indexPercent: null, spreadPercent: null, law128Percent: 0, totalPercent: 6 },
    dayCountDays: 30,
    interest: M(args.interest ?? 24_708),
    principal: M(args.principal ?? 40_000),
    installment: M(args.installment ?? 64_708),
    closingBalance: M(args.balance ?? 960_000),
    assumptions: [],
  };
}

/* ------------------------------------------------------------------ */
/* core matching & signs                                               */
/* ------------------------------------------------------------------ */

describe('scheduleComparisonEngine: matching & sign convention', () => {
  it('identical rows match exactly: success, zero differences (test 1)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-02-29', balance: 920_000 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-29', balance: 920_000 })],
    });
    assert.equal(r.status, 'success');
    assert.equal(r.rows.length, 2);
    for (const row of r.rows) {
      assert.equal(row.economicDifference?.cents, 0);
      assert.equal(row.findingLevel, 'none');
      assert.equal(row.notes, null);
    }
    assert.equal(r.unmatchedBankRows.length, 0);
    assert.equal(r.unmatchedRecalcRows.length, 0);
  });

  it('positive economic difference when bank installment is higher (test 2)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_708 })],
    });
    assert.equal(r.rows[0]!.economicDifference?.cents, 532); // +5,32 €
    assert.equal(r.rows[0]!.findingLevel, 'deviation');
  });

  it('negative economic difference when recalculated is higher (test 3)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 64_708 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_891 })],
    });
    assert.equal(r.rows[0]!.economicDifference?.cents, -183); // −1,83 €
  });

  it('sign convention is bank − recalculated on every field (test 4)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 100, principal: 70, interest: 30, balance: 500 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 90, principal: 75, interest: 15, balance: 480 })],
    });
    const row = r.rows[0]!;
    assert.equal(row.economicDifference?.cents, 100 - 90); // installment diff
    // summary-level diffs use the same convention:
    assert.equal(r.summary?.totalEconomicDifferenceCents, 10);
    assert.equal(r.summary?.totalPrincipalDifferenceCents, -5);
    assert.equal(r.summary?.totalInterestDifferenceCents, 15);
  });
});

/* ------------------------------------------------------------------ */
/* null discipline                                                     */
/* ------------------------------------------------------------------ */

describe('scheduleComparisonEngine: null discipline', () => {
  it('null bank installment -> difference null, never zero, BANK_VALUE_MISSING (test 5)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: null })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const row = r.rows[0]!;
    assert.equal(row.economicDifference, null); // null, not Money(…)
    assert.notEqual(row.economicDifference as unknown, 0);
    assert.equal(row.findingLevel, 'missing_data');
    assert.equal(r.status, 'requires_review');
    assert.ok(r.auditEntries.some((e) => e.code === SC.BANK_VALUE_MISSING));
  });

  it('null recalculated value -> difference null, RECALC_VALUE_MISSING (test 6)', () => {
    const broken = {
      ...recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
      principal: null as never, // runtime data violating the static type
    } as RecalcRow;
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
      recalcRows: [broken],
    });
    const row = r.rows[0]!;
    assert.equal(row.recalculatedPrincipal, null);
    // principal totals exclude the row instead of faking zero:
    assert.equal(r.summary?.totalPrincipalDifferenceCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === SC.RECALC_VALUE_MISSING));
  });

  it('empty bankRows -> missing_data (test 7)', () => {
    const r = compareSchedules({ bankRows: [], recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })] });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.summary, null);
    assert.ok(r.auditEntries.some((e) => e.code === SC.COMPARISON_BANK_ROWS_EMPTY));
  });

  it('empty recalcRows -> missing_data (test 8)', () => {
    const r = compareSchedules({ bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })], recalcRows: [] });
    assert.equal(r.status, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === SC.COMPARISON_RECALC_ROWS_EMPTY));
  });
});

/* ------------------------------------------------------------------ */
/* unmatched & tolerance                                               */
/* ------------------------------------------------------------------ */

describe('scheduleComparisonEngine: unmatched & tolerance', () => {
  it('unmatched bank row reported, requires_review (test 9)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-06-30' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.unmatchedBankRows.length, 1);
    assert.equal(r.unmatchedBankRows[0]!.rowId, 'b2');
    assert.ok(r.auditEntries.some((e) => e.code === SC.UNMATCHED_BANK_ROW));
    assert.equal(r.summary?.unmatchedBankRowCount, 1);
  });

  it('unmatched recalc row reported, requires_review (test 10)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-29' })],
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.unmatchedRecalcRows.length, 1);
    assert.ok(r.auditEntries.some((e) => e.code === SC.UNMATCHED_RECALC_ROW));
  });

  it('date tolerance matches nearby dates with info entry (test 11)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-02-02' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
      dateToleranceDays: 5,
    });
    assert.equal(r.rows.length, 1);
    assert.equal(r.unmatchedBankRows.length, 0);
    assert.equal(r.status, 'success'); // tolerance match alone is not review
    assert.ok(r.auditEntries.some((e) => e.code === SC.DATE_TOLERANCE_MATCH && e.severity === 'info'));
  });

  it('without tolerance the same rows stay unmatched', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-02-02' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    assert.equal(r.rows.length, 0);
    assert.equal(r.unmatchedBankRows.length, 1);
    assert.equal(r.unmatchedRecalcRows.length, 1);
  });

  it('ambiguous tolerance candidates -> requires_review + AMBIGUOUS_DATE_MATCH (test 12)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-02-02' })],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-04' }),
      ],
      dateToleranceDays: 5,
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.rows.length, 0);
    assert.equal(r.unmatchedBankRows.length, 1);
    const e = r.auditEntries.find((x) => x.code === SC.AMBIGUOUS_DATE_MATCH);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
  });
});

/* ------------------------------------------------------------------ */
/* index matching                                                      */
/* ------------------------------------------------------------------ */

describe('scheduleComparisonEngine: index matching', () => {
  it('by_index matches in order and reports info (test 13)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-25' })], // different date — irrelevant in index mode
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
      matchingMode: 'by_index',
    });
    assert.equal(r.rows.length, 1);
    assert.equal(r.status, 'success');
    assert.ok(r.auditEntries.some((e) => e.code === SC.INDEX_MATCHING_USED && e.severity === 'info'));
  });

  it('row-count mismatch under index matching reports unmatched (test 14)', () => {
    const r = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
        recalcRow({ rowId: 'r3', dueDate: '2024-03-31' }),
      ],
      matchingMode: 'by_index',
    });
    assert.equal(r.rows.length, 1);
    assert.equal(r.unmatchedRecalcRows.length, 2);
    assert.equal(r.status, 'requires_review');
  });
});

/* ------------------------------------------------------------------ */
/* materiality & summary                                               */
/* ------------------------------------------------------------------ */

describe('scheduleComparisonEngine: materiality & summary', () => {
  it('threshold flags only differences above it (test 15)', () => {
    const r = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 64_708 }), // diff 0
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: 64_758 }), // diff 50 = threshold -> rounding
        bankRow({ rowId: 'b3', dueDate: '2024-03-31', installment: 64_908 }), // diff 200 > threshold
      ],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
        recalcRow({ rowId: 'r3', dueDate: '2024-03-31' }),
      ],
      materialityThresholdCents: 50,
    });
    assert.deepEqual(
      r.rows.map((x) => x.findingLevel),
      ['none', 'rounding', 'deviation'],
    );
    assert.equal(r.summary?.rowsRequiringReviewCount, 1);
    assert.equal(r.status, 'requires_review'); // because one material row exists
    const e = r.auditEntries.find((x) => x.code === SC.MATERIAL_DIFFERENCE);
    assert.ok(e);
  });

  it('summary totals correct when all values exist (test 16)', () => {
    const r = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_000, interest: 25_000, principal: 40_000 }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: 65_000, interest: 24_000, principal: 41_000 }),
      ],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_708, interest: 24_708, principal: 40_000 }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-29', installment: 64_708, interest: 23_708, principal: 41_000 }),
      ],
    });
    assert.equal(r.summary?.totalBankInstallmentsCents, 130_000);
    assert.equal(r.summary?.totalRecalculatedInstallmentsCents, 129_416);
    assert.equal(r.summary?.totalEconomicDifferenceCents, 584);
    assert.equal(r.summary?.totalInterestDifferenceCents, 584);
    assert.equal(r.summary?.totalPrincipalDifferenceCents, 0);
    assert.equal(r.summary?.comparedRowCount, 2);
    assert.equal(r.summary?.excludedRowCount, 0);
  });

  it('summary totals exclude rows with missing values instead of faking zeros (test 17)', () => {
    const r = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_000 }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: null }), // missing
      ],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_708 }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-29', installment: 64_708 }),
      ],
    });
    // only the complete pair contributes: 65,000 − 64,708 = 292, NOT
    // (65,000 + 0) − (64,708 + 64,708):
    assert.equal(r.summary?.totalBankInstallmentsCents, 65_000);
    assert.equal(r.summary?.totalEconomicDifferenceCents, 292);
    assert.equal(r.summary?.excludedRowCount, 1);
    assert.equal(r.status, 'requires_review');
  });

  it('audit entries preserve row context (test 18)', () => {
    const r = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', balance: null }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', balance: null }),
      ],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
      ],
    });
    const e = r.auditEntries.find((x) => x.code === SC.BANK_VALUE_MISSING);
    assert.ok(e);
    const ctx = e.context as Record<string, unknown>;
    assert.deepEqual(ctx['rowRefs'], ['b1↔r1', 'b2↔r2']); // aggregated, with context
    assert.equal(ctx['occurrences'], 2);
  });

  it('no legal wording appears anywhere in engine output (test 19)', () => {
    const r = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 70_000 }), // big deviation
        bankRow({ rowId: 'b2', dueDate: '2024-06-30' }), // unmatched
        bankRow({ rowId: 'b3', dueDate: '2024-02-29', installment: null }), // missing
      ],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
      ],
    });
    for (const e of r.auditEntries) {
      assert.deepEqual([...findForbiddenTerms(e.message)], [], e.message);
    }
    for (const row of r.rows) {
      if (row.notes !== null) assert.deepEqual([...findForbiddenTerms(row.notes)], [], row.notes);
    }
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('scheduleComparisonEngine: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/engines/scheduleComparisonEngine.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no schedule generation / interest computation logic (test 20)', () => {
    assert.equal(
      /resolveRateForDate|calculateDayCount|calculateAccruedInterest|allocateSinglePayment|buildSingleRecalcRow|buildEqual/.test(codeOnly),
      false,
    );
    assert.equal(/fractionOfYear|yearBasis|Math\.pow|addOneMonth/.test(codeOnly), false);
  });

  it('no UI/PDF/Excel/reconciliation logic (test 21)', () => {
    assert.equal(/\bpdf\b|\bexcel\b|\bxlsx\b|document\.|window\.|React|matchedScheduleRowId|ActualPayment/i.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula (test 22)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });
});
