/**
 * Tests: payment reconciliation engine (Step 9-A).
 * Covers the 24 required scenarios. No schedule engines are called.
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
  reconcileActualPayments,
  PAYMENT_RECONCILIATION_AUDIT_CODES as PR,
  type PaymentReconciliationInput,
} from '../src/engines/paymentReconciliationEngine';
import { findForbiddenFindingTerms } from '../src/engines/findingsEngine';
import { moneyFromCents, type NullableMoney } from '../src/domain/money';
import { toISODate } from '../src/domain/dateTypes';
import type { ActualPayment } from '../src/domain/paymentTypes';
import type { BankScheduleRow, RecalcRow } from '../src/domain/scheduleTypes';

const D = toISODate;
const M = (cents: number) => moneyFromCents(cents);

/* ------------------------------------------------------------------ */
/* Fixture helpers                                                     */
/* ------------------------------------------------------------------ */

function payment(args: {
  paymentId: string;
  date: string;
  amount?: number;
  matchedScheduleRowId?: string | null;
}): ActualPayment {
  return {
    paymentId: args.paymentId,
    date: D(args.date),
    amount: args.amount === undefined ? M(64_708) : M(args.amount),
    description: null,
    matchedScheduleRowId: args.matchedScheduleRowId ?? null,
    matchConfidence: 'auto_exact',
  };
}

function bankRow(args: {
  rowId: string;
  dueDate: string;
  installment?: number | null;
}): BankScheduleRow {
  const c = (v: number | null | undefined, def: number): NullableMoney =>
    v === null ? null : M(v ?? def);
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    installmentAmount: c(args.installment, 64_708),
    principalPortion: M(40_000),
    interestPortion: M(24_708),
    feesAndPremiums: M(0),
    balanceAfter: M(960_000),
    paymentStatus: 'unknown',
    rawText: null,
    sourcePage: null,
    sourceConfidence: 'manual_entry',
  };
}

function recalcRow(args: {
  rowId: string;
  dueDate: string;
  installment?: number | null;
}): RecalcRow {
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    openingBalance: M(1_000_000),
    appliedAnnualRatePercent: 6,
    rateBreakdown: { indexPercent: null, spreadPercent: null, law128Percent: 0, totalPercent: 6 },
    dayCountDays: 30,
    interest: M(24_708),
    principal: M(40_000),
    installment: args.installment === null ? (null as unknown as ReturnType<typeof M>) : M(args.installment ?? 64_708),
    closingBalance: M(960_000),
    assumptions: [],
  };
}

const recon = (overrides: Partial<PaymentReconciliationInput> = {}) =>
  reconcileActualPayments({
    actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31' })],
    bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
    target: 'bank_schedule',
    ...overrides,
  });

/* ------------------------------------------------------------------ */
/* matching & targets                                                  */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: matching & targets', () => {
  it('exact payment-date matching to bank row (test 1)', () => {
    const r = recon();
    assert.equal(r.status, 'success');
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0]!.status, 'matched');
    assert.equal(r.rows[0]!.paymentId, 'P1');
    assert.equal(r.rows[0]!.bankDueCents, 64_708);
    assert.equal(r.rows[0]!.differenceVsBankCents, 0);
    assert.equal(r.summary?.matchedPaymentCount, 1);
  });

  it('exact payment-date matching to recalc row (test 2)', () => {
    const r = reconcileActualPayments({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
      target: 'recalculated_schedule',
    });
    assert.equal(r.status, 'success');
    assert.equal(r.rows[0]!.recalculatedDueCents, 64_708);
    assert.equal(r.rows[0]!.differenceVsRecalculatedCents, 0);
  });

  it('target both compares actual to both bank and recalc (test 3)', () => {
    const r = reconcileActualPayments({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31', amount: 65_000 })],
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 64_708 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_891 })],
      target: 'both',
    });
    assert.equal(r.rows[0]!.bankDueCents, 64_708);
    assert.equal(r.rows[0]!.recalculatedDueCents, 64_891);
    assert.equal(r.rows[0]!.differenceVsBankCents, 65_000 - 64_708);
    assert.equal(r.rows[0]!.differenceVsRecalculatedCents, 65_000 - 64_891);
  });
});

