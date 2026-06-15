/**
 * Tests: report model builder (Step 7-A).
 * Covers the 22 required scenarios. Locked comparison + findings
 * engines produce the real upstream inputs (no mocks).
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
  buildLoanAuditReportModel,
  REPORT_BUILDER_AUDIT_CODES as RC,
  REPORT_TITLE,
  type ReportModelBuilderInput,
} from '../src/engines/reportModelBuilder';
import { compareSchedules } from '../src/engines/scheduleComparisonEngine';
import {
  generateFindings,
  findForbiddenFindingTerms,
  type FindingsResult,
} from '../src/engines/findingsEngine';
import { moneyFromCents, type NullableMoney } from '../src/domain/money';
import { warning } from '../src/domain/auditFactories';
import { toISODate } from '../src/domain/dateTypes';
import type { BankScheduleRow, RecalcRow } from '../src/domain/scheduleTypes';
import type { CaseInfo } from '../src/domain/loanTypes';

const D = toISODate;
const M = (cents: number) => moneyFromCents(cents);

const caseInfo: CaseInfo = {
  caseId: 'CASE-001',
  debtorName: 'Δοκιμαστικός Οφειλέτης',
  contractNumber: '4500-123456-7',
  institution: 'Τράπεζα Α',
  servicer: 'Servicer Β',
  contractDate: D('2018-03-15'),
  restructuringDate: null,
  principal: M(1_000_000),
  currency: 'EUR',
  startDate: D('2024-01-01'),
  endDate: D('2024-04-30'),
  termMonths: 3,
  notes: null,
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

function recalcRow(args: { rowId: string; dueDate: string; installment?: number }): RecalcRow {
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    openingBalance: M(1_000_000),
    appliedAnnualRatePercent: 6,
    rateBreakdown: { indexPercent: null, spreadPercent: null, law128Percent: 0, totalPercent: 6 },
    dayCountDays: 30,
    interest: M(24_708),
    principal: M(40_000),
    installment: M(args.installment ?? 64_708),
    closingBalance: M(960_000),
    assumptions: [],
  };
}

const methodology = {
  scheduleType: 'τοκοχρεολυτικό σταθερής δόσης',
  rateDescription: 'σταθερό 6,00% με εισφορά Ν.128/75 περιλαμβανόμενη',
  dayCountConvention: 'ACT/360',
  law128Status: 'περιλαμβάνεται στο συμβατικό επιτόκιο',
  negativeIndexPolicy: 'δεν εφαρμόζεται (σταθερό επιτόκιο)',
  roundingPolicy: 'half-up στο πλησιέστερο λεπτό ανά περίοδο',
  dataCoverageNote: 'πλήρης κάλυψη περιόδων',
};

const cleanComparison = () =>
  compareSchedules({
    bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-02-29' })],
    recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-29' })],
  });

const buildClean = (overrides: Partial<ReportModelBuilderInput> = {}) => {
  const comparisonResult = overrides.comparisonResult ?? cleanComparison();
  const findingsResult =
    overrides.findingsResult ?? generateFindings({ comparisonResult });
  return buildLoanAuditReportModel({
    caseInfo,
    comparisonResult,
    findingsResult,
    methodology,
    generatedAt: '2026-06-12T10:00:00.000Z',
    preparedBy: {
      name: 'Γ. Οικονομίδης',
      professionalTitle: 'Οικονομολόγος',
      officeName: 'Γραφείο Οικονομικών Μελετών',
      contact: 'info@example.gr',
    },
    ...overrides,
  });
};

/* ------------------------------------------------------------------ */
/* clean path                                                          */
/* ------------------------------------------------------------------ */

