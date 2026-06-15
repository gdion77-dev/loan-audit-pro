/**
 * Fixtures: ReportTextRenderResult inputs for the PDF spike tests.
 * The "real" fixture runs the full locked pipeline:
 * compareSchedules → generateFindings → buildLoanAuditReportModel →
 * renderLoanAuditReportText. The "long" fixture is synthetic data of
 * the same shape, used only to force multi-page output.
 */
import assert from 'node:assert/strict';

import { compareSchedules } from '../../src/engines/scheduleComparisonEngine';
import { generateFindings } from '../../src/engines/findingsEngine';
import { buildLoanAuditReportModel } from '../../src/engines/reportModelBuilder';
import {
  renderLoanAuditReportText,
  type ReportTextRenderResult,
} from '../../src/renderers/reportTextRenderer';
import { moneyFromCents, type NullableMoney } from '../../src/domain/money';
import { toISODate } from '../../src/domain/dateTypes';
import type { BankScheduleRow, RecalcRow } from '../../src/domain/scheduleTypes';
import type { CaseInfo } from '../../src/domain/loanTypes';

const D = toISODate;
const M = (cents: number) => moneyFromCents(cents);

export const fixtureCaseInfo: CaseInfo = {
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

export function fixtureBankRow(args: {
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

export function fixtureRecalcRow(args: {
  rowId: string;
  dueDate: string;
  installment?: number;
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

/** Full locked pipeline → rendered report text. */
export function realReportText(args?: {
  bankRows?: BankScheduleRow[];
  recalcRows?: RecalcRow[];
}): ReportTextRenderResult {
  const bankRows = args?.bankRows ?? [
    // +5,32 € installment deviation on row 1; −1,83 € interest
    // deviation on row 2 — two categories, so both signed amounts
    // appear as separate grouped findings:
    fixtureBankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 }),
    fixtureBankRow({ rowId: 'b2', dueDate: '2024-02-29', interest: 24_525 }),
  ];
  const recalcRows = args?.recalcRows ?? [
    fixtureRecalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
    fixtureRecalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
  ];
  const comparisonResult = compareSchedules({ bankRows, recalcRows });
  const findingsResult = generateFindings({ comparisonResult });
  const built = buildLoanAuditReportModel({
    caseInfo: fixtureCaseInfo,
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
  assert.ok(built.reportModel, 'fixture pipeline must produce a model');
  return renderLoanAuditReportText(built.reportModel);
}

/** Same shape, synthetically long bodies — forces multi-page PDF. */
export function longReportText(): ReportTextRenderResult {
  const base = realReportText();
  const filler =
    'Η σύγκριση με τραπεζικά δεδομένα διενεργήθηκε βάσει διαθέσιμων δεδομένων και κάθε οικονομική απόκλιση καταγράφεται με ουδέτερη ορολογία. '.repeat(40);
  return {
    ...base,
    sections: base.sections.map((s) => ({ ...s, body: `${s.body}\n${filler}` })),
    fullText: `${base.fullText}\n${filler}`,
  };
}

/** Poisoned text of the same shape — must be blocked before render. */
export function poisonedReportText(): ReportTextRenderResult {
  const base = realReportText();
  const sections = base.sections.map((s) =>
    s.sectionId === 'S10'
      ? { ...s, body: `${s.body}\nΤο ποσό είναι αχρεωστήτως καταβληθέν και προς επιστροφή.` }
      : s,
  );
  return { ...base, sections, fullText: sections.map((s) => s.body).join('\n') };
}

/** Pipeline bundle: rendered text PLUS the comparison summary, so the
 *  PDF table can be fed with EXISTING values (no recalculation). */
export function realReportBundle(): {
  reportText: ReportTextRenderResult;
  comparisonSummary: import('../../src/engines/scheduleComparisonEngine').ScheduleComparisonSummary;
} {
  const bankRows = [
    fixtureBankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 }),
    fixtureBankRow({ rowId: 'b2', dueDate: '2024-02-29', interest: 24_525 }),
  ];
  const recalcRows = [
    fixtureRecalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
    fixtureRecalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
  ];
  const comparisonResult = compareSchedules({ bankRows, recalcRows });
  const findingsResult = generateFindings({ comparisonResult });
  const built = buildLoanAuditReportModel({
    caseInfo: fixtureCaseInfo,
    comparisonResult,
    findingsResult,
    methodology: {
      scheduleType: 'τοκοχρεολυτικό σταθερής δόσης',
      rateDescription: 'σταθερό 6,00% με εισφορά Ν.128/75 περιλαμβανόμενη',
      dayCountConvention: 'ACT/360',
      law128Status: 'περιλαμβάνεται στο συμβατικό επιτόκιο',
      negativeIndexPolicy: 'δεν εφαρμόζεται (σταθερό επιτόκιο)',
      roundingPolicy: 'half-up στο πλησιέστερο λεπτό ανά περίοδο',
      dataCoverageNote: 'πλήρης κάλυψη περιόδων',
    },
    generatedAt: '2026-06-12T10:00:00.000Z',
  });
  assert.ok(built.reportModel && comparisonResult.summary);
  return {
    reportText: renderLoanAuditReportText(built.reportModel),
    comparisonSummary: comparisonResult.summary,
  };
}