/* ------------------------------------------------------------------ */
/* sign convention                                                     */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: sign convention', () => {
  it('positive difference when actual paid > bank due (test 4)', () => {
    const r = recon({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31', amount: 65_500 })],
    });
    assert.equal(r.rows[0]!.differenceVsBankCents, 65_500 - 64_708); // +792
  });

  it('negative difference when actual paid < recalc due (test 5)', () => {
    const r = reconcileActualPayments({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31', amount: 63_000 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_708 })],
      target: 'recalculated_schedule',
    });
    assert.equal(r.rows[0]!.differenceVsRecalculatedCents, 63_000 - 64_708); // −1708
  });

  it('sign convention is actual paid minus target due (tests 4–6)', () => {
    // both a positive and a negative confirm the formula directionally:
    const pos = recon({ actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31', amount: 70_000 })] });
    const neg = recon({ actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31', amount: 60_000 })] });
    assert.ok(pos.rows[0]!.differenceVsBankCents! > 0);
    assert.ok(neg.rows[0]!.differenceVsBankCents! < 0);
    assert.equal(pos.rows[0]!.differenceVsBankCents, 70_000 - 64_708);
    assert.equal(neg.rows[0]!.differenceVsBankCents, 60_000 - 64_708);
  });
});

/* ------------------------------------------------------------------ */
/* null vs explicit zero                                               */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: null vs explicit zero', () => {
  it('null actual amount -> differences null, never zero (test 7)', () => {
    // ActualPayment.amount is typed as Money but may come as null at runtime:
    const broken = { ...payment({ paymentId: 'P1', date: '2024-01-31' }), amount: null as unknown as ReturnType<typeof M> };
    const r = recon({ actualPayments: [broken] });
    assert.equal(r.rows[0]!.actualPaidCents, null);
    assert.equal(r.rows[0]!.differenceVsBankCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === PR.PAYMENT_AMOUNT_MISSING));
  });

  it('null bank installment -> differenceVsBank null, never zero (test 8)', () => {
    const r = recon({ bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: null })] });
    assert.equal(r.rows[0]!.bankDueCents, null);
    assert.equal(r.rows[0]!.differenceVsBankCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === PR.BANK_VALUE_MISSING));
  });

  it('null recalc installment -> differenceVsRecalc null, never zero (test 9)', () => {
    const r = reconcileActualPayments({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: null })],
      target: 'recalculated_schedule',
    });
    assert.equal(r.rows[0]!.recalculatedDueCents, null);
    assert.equal(r.rows[0]!.differenceVsRecalculatedCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === PR.RECALC_VALUE_MISSING));
  });

  it('explicit zero payment is valid data (test 10)', () => {
    const r = recon({ actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31', amount: 0 })] });
    assert.equal(r.rows[0]!.actualPaidCents, 0);
    assert.equal(r.rows[0]!.differenceVsBankCents, 0 - 64_708); // negative, not missing
    assert.equal(r.auditEntries.some((e) => e.code === PR.PAYMENT_AMOUNT_MISSING), false);
  });
});