describe('reportModelBuilder: clean path', () => {
  it('clean comparison + clean findings -> success ReportModel (test 1)', () => {
    const r = buildClean();
    assert.equal(r.status, 'success');
    assert.ok(r.reportModel);
    assert.equal(r.reportModel.generatedAt, '2026-06-12T10:00:00.000Z');
  });

  it('report title is the required neutral title (test 2)', () => {
    const r = buildClean();
    assert.equal(REPORT_TITLE, 'Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου');
    assert.ok(r.reportModel!.inputSummary.startsWith(REPORT_TITLE));
  });

  it('CaseInfo is preserved by reference content (test 3)', () => {
    const r = buildClean();
    assert.deepEqual(r.reportModel!.caseInfo, caseInfo);
    assert.ok(r.reportModel!.inputSummary.includes('4500-123456-7'));
  });

  it('comparison summary preserved without recomputation (test 4)', () => {
    const cmp = cleanComparison();
    const r = buildClean({ comparisonResult: cmp });
    const s = r.reportModel!.comparisonSummary;
    assert.equal(s.periodsCompared, cmp.summary!.comparedRowCount);
    assert.equal(s.periodsWithMissingData, cmp.summary!.excludedRowCount);
    assert.equal(s.periodsWithDeviation, cmp.summary!.rowsRequiringReviewCount);
    assert.equal(s.totalInterestDifference?.cents, cmp.summary!.totalInterestDifferenceCents);
    assert.equal(s.totalPrincipalDifference?.cents, cmp.summary!.totalPrincipalDifferenceCents);
  });

  it('findings preserved without sign change (tests 5, 6)', () => {
    const positive = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const negative = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 64_525 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });

    const rp = buildClean({ comparisonResult: positive });
    const fp = rp.reportModel!.findings.find((f) => f.title.includes('απόκλιση δόσης'));
    assert.ok(fp);
    assert.equal(fp.magnitude?.cents, 532); // bank − recalculated, untouched

    const rn = buildClean({ comparisonResult: negative });
    const fn = rn.reportModel!.findings.find((f) => f.title.includes('απόκλιση δόσης'));
    assert.ok(fn);
    assert.equal(fn.magnitude?.cents, -183); // sign preserved
    // findingIds preserved from the findings engine:
    assert.ok(/^F-\d{3}$/.test(fn.findingId));
  });
});

/* ------------------------------------------------------------------ */
/* status propagation                                                  */
/* ------------------------------------------------------------------ */

describe('reportModelBuilder: status propagation', () => {
  it('requires_review comparison -> requires_review report (test 7)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-06-30' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const r = buildClean({ comparisonResult: cmp });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.reportModel); // model still produced, with limitations
  });

  it('requires_review findings -> requires_review report (test 8)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 66_000 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const fr = generateFindings({ comparisonResult: cmp });
    assert.equal(fr.status, 'requires_review'); // sanity
    const r = buildClean({ comparisonResult: cmp, findingsResult: fr });
    assert.equal(r.status, 'requires_review');
  });

  it('missing_data comparison -> missing_data, model null, no fake totals (test 9)', () => {
    const cmp = compareSchedules({ bankRows: [], recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })] });
    const fr = generateFindings({ comparisonResult: cmp });
    const r = buildClean({ comparisonResult: cmp, findingsResult: fr });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.reportModel, null);
    assert.ok(r.auditEntries.some((e) => e.code === RC.REPORT_INPUT_MISSING));
  });

  it('critically missing case info -> missing_data, model null', () => {
    const broken = { ...caseInfo, principal: null as never } as CaseInfo;
    const r = buildClean({ caseInfo: broken });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.reportModel, null);
  });
});

/* ------------------------------------------------------------------ */
/* limitations & missing data                                          */
/* ------------------------------------------------------------------ */

describe('reportModelBuilder: limitations & missing data', () => {
  it('null totals preserved and described in limitations (test 10)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: null })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    assert.equal(cmp.summary?.totalEconomicDifferenceCents, null); // sanity
    const r = buildClean({ comparisonResult: cmp });
    assert.equal(r.status, 'requires_review');
    assert.ok(
      r.reportModel!.limitations.some((l) => l.includes('συνολική οικονομική διαφορά δεν οριστικοποιείται')),
    );
    assert.ok(
      r.reportModel!.missingData.some((m) => m.field === 'total_economic_difference'),
    );
    // and the text describes non-finalizable, never a fake zero:
    assert.ok(r.reportModel!.bankScheduleSummary.includes('δεν οριστικοποιείται'));
  });

  it('unmatched rows create limitations (test 11)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-06-30' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-08-31' })],
    });
    const r = buildClean({ comparisonResult: cmp });
    assert.ok(r.reportModel!.limitations.some((l) => l.includes('γραμμές δοσολογίου τράπεζας / fund δεν αντιστοιχίστηκαν')));
    assert.ok(r.reportModel!.limitations.some((l) => l.includes('γραμμές επανυπολογισμού δεν αντιστοιχίστηκαν')));
    assert.ok(r.reportModel!.missingData.some((m) => m.field === 'row_matching'));
  });

  it('excluded rows create limitations (test 12)', () => {
    const cmp = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31' }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: null }),
      ],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-29' })],
    });
    const r = buildClean({ comparisonResult: cmp });
    assert.ok(r.reportModel!.limitations.some((l) => l.includes('εξαιρέθηκαν από τα σύνολα λόγω ελλιπών τιμών')));
  });

  it('limitations never empty; disclaimer always present (test 17)', () => {
    const r = buildClean();
    assert.ok(r.reportModel!.limitations.length >= 1);
    assert.ok(r.reportModel!.limitations[0]!.includes('γνωμοδότηση νομικού περιεχομένου'));
  });
});

