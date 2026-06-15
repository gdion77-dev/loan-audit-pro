/**
 * Tests: report text renderer (Step 7-B).
 * Covers the 16 required scenarios. ReportModels are produced by the
 * real locked pipeline: compareSchedules → generateFindings →
 * buildLoanAuditReportModel (no mocks).
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
  renderLoanAuditReportText,
  RENDER_AUDIT_CODES,
  RENDERED_REPORT_TITLE,
  NOT_FINALIZED_TEXT,
  SIGN_CONVENTION_TEXT,
} from '../src/renderers/reportTextRenderer';
import { buildLoanAuditReportModel } from '../src/engines/reportModelBuilder';
import { compareSchedules } from '../src/engines/scheduleComparisonEngine';
import { generateFindings, findForbiddenFindingTerms } from '../src/engines/findingsEngine';
import { createReportModel, type ReportModel } from '../src/domain/reportTypes';
import { moneyFromCents, type NullableMoney } from '../src/domain/money';
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
  interest?: number | null;
}): BankScheduleRow {
  const c = (v: number | null | undefined, def: number): NullableMoney =>
    v === null ? null : M(v ?? def);
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    installmentAmount: c(args.installment, 64_708),
    principalPortion: M(40_000),
    interestPortion: c(args.interest, 24_708),
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

/** Real pipeline: comparison → findings → report model. */
function modelFor(
  bankRows: BankScheduleRow[],
  recalcRows: RecalcRow[],
): ReportModel {
  const comparisonResult = compareSchedules({ bankRows, recalcRows });
  const findingsResult = generateFindings({ comparisonResult });
  const built = buildLoanAuditReportModel({
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
  });
  assert.ok(built.reportModel, 'pipeline must produce a model for the test');
  return built.reportModel;
}

const cleanModel = () =>
  modelFor(
    [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-02-29' })],
    [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-29' })],
  );

const REQUIRED_SECTION_TITLES = [
  'Εξώφυλλο / Ταυτότητα Μελέτης',
  'Στοιχεία Υπόθεσης',
  'Σύνοψη Ελέγχου',
  'Δεδομένα Τράπεζας / Fund',
  'Δεδομένα Επανυπολογισμού',
  'Μεθοδολογία Επανυπολογισμού',
  'Συγκριτικά Αποτελέσματα',
  'Τεχνικά Οικονομικά Ευρήματα',
  'Ελλείποντα Δεδομένα',
  'Περιορισμοί Μελέτης',
  'Δήλωση Περιορισμού',
  'Στοιχεία Συντάκτη / Γραφείου',
];

/* ------------------------------------------------------------------ */
/* structure & formatting                                              */
/* ------------------------------------------------------------------ */

describe('reportTextRenderer: structure & formatting', () => {
  it('successful model renders ALL 12 required sections in order (test 1)', () => {
    const r = renderLoanAuditReportText(cleanModel());
    assert.equal(r.status, 'success');
    assert.equal(r.sections.length, 12);
    assert.deepEqual(
      r.sections.map((s) => s.title),
      REQUIRED_SECTION_TITLES,
    );
    // levels populated and constrained:
    const allowed = new Set(['cover', 'summary', 'methodology', 'findings', 'limitations', 'appendix']);
    for (const s of r.sections) assert.ok(allowed.has(s.level), s.level);
    assert.equal(r.sections[0]!.level, 'cover');
    assert.equal(r.sections[7]!.level, 'findings');
    assert.equal(r.sections[10]!.level, 'limitations');
    // every section body appears in fullText:
    for (const s of r.sections) assert.ok(r.fullText.includes(s.title));
  });

  it('title is exactly the required neutral title (test 2)', () => {
    const r = renderLoanAuditReportText(cleanModel());
    assert.equal(r.title, 'Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου');
    assert.equal(RENDERED_REPORT_TITLE, 'Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου');
    assert.ok(r.fullText.startsWith('Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου'));
  });

  it('Greek euro formatting works (test 3)', () => {
    const r = renderLoanAuditReportText(cleanModel());
    // principal €10,000.00 -> «10.000,00 €» in Στοιχεία Υπόθεσης:
    const s02 = r.sections.find((s) => s.sectionId === 'S02')!;
    assert.ok(s02.body.includes('10.000,00 €'), s02.body);
  });

  it('null amount renders as not finalized, never 0,00 € (test 4)', () => {
    // bank interest missing -> totalInterestDifference null:
    const model = modelFor(
      [bankRow({ rowId: 'b1', dueDate: '2024-01-31', interest: null })],
      [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    );
    assert.equal(model.comparisonSummary.totalInterestDifference, null); // sanity
    const r = renderLoanAuditReportText(model);
    const s03 = r.sections.find((s) => s.sectionId === 'S03')!;
    const interestLine = s03.body.split('\n').find((l) => l.includes('διαφορά τόκων'))!;
    assert.ok(interestLine.includes(NOT_FINALIZED_TEXT), interestLine);
    assert.equal(interestLine.includes('0,00 €'), false);
  });

  it('positive economic difference keeps its sign (+) (test 5)', () => {
    const model = modelFor(
      [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 })],
      [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    );
    const r = renderLoanAuditReportText(model);
    const s08 = r.sections.find((s) => s.sectionId === 'S08')!;
    assert.ok(s08.body.includes('+5,32'), s08.body); // +532 cents, explicit sign
  });

  it('negative economic difference keeps its sign (−) (test 6)', () => {
    const model = modelFor(
      [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 64_525 })],
      [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    );
    const r = renderLoanAuditReportText(model);
    const s08 = r.sections.find((s) => s.sectionId === 'S08')!;
    assert.ok(s08.body.includes('-1,83'), s08.body); // −183 cents preserved
    assert.equal(s08.body.includes('+1,83'), false);
  });

  it('sign convention explanation appears wherever differences appear (test 7)', () => {
    const r = renderLoanAuditReportText(cleanModel());
    for (const id of ['S03', 'S07', 'S08']) {
      const s = r.sections.find((x) => x.sectionId === id)!;
      assert.ok(s.body.includes(SIGN_CONVENTION_TEXT), id);
    }
    assert.equal(
      SIGN_CONVENTION_TEXT,
      'Η οικονομική διαφορά υπολογίζεται ως ποσό Τράπεζας/Fund μείον ποσό επανυπολογισμού.',
    );
  });

  it('findings rendered without changing amount or sign (test 8)', () => {
    const model = modelFor(
      [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 })],
      [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    );
    const deviation = model.findings.find((f) => f.title.includes('απόκλιση δόσης'))!;
    assert.equal(deviation.magnitude?.cents, 532); // sanity: model value
    const r = renderLoanAuditReportText(model);
    const s08 = r.sections.find((s) => s.sectionId === 'S08')!;
    // findingId and the exact magnitude both appear, unaltered:
    assert.ok(s08.body.includes(`[${deviation.findingId}]`));
    assert.ok(s08.body.includes('+5,32'));
  });
});