/* ------------------------------------------------------------------ */
/* date tolerance & modes                                              */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: date tolerance', () => {
  it('date tolerance matches nearby payment (test 11)', () => {
    const r = recon({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-02-02' })],
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
      dateToleranceDays: 5,
    });
    assert.equal(r.rows[0]!.status, 'matched');
    assert.equal(r.unmatchedPayments.length, 0);
  });

  it('no match outside tolerance (test 12)', () => {
    const r = recon({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-02-08' })],
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
      dateToleranceDays: 3,
    });
    assert.equal(r.unmatchedPayments.length, 1);
    assert.equal(r.rows.some((x) => x.status === 'matched'), false);
  });

  it('ambiguous tolerance candidates -> requires_review + AMBIGUOUS_PAYMENT_MATCH (test 13)', () => {
    const r = reconcileActualPayments({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-02-01' })],
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31' }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-02' }),
      ],
      target: 'bank_schedule',
      dateToleranceDays: 5,
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.unmatchedPayments.length, 1);
    assert.ok(r.auditEntries.some((e) => e.code === PR.AMBIGUOUS_PAYMENT_MATCH));
  });

  it('by_payment_date_window: nearest-date matching (test 11 variant)', () => {
    const r = reconcileActualPayments({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-02-03' })],
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), // 3 days
        bankRow({ rowId: 'b2', dueDate: '2024-03-31' }), // 57 days
      ],
      target: 'bank_schedule',
      matchingMode: 'by_payment_date_window',
      dateToleranceDays: 10,
    });
    assert.equal(r.rows.filter((x) => x.status === 'matched').length, 1);
    assert.equal(r.rows.find((x) => x.status === 'matched')!.dueDate, '2024-01-31');
  });
});

/* ------------------------------------------------------------------ */
/* manual match ID                                                     */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: manual match ID', () => {
  it('manual_match_id works by rowId (test 14)', () => {
    const r = recon({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-06-15', matchedScheduleRowId: 'b1' })],
      matchingMode: 'manual_match_id',
    });
    assert.equal(r.rows[0]!.status, 'matched');
    assert.equal(r.rows[0]!.paymentId, 'P1');
    assert.equal(r.rows[0]!.dueDate, '2024-01-31');
  });

  it('manual_match_id with missing row -> requires_review (test 15)', () => {
    const r = recon({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31', matchedScheduleRowId: 'b999' })],
      matchingMode: 'manual_match_id',
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.unmatchedPayments.length, 1);
    assert.ok(r.auditEntries.some((e) => e.code === PR.MANUAL_MATCH_ROW_MISSING));
  });
});

/* ------------------------------------------------------------------ */
/* unmatched                                                           */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: unmatched', () => {
  it('unmatched payment is reported with status unmatched_payment (test 16)', () => {
    const r = recon({
      actualPayments: [
        payment({ paymentId: 'P1', date: '2024-01-31' }),
        payment({ paymentId: 'P2', date: '2024-06-30' }),
      ],
    });
    assert.equal(r.unmatchedPayments.length, 1);
    assert.equal(r.unmatchedPayments[0]!.paymentId, 'P2');
    const row = r.rows.find((x) => x.status === 'unmatched_payment');
    assert.ok(row);
    assert.equal(row.paymentId, 'P2');
    assert.equal(row.dueDate, null);
    assert.ok(r.auditEntries.some((e) => e.code === PR.UNMATCHED_PAYMENT));
  });

  it('unmatched due row: actualPaid null, differences null, not zero (test 17)', () => {
    const r = recon({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31' }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29' }),
      ],
    });
    const unmatched = r.rows.find((x) => x.status === 'unmatched_due');
    assert.ok(unmatched);
    assert.equal(unmatched.actualPaidCents, null); // never zero
    assert.equal(unmatched.differenceVsBankCents, null);
    assert.equal(r.unmatchedBankRows.length, 1);
    assert.ok(r.auditEntries.some((e) => e.code === PR.UNMATCHED_DUE_ROW));
  });
});