/* ------------------------------------------------------------------ */
/* wording safety                                                      */
/* ------------------------------------------------------------------ */

describe('reportModelBuilder: wording safety', () => {
  it('non-report-safe finding -> requires_review + audit warning, model with limitation (test 13)', () => {
    const comparisonResult = cleanComparison();
    const base = generateFindings({ comparisonResult });
    const poisoned: FindingsResult = {
      ...base,
      findings: [
        ...base.findings,
        {
          findingId: 'F-099',
          level: 'requires_review',
          title: 'Εύρημα',
          description: 'Το ποσό είναι αχρεωστήτως καταβληθέν.',
          affectedRowIds: [],
          affectedPeriods: [],
          amountCents: 1_000,
          count: 1,
          source: 'audit',
          reportSafe: false,
        },
      ],
    };
    const r = buildClean({ comparisonResult, findingsResult: poisoned });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.reportModel); // still produced
    assert.ok(r.auditEntries.some((e) => e.code === RC.FINDING_NOT_REPORT_SAFE));
    assert.ok(r.reportModel.limitations.some((l) => l.includes('μη ουδέτερης γλώσσας')));
    // the offending text never reaches the model:
    const f = r.reportModel.findings.find((x) => x.findingId === 'F-099');
    assert.ok(f);
    assert.equal(f.description.includes('αχρεωστήτως'), false);
    assert.equal(f.magnitude?.cents, 1_000); // amount preserved
  });

  it('forbidden wording in additionalNotes is caught and replaced (test 14)', () => {
    const r = buildClean({ additionalNotes: ['Η χρέωση είναι παράνομη και διεκδικήσιμη.'] });
    assert.equal(r.status, 'requires_review');
    const e = r.auditEntries.find((x) => x.code === RC.REPORT_TEXT_NOT_NEUTRAL);
    assert.ok(e);
    assert.ok(r.reportModel!.limitations.some((l) => l.includes('εξαιρέθηκε από τη μελέτη λόγω μη ουδέτερης διατύπωσης')));
    assert.equal(r.reportModel!.limitations.some((l) => l.includes('παράνομη')), false);
  });

  it('forbidden wording in generated/methodology text is caught (test 15)', () => {
    const r = buildClean({
      methodology: { ...methodology, rateDescription: 'επιτόκιο που η τράπεζα οφείλει να επιστρέψει ως αχρεωστήτως' },
    });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.auditEntries.some((e) => e.code === RC.REPORT_TEXT_NOT_NEUTRAL));
    assert.equal(r.reportModel!.methodology.includes('αχρεωστήτως'), false);
  });

  it('no legal wording in final ReportModel for clean input (test 18)', () => {
    const r = buildClean();
    const model = r.reportModel!;
    const texts = [
      model.inputSummary,
      model.methodology,
      model.bankScheduleSummary,
      model.recalculationSummary,
      ...model.limitations,
      ...model.findings.flatMap((f) => [f.title, f.description]),
      ...model.missingData.flatMap((m) => [m.description, m.impact]),
    ];
    for (const t of texts) {
      assert.deepEqual([...findForbiddenFindingTerms(t)], [], t);
    }
  });
});

/* ------------------------------------------------------------------ */
/* methodology                                                         */
/* ------------------------------------------------------------------ */

