/**
 * Tests: loan audit pipeline runner (Step 10-A).
 * Covers the 17 required scenarios. Every stage runs through the
 * REAL locked engines — the orchestrator is pure plumbing.
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
  runLoanAuditPipeline,
  PIPELINE_AUDIT_CODES as PL,
  type LoanAuditPipelineInput,
} from '../src/engines/loanAuditPipelineRunner';
import { moneyFromCents, type NullableMoney } from '../src/domain/money';
import { toISODate } from '../src/domain/dateTypes';
import type { BankScheduleRow } from '../src/domain/scheduleTypes';
import type { ActualPayment } from '../src/domain/paymentTypes';
import type { CaseInfo } from '../src/domain/loanTypes';
import type { RateConfig } from '../src/domain/rateTypes';

const D = toISODate;
const M = (cents: number) => moneyFromCents(cents);

const fixed6: RateConfig = {
  regime: { kind: 'fixed', annualRatePercent: 6 },
  law128: { kind: 'included_in_rate', ratePercent: null },
  dayCount: 'ACT_360',
};

const caseInfo: CaseInfo = {
  caseId: 'CASE-001',
  debtorName: 'Δοκιμαστικός Οφειλέτης',
  contractNumber: '4500-123456-7',
  institution: 'Τράπεζα Α',
  servicer: 'Servicer Β',
  contractDate: D('2018-03-15'),
  restructuringDate: null,
  principal: M(900_000),
  currency: 'EUR',
  startDate: D('2024-01-01'),
  endDate: D('2024-03-31'),
  termMonths: 3,
  notes: null,
};

const methodology = {
  scheduleType: 'ίσο κεφάλαιο',
  rateDescription: 'σταθερό 6,00%',
  dayCountConvention: 'ACT/360',
  law128Status: 'περιλαμβάνεται',
  negativeIndexPolicy: 'δεν εφαρμόζεται',
  roundingPolicy: 'half-up ανά περίοδο',
  dataCoverageNote: 'πλήρης κάλυψη',
};

const equalPrincipalInput = {
  principalCents: 900_000,
  termPeriods: 3,
  firstPeriodStartDate: D('2024-01-01'),
  firstDueDate: D('2024-01-31'),
  paymentFrequency: 'monthly' as const,
  rateConfig: fixed6,
  dayCountConvention: 'ACT_360' as const,
  feesAndPremiumsPerPeriodCents: 0,
};

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
    installmentAmount: c(args.installment, 304_500),
    principalPortion: M(300_000),
    interestPortion: M(4_500),
    feesAndPremiums: M(0),
    balanceAfter: M(600_000),
    paymentStatus: 'unknown',
    rawText: null,
    sourcePage: null,
    sourceConfidence: 'manual_entry',
  };
}

/** Bank rows aligned to the equal-principal schedule's due dates. */
const alignedBankRows = (over?: { firstInstallment?: number | null }): BankScheduleRow[] => [
  bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: over?.firstInstallment ?? 304_500 }),
  bankRow({ rowId: 'b2', dueDate: '2024-02-29' }),
  bankRow({ rowId: 'b3', dueDate: '2024-03-29' }),
];

function payment(id: string, date: string, amount: number): ActualPayment {
  return {
    paymentId: id,
    date: D(date),
    amount: M(amount),
    description: null,
    matchedScheduleRowId: null,
    matchConfidence: 'auto_exact',
  };
}

const baseInput = (over: Partial<LoanAuditPipelineInput> = {}): LoanAuditPipelineInput => ({
  caseInfo,
  scheduleMode: 'equal_principal',
  scheduleInput: equalPrincipalInput,
  bankRows: alignedBankRows(),
  reportMethodology: methodology,
  generatedAt: '2026-06-12T10:00:00.000Z',
  ...over,
});

/* ------------------------------------------------------------------ */
/* full pipelines                                                      */
/* ------------------------------------------------------------------ */

describe('loanAuditPipelineRunner: full pipelines', () => {
  it('equal principal, no payments, renders report + PDF on request (test 1)', () => {
    const r = runLoanAuditPipeline(baseInput({ renderText: true, renderPdf: true }));
    assert.ok(r.recalcScheduleResult && r.recalcScheduleResult.rows.length === 3);
    assert.ok(r.comparisonResult);
    assert.ok(r.findingsResult);
    assert.equal(r.paymentReconciliationResult, null); // none provided
    assert.ok(r.reportModelResult?.reportModel);
    assert.ok(r.reportTextResult);
    assert.ok(r.pdfResult?.pdfBytes);
    assert.equal(Buffer.from(r.pdfResult.pdfBytes.slice(0, 5)).toString('latin1'), '%PDF-');
  });

  it('equal installment with payments produces report + PDF (test 2)', () => {
    const r = runLoanAuditPipeline(
      baseInput({
        scheduleMode: 'equal_installment',
        scheduleInput: {
          principalCents: 900_000,
          termPeriods: 3,
          firstPeriodStartDate: D('2024-01-01'),
          firstDueDate: D('2024-01-31'),
          paymentFrequency: 'monthly',
          rateConfig: fixed6,
          dayCountConvention: 'ACT_360',
          feesAndPremiumsPerPeriodCents: 0,
        },
        bankRows: alignedBankRows(),
        actualPayments: [payment('P1', '2024-01-31', 304_500)],
        renderText: true,
        renderPdf: true,
      }),
    );
    assert.ok(r.recalcScheduleResult && r.recalcScheduleResult.rows.length === 3);
    assert.ok(r.paymentReconciliationResult);
    assert.ok(r.reportModelResult?.reportModel);
    assert.ok(r.pdfResult?.pdfBytes);
  });
});