/* ------------------------------------------------------------------ */
/* limitations                                                         */
/* ------------------------------------------------------------------ */

describe('reportTextRenderer: limitations', () => {
  it('limitations sections always exist with the disclaimer (test 9)', () => {
    const r = renderLoanAuditReportText(cleanModel());
    const s10 = r.sections.find((s) => s.sectionId === 'S10')!;
    const s11 = r.sections.find((s) => s.sectionId === 'S11')!;
    assert.ok(s10.body.length > 0);
    assert.ok(s11.body.includes('τεχνική οικονομική αποτύπωση'));
    assert.ok(s11.body.includes('γνωμοδότηση νομικού περιεχομένου'));
  });

  it('requires_review report states explicitly WHY in limitations (test 10)', () => {
    // unmatched bank row -> review path through the whole pipeline:
    const model = modelFor(
      [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-06-30' })],
      [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    );
    const r = renderLoanAuditReportText(model);
    const s10 = r.sections.find((s) => s.sectionId === 'S10')!;
    assert.ok(s10.body.includes('Η μελέτη φέρει σήμανση «Απαιτείται έλεγχος» για τους εξής λόγους'), s10.body);
    assert.ok(s10.body.includes('δεν αντιστοιχίστηκαν'));
  });
});

/* ------------------------------------------------------------------ */
/* wording safety                                                      */
/* ------------------------------------------------------------------ */

describe('reportTextRenderer: wording safety', () => {
  it('forbidden wording injected into the model is caught (test 11)', () => {
    // the Step 1-A createReportModel guard does NOT include the
    // extended terms (e.g. «δικαιούται»), so such text can reach a
    // model and the RENDERER must catch it:
    const base = cleanModel();
    const poisoned = createReportModel(
      {
        caseInfo: base.caseInfo,
        inputSummary: base.inputSummary,
        methodology: base.methodology,
        bankScheduleSummary: base.bankScheduleSummary,
        recalculationSummary: base.recalculationSummary,
        comparisonSummary: base.comparisonSummary,
        findings: base.findings,
        missingData: base.missingData,
        limitations: [...base.limitations, 'Ο οφειλέτης δικαιούται επιστροφή ποσών.'],
        auditEntries: base.auditEntries,
      },
      () => new Date('2026-06-12T10:00:00.000Z'),
    );
    const r = renderLoanAuditReportText(poisoned);
    assert.equal(r.status, 'requires_review');
    const e = r.auditEntries.find((x) => x.code === RENDER_AUDIT_CODES.RENDER_TEXT_NOT_NEUTRAL);
    assert.ok(e);
    assert.ok(((e.context as Record<string, unknown>)['terms'] as string[]).includes('δικαιούται'));
    assert.equal(r.fullText.includes('δικαιούται'), false); // replaced
    assert.ok(r.fullText.includes('εξαιρέθηκε από τη μελέτη λόγω μη ουδέτερης διατύπωσης'));
  });

  it('the phrase «νομική γνωμοδότηση» does not appear (test 12)', () => {
    const r = renderLoanAuditReportText(cleanModel());
    assert.equal(r.fullText.toLowerCase().includes('νομική γνωμοδότηση'), false);
  });

  it('Ν.3869 and ΑΠ 6/2026 do not appear in output (test 13)', () => {
    const r = renderLoanAuditReportText(cleanModel());
    assert.equal(/3869/.test(r.fullText), false);
    assert.equal(/6\s*\/\s*2026/.test(r.fullText), false);
    // and if injected upstream, they are screened out:
    const base = cleanModel();
    const poisoned = createReportModel(
      {
        caseInfo: base.caseInfo,
        inputSummary: base.inputSummary,
        methodology: base.methodology,
        bankScheduleSummary: base.bankScheduleSummary,
        recalculationSummary: base.recalculationSummary,
        comparisonSummary: base.comparisonSummary,
        findings: base.findings,
        missingData: base.missingData,
        limitations: [...base.limitations, 'Κατά τα οριζόμενα στον Ν.3869/2010.'],
        auditEntries: base.auditEntries,
      },
      () => new Date('2026-06-12T10:00:00.000Z'),
    );
    const rp = renderLoanAuditReportText(poisoned);
    assert.equal(rp.status, 'requires_review');
    assert.equal(/3869/.test(rp.fullText), false);
  });

  it('no legal conclusion wording in clean output (test 16)', () => {
    const model = modelFor(
      [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: null }),
        bankRow({ rowId: 'b3', dueDate: '2024-06-30' }),
      ],
      [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-29' })],
    );
    const r = renderLoanAuditReportText(model);
    assert.deepEqual([...findForbiddenFindingTerms(r.fullText)], []);
    for (const s of r.sections) {
      assert.deepEqual([...findForbiddenFindingTerms(s.body)], [], s.sectionId);
    }
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('reportTextRenderer: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/renderers/reportTextRenderer.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no PDF/HTML/React rendering is implemented (test 14)', () => {
    assert.equal(/\bpdf\b|jsPDF|pdfkit|innerHTML|document\.|window\.|React|className|<\/|\.html/i.test(codeOnly), false);
  });

  it('no schedule/comparison/findings recalculation exists (test 15)', () => {
    assert.equal(
      /compareSchedules\s*\(|generateFindings\s*\(|buildLoanAuditReportModel\s*\(|buildEqual|buildSingleRecalcRow|allocateSinglePayment|resolveRateForDate|calculateDayCount|calculateAccruedInterest|Math\.pow/.test(codeOnly),
      false,
    );
  });

  it('Ν.3869 / ΑΠ 6/2026 appear in code ONLY inside the banned-fragments guard', () => {
    // remove the guard list declaration, then the fragments must be absent:
    const withoutGuardList = codeOnly.replace(
      /const RENDERER_BANNED_FRAGMENTS[\s\S]*?\];/,
      '',
    );
    assert.equal(/3869/.test(withoutGuardList), false);
    assert.equal(/6\s*\/\s*2026/.test(withoutGuardList), false);
    // sanity: the guard list itself exists
    assert.ok(/RENDERER_BANNED_FRAGMENTS/.test(codeOnly));
  });
});