describe('reportModelBuilder: methodology', () => {
  it('methodology states all six required elements (test 16)', () => {
    const r = buildClean();
    const m = r.reportModel!.methodology;
    assert.ok(m.includes('τοκοχρεολυτικό σταθερής δόσης')); // schedule type
    assert.ok(m.includes('σταθερό 6,00%')); // rate
    assert.ok(m.includes('ACT/360')); // day count
    assert.ok(m.includes('Ν.128/75')); // law 128/75
    assert.ok(m.includes('αρνητικού δείκτη')); // negative index policy
    assert.ok(m.includes('στρογγυλοποίησης')); // rounding policy
    assert.ok(m.includes('Κάλυψη δεδομένων')); // coverage
    assert.ok(m.includes('τεχνικός οικονομικός επανυπολογισμός'));
    assert.ok(m.includes('βάσει διαθέσιμων δεδομένων'));
    assert.ok(m.includes('σύγκριση με τραπεζικά δεδομένα') || m.includes('σύγκριση με τραπεζικά'));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('reportModelBuilder: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../src/engines/reportModelBuilder.ts'), 'utf8');
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no PDF / markup / component rendering (test 19)', () => {
    assert.equal(/\bpdf\b|jsPDF|pdfkit|<\w+\s|innerHTML|document\.|window\.|React|jsx|render\s*\(/i.test(codeOnly), false);
  });

  it('no schedule generation / amortization logic (test 20)', () => {
    assert.equal(/buildEqual|buildSingleRecalcRow|allocateSinglePayment|resolveRateForDate|calculateDayCount|calculateAccruedInterest|Math\.pow|addOneMonth/.test(codeOnly), false);
  });

  it('no comparison or findings recomputation (test 21)', () => {
    assert.equal(/compareSchedules\s*\(|generateFindings\s*\(/.test(codeOnly), false);
  });

  it('no reconciliation recomputation: reconcileActualPayments is never called (Step 9-B test 14)', () => {
    assert.equal(/reconcileActualPayments\s*\(/.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula (test 22)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });
});

/* ------------------------------------------------------------------ */
/* Step 9-B: payment reconciliation integration                        */
/* ------------------------------------------------------------------ */

describe('reportModelBuilder: payment reconciliation integration (Step 9-B)', () => {
  // minimal helpers local to this block
  const recRow = (id: string, due: string, installment: number): RecalcRow => ({
    rowId: id,
    dueDate: toISODate(due),
    openingBalance: moneyFromCents(1_000_000),
    appliedAnnualRatePercent: 6,
    rateBreakdown: { indexPercent: null, spreadPercent: null, law128Percent: 0, totalPercent: 6 },
    dayCountDays: 30,
    interest: moneyFromCents(24_708),
    principal: moneyFromCents(40_000),
    installment: moneyFromCents(installment),
    closingBalance: moneyFromCents(960_000),
    assumptions: [],
  });

  // a reconciliation result is just data to this engine; build it directly
  const reconResult = (over: Partial<import('../src/engines/paymentReconciliationEngine').PaymentReconciliationResult>): import('../src/engines/paymentReconciliationEngine').PaymentReconciliationResult => ({
    status: 'success',
    rows: [],
    summary: {
      totalActualPaidCents: 130_000,
      totalBankDueCents: 130_000,
      totalRecalculatedDueCents: 129_416,
      totalDifferenceVsBankCents: 0,
      totalDifferenceVsRecalculatedCents: 584,
      matchedPaymentCount: 2,
      unmatchedPaymentCount: 0,
      unmatchedDueCount: 0,
      rowsRequiringReviewCount: 0,
      excludedRowCount: 0,
    },
    unmatchedPayments: [],
    unmatchedBankRows: [],
    unmatchedRecalcRows: [],
    auditEntries: [],
    ...over,
  });

  it('behaviour unchanged when no reconciliation result is provided (test 1)', () => {
    const r = buildClean();
    assert.equal(r.status, 'success');
    assert.equal(r.reportModel!.comparisonSummary.totalActualPaidDifference, null);
  });

  it('success reconciliation maps totalActualPaidDifference from vs-recalculated (test 2)', () => {
    const r = buildClean({ paymentReconciliationResult: reconResult({}) });
    assert.equal(r.reportModel!.comparisonSummary.totalActualPaidDifference?.cents, 584);
    assert.ok(r.reportModel!.recalculationSummary.includes('Συμφωνία πραγματικών καταβολών'));
  });

  it('reconciliation totals preserve positive sign (test 3)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({
        summary: { ...reconResult({}).summary!, totalDifferenceVsRecalculatedCents: 1_234 },
      }),
    });
    assert.equal(r.reportModel!.comparisonSummary.totalActualPaidDifference?.cents, 1_234);
    assert.ok(r.reportModel!.recalculationSummary.includes('+12,34'));
  });

  it('reconciliation totals preserve negative sign (test 4)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({
        summary: { ...reconResult({}).summary!, totalDifferenceVsRecalculatedCents: -987 },
      }),
    });
    assert.equal(r.reportModel!.comparisonSummary.totalActualPaidDifference?.cents, -987);
    assert.ok(r.reportModel!.recalculationSummary.includes('-9,87'));
  });

  it('null vs-recalculated total stays null and creates limitation; bank-only labelled separately (test 5)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({
        status: 'requires_review',
        summary: {
          ...reconResult({}).summary!,
          totalDifferenceVsRecalculatedCents: null,
          totalRecalculatedDueCents: null,
          totalDifferenceVsBankCents: 250,
        },
      }),
    });
    assert.equal(r.reportModel!.comparisonSummary.totalActualPaidDifference, null);
    // bank-only difference labelled, not promoted to recalculated:
    assert.ok(r.reportModel!.recalculationSummary.includes('έναντι τράπεζας / fund: +2,50'));
    assert.equal(r.status, 'requires_review');
  });

  it('missing_data reconciliation does not fake totals (test 6)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({ status: 'missing_data', summary: null }),
    });
    assert.equal(r.reportModel!.comparisonSummary.totalActualPaidDifference, null);
    assert.ok(r.reportModel!.missingData.some((m) => m.field === 'payment_reconciliation'));
    assert.ok(r.reportModel!.recalculationSummary.includes('δεν οριστικοποιείται'));
    assert.equal(r.status, 'requires_review');
  });

  it('requires_review reconciliation makes the report requires_review (test 7)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({ status: 'requires_review' }),
    });
    assert.equal(r.status, 'requires_review');
  });

  it('unmatched payments create a limitation (test 8)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({
        status: 'requires_review',
        summary: { ...reconResult({}).summary!, unmatchedPaymentCount: 2 },
      }),
    });
    assert.ok(r.reportModel!.limitations.some((l) => l.includes('πραγματικές καταβολές δεν αντιστοιχίστηκαν')));
  });

  it('unmatched due rows create a limitation (test 9)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({
        status: 'requires_review',
        summary: { ...reconResult({}).summary!, unmatchedDueCount: 3 },
      }),
    });
    assert.ok(r.reportModel!.limitations.some((l) => l.includes('δόσεις χωρίς αντιστοιχισμένη πραγματική καταβολή')));
  });

  it('excluded reconciliation rows create a limitation (test 10)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({
        status: 'requires_review',
        summary: { ...reconResult({}).summary!, excludedRowCount: 1 },
      }),
    });
    assert.ok(r.reportModel!.limitations.some((l) => l.includes('γραμμές συμφωνίας εξαιρέθηκαν')));
  });

  it('missing payment amount path creates a missingData item via excluded rows (test 11)', () => {
    const r = buildClean({
      paymentReconciliationResult: reconResult({
        status: 'requires_review',
        summary: { ...reconResult({}).summary!, excludedRowCount: 2 },
      }),
    });
    assert.ok(r.reportModel!.missingData.some((m) => m.field === 'reconciliation_excluded_rows'));
  });

  it('reconciliation sign convention text is present and distinct from comparison (test 12)', () => {
    const r = buildClean({ paymentReconciliationResult: reconResult({}) });
    const recalc = r.reportModel!.recalculationSummary;
    // reconciliation convention:
    assert.ok(recalc.includes('πραγματικά καταβληθέντα μείον οφειλόμενο ποσό'));
    // and it explicitly distinguishes itself from the comparison convention:
    assert.ok(recalc.includes('διακριτή από τη σύμβαση σύγκρισης'));
  });

  it('forbidden wording in reconciliation notes is caught (test 13)', () => {
    // inject a poisoned reconciliation audit entry; it flows into the
    // report audit trail but the screened summary text stays neutral,
    // and the model-level guard remains intact:
    const poisoned = reconResult({
      auditEntries: [warning('UNMATCHED_PAYMENT', 'Ποσό προς επιστροφή ως αχρεωστήτως.', {})],
    });
    const r = buildClean({ paymentReconciliationResult: poisoned });
    // the model's own generated reconciliation text carries no forbidden term:
    assert.deepEqual([...findForbiddenFindingTerms(r.reportModel!.recalculationSummary)], []);
  });
});