/* ------------------------------------------------------------------ */
/* reconciliation wiring                                               */
/* ------------------------------------------------------------------ */

describe('loanAuditPipelineRunner: reconciliation wiring', () => {
  it('reconciliation result is passed into reportModel (test 3)', () => {
    const r = runLoanAuditPipeline(
      baseInput({ actualPayments: [payment('P1', '2024-01-31', 304_500)] }),
    );
    assert.ok(r.paymentReconciliationResult);
    // reportModel recalc summary mentions reconciliation:
    assert.ok(r.reportModelResult!.reportModel!.recalculationSummary.includes('Συμφωνία πραγματικών καταβολών'));
  });

  it('totalActualPaidDifference appears when reconciliation has a recalc difference (test 4)', () => {
    // pay more than the recalculated installment so vs-recalc is non-null
    const r = runLoanAuditPipeline(
      baseInput({
        actualPayments: [payment('P1', '2024-01-31', 305_000)],
        reconciliationOptions: { target: 'recalculated_schedule' },
      }),
    );
    const diff = r.reportModelResult!.reportModel!.comparisonSummary.totalActualPaidDifference;
    assert.ok(diff !== null);
    assert.equal(typeof diff.cents, 'number');
  });

  it('no actualPayments skips reconciliation without failing pipeline (test 5)', () => {
    const r = runLoanAuditPipeline(baseInput({}));
    assert.equal(r.paymentReconciliationResult, null);
    assert.ok(r.reportModelResult?.reportModel); // still produced
    assert.ok(r.auditEntries.some((e) => e.code === PL.PIPELINE_RECONCILIATION_SKIPPED));
    // totalActualPaidDifference not finalized:
    assert.equal(r.reportModelResult!.reportModel!.comparisonSummary.totalActualPaidDifference, null);
  });
});

/* ------------------------------------------------------------------ */
/* skip & propagation                                                  */
/* ------------------------------------------------------------------ */

describe('loanAuditPipelineRunner: skip & propagation', () => {
  it('schedule missing_data skips downstream safely (test 6)', () => {
    const r = runLoanAuditPipeline(
      baseInput({
        scheduleInput: { ...equalPrincipalInput, principalCents: null },
      }),
    );
    assert.equal(r.recalcScheduleResult!.status, 'missing_data');
    assert.equal(r.recalcScheduleResult!.rows.length, 0);
    assert.equal(r.comparisonResult, null);
    assert.equal(r.findingsResult, null);
    assert.equal(r.reportModelResult, null);
    assert.equal(r.status, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === PL.PIPELINE_COMPARISON_SKIPPED));
    assert.ok(r.auditEntries.some((e) => e.code === PL.PIPELINE_FINDINGS_SKIPPED));
    assert.ok(r.auditEntries.some((e) => e.code === PL.PIPELINE_REPORT_SKIPPED));
  });

  it('comparison requires_review propagates to final status (test 7)', () => {
    // an extra unmatched bank row forces comparison requires_review
    const r = runLoanAuditPipeline(
      baseInput({
        bankRows: [...alignedBankRows(), bankRow({ rowId: 'bX', dueDate: '2024-09-30' })],
      }),
    );
    assert.equal(r.comparisonResult!.status, 'requires_review');
    assert.equal(r.status, 'requires_review');
  });

  it('findings requires_review propagates (test 8)', () => {
    // a material deviation makes findings requires_review
    const r = runLoanAuditPipeline(
      baseInput({ bankRows: alignedBankRows({ firstInstallment: 310_000 }) }),
    );
    assert.equal(r.findingsResult!.status, 'requires_review');
    assert.equal(r.status, 'requires_review');
  });

  it('reconciliation requires_review propagates (test 9)', () => {
    // unmatched payment (date matches no due) -> reconciliation review
    const r = runLoanAuditPipeline(
      baseInput({ actualPayments: [payment('P1', '2024-12-25', 304_500)] }),
    );
    assert.equal(r.paymentReconciliationResult!.status, 'requires_review');
    assert.equal(r.status, 'requires_review');
  });

  it('PDF requires_review propagates to final status (test 10)', () => {
    // missing regular font -> PDF requires_review, bytes null
    const r = runLoanAuditPipeline(
      baseInput({
        renderPdf: true,
        pdfOptions: { fontConfig: { regularPath: '/nonexistent/Sans.ttf' } },
      }),
    );
    assert.equal(r.pdfResult!.status, 'requires_review');
    assert.equal(r.pdfResult!.pdfBytes, null);
    assert.equal(r.status, 'requires_review');
  });
});