/* ------------------------------------------------------------------ */
/* summary & materiality                                               */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: summary & materiality', () => {
  it('summary totals exclude incomplete rows (test 18)', () => {
    const r = reconcileActualPayments({
      actualPayments: [
        payment({ paymentId: 'P1', date: '2024-01-31', amount: 65_000 }),
        payment({ paymentId: 'P2', date: '2024-02-29', amount: 64_708 }),
      ],
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31' }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: null }), // missing
      ],
      target: 'bank_schedule',
    });
    // P2 row has null bank due -> excluded from totalDifferenceVsBank
    assert.equal(r.summary?.totalDifferenceVsBankCents, 65_000 - 64_708); // only P1 contributes
    assert.equal(r.summary?.excludedRowCount, 1);
  });

  it('summary totals do not fake nulls as zero (test 19)', () => {
    const r = reconcileActualPayments({
      actualPayments: [payment({ paymentId: 'P1', date: '2024-01-31' })],
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: null })],
      target: 'bank_schedule',
    });
    // all bank values null -> no complete pair -> total null, not 0
    assert.equal(r.summary?.totalDifferenceVsBankCents, null);
    assert.notEqual(r.summary?.totalDifferenceVsBankCents, 0);
  });

  it('materiality threshold flags only material differences (test 20)', () => {
    const r = reconcileActualPayments({
      actualPayments: [
        payment({ paymentId: 'P1', date: '2024-01-31', amount: 64_708 }),    // diff 0
        payment({ paymentId: 'P2', date: '2024-02-29', amount: 64_808 }),    // diff 100 = threshold → rounding
        payment({ paymentId: 'P3', date: '2024-03-31', amount: 65_008 }),    // diff 300 > threshold
      ],
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31' }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29' }),
        bankRow({ rowId: 'b3', dueDate: '2024-03-31' }),
      ],
      target: 'bank_schedule',
      materialityThresholdCents: 100,
    });
    const matched = r.rows.filter((x) => x.status === 'matched');
    assert.ok(matched[0]!.notes.some((n) => n.includes('Συμφωνία')));
    assert.ok(matched[1]!.notes.some((n) => n.includes('στρογγυλοποίηση')));
    assert.ok(matched[2]!.notes.some((n) => n.includes('σημαντικότητας')));
    assert.equal(r.summary?.rowsRequiringReviewCount, 1);
    assert.equal(r.status, 'requires_review');
    assert.ok(r.auditEntries.some((e) => e.code === PR.PAYMENT_DIFFERENCE_MATERIAL));
  });
});

/* ------------------------------------------------------------------ */
/* wording safety                                                      */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: wording safety', () => {
  it('all generated wording passes the forbidden-terms guard (test 21)', () => {
    const r = reconcileActualPayments({
      actualPayments: [
        payment({ paymentId: 'P1', date: '2024-01-31', amount: 70_000 }),
        payment({ paymentId: 'P2', date: '2024-06-30' }),
      ],
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: null }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29' }),
      ],
      recalcRows: [
        { rowId: 'r1', dueDate: D('2024-01-31'), openingBalance: M(1_000_000), appliedAnnualRatePercent: 6, rateBreakdown: { indexPercent: null, spreadPercent: null, law128Percent: 0, totalPercent: 6 }, dayCountDays: 30, interest: M(24_708), principal: M(40_000), installment: null as unknown as ReturnType<typeof M>, closingBalance: M(960_000), assumptions: [] } as RecalcRow,
      ],
      target: 'both',
      materialityThresholdCents: 1,
    });
    for (const e of r.auditEntries) {
      assert.deepEqual([...findForbiddenFindingTerms(e.message)], [], e.message);
    }
    for (const row of r.rows) {
      for (const note of row.notes) {
        assert.deepEqual([...findForbiddenFindingTerms(note)], [], note);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('paymentReconciliationEngine: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/engines/paymentReconciliationEngine.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no schedule generation/recalculation logic (test 22)', () => {
    assert.equal(
      /buildEqual|buildSingleRecalcRow|allocateSinglePayment|resolveRateForDate|calculateDayCount|calculateAccruedInterest|Math\.pow|addOneMonth/.test(codeOnly),
      false,
    );
  });

  it('no comparison/report/PDF/UI logic (test 23)', () => {
    assert.equal(
      /compareSchedules\s*\(|generateFindings\s*\(|buildLoanAuditReportModel\s*\(|renderLoanAuditReportText\s*\(|renderLoanAuditPdf\s*\(|document\.|window\.|React|innerHTML/i.test(codeOnly),
      false,
    );
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula (test 24)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });
});