/* ------------------------------------------------------------------ */
/* render flags                                                        */
/* ------------------------------------------------------------------ */

describe('loanAuditPipelineRunner: render flags', () => {
  it('renderPdf true with renderText false still renders text as dependency (test 11)', () => {
    const r = runLoanAuditPipeline(baseInput({ renderText: false, renderPdf: true }));
    assert.ok(r.reportTextResult); // rendered as dependency
    assert.ok(r.pdfResult?.pdfBytes);
    assert.ok(r.auditEntries.some((e) => e.code === PL.PIPELINE_TEXT_RENDERED_AS_DEPENDENCY));
  });

  it('renderPdf false leaves pdfResult null (test 12)', () => {
    const r = runLoanAuditPipeline(baseInput({ renderText: true, renderPdf: false }));
    assert.ok(r.reportTextResult);
    assert.equal(r.pdfResult, null);
  });

  it('neither flag: no text, no pdf', () => {
    const r = runLoanAuditPipeline(baseInput({}));
    assert.equal(r.reportTextResult, null);
    assert.equal(r.pdfResult, null);
    assert.ok(r.reportModelResult?.reportModel); // model still built
  });
});

/* ------------------------------------------------------------------ */
/* audit context                                                       */
/* ------------------------------------------------------------------ */

describe('loanAuditPipelineRunner: audit context', () => {
  it('audit entries carry stage context (test 13)', () => {
    // comparison (unmatched), reconciliation (unmatched payment) and
    // the skipped-stage notes all emit entries deterministically;
    // assert each present entry is stage-tagged, and that the stage
    // names are threaded through:
    const r = runLoanAuditPipeline(
      baseInput({
        bankRows: [...alignedBankRows({ firstInstallment: 310_000 }), bankRow({ rowId: 'bX', dueDate: '2024-09-30' })],
        actualPayments: [payment('P1', '2024-12-25', 304_500)],
        renderText: true,
        renderPdf: true,
      }),
    );
    // every entry is tagged with a known stage:
    const known = new Set(['schedule', 'comparison', 'findings', 'reconciliation', 'reportModel', 'reportText', 'pdf']);
    for (const e of r.auditEntries) {
      const stage = (e.context as Record<string, unknown>)['stage'];
      assert.ok(typeof stage === 'string' && known.has(stage), `bad stage tag: ${String(stage)}`);
    }
    // stages that deterministically emit entries are represented:
    const stages = new Set(r.auditEntries.map((e) => (e.context as Record<string, unknown>)['stage']));
    for (const stage of ['comparison', 'reconciliation', 'reportModel']) {
      assert.ok(stages.has(stage), `missing stage context: ${stage}`);
    }
  });

  it('a skipped stage emits a stage-tagged note', () => {
    const r = runLoanAuditPipeline(baseInput({})); // no payments -> reconciliation skipped
    const skip = r.auditEntries.find((e) => e.code === PL.PIPELINE_RECONCILIATION_SKIPPED);
    assert.ok(skip);
    assert.equal((skip.context as Record<string, unknown>)['stage'], 'reconciliation');
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('loanAuditPipelineRunner: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/engines/loanAuditPipelineRunner.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no formulas implemented in orchestrator (test 14)', () => {
    // no arithmetic of interest/rate/day-count/amortization here:
    assert.equal(/fractionOfYear|yearBasis|Math\.pow|ratePercent\s*\/\s*100|\*\s*fraction|toPrecision|addOneMonth/.test(codeOnly), false);
    // it calls engines, not their internals:
    assert.ok(/buildEqualPrincipalSchedule|buildEqualInstallmentSchedule/.test(codeOnly));
    assert.ok(/compareSchedules|generateFindings|reconcileActualPayments/.test(codeOnly));
  });

  it('no UI/HTML/React introduced (test 15)', () => {
    assert.equal(/React|jsx|className|innerHTML|document\.|window\.|<div|<\//i.test(codeOnly), false);
  });

  it('no Excel/OCR/backend/persistence introduced (test 16)', () => {
    assert.equal(/xlsx|excel|ocr|tesseract|fetch\(|http|express|sqlite|localStorage|writeFile/i.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula (test 17)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });
});
