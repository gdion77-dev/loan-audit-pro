/**
 * Loan Audit PRO — src/engines/loanAuditPipelineRunner.ts
 * ------------------------------------------------------------------
 * Step 10-A: Orchestrator / Pipeline Runner ONLY.
 *
 * Connects the already-built, LOCKED modules into one clean call:
 *
 *   schedule (equal principal | equal installment)
 *      → comparison (vs bank rows)
 *      → findings
 *      → payment reconciliation (optional)
 *      → ReportModel
 *      → report text (optional)
 *      → PDF (optional)
 *
 * This file is pure plumbing: it ONLY calls existing engines in the
 * right order, threads their outputs and aggregates status + audit
 * entries. It implements NO formula of its own — no interest, no
 * rate, no day count, no amortization, no comparison maths. Every
 * number originates in a locked engine.
 *
 * Scope guards: independent of Ν.3869/2010 and ΑΠ 6/2026; no UI, no
 * Excel/OCR/backend/persistence; neutral wording only.
 */

import type { ISODateTime } from '../domain/dateTypes';
import type { CurrencyCode } from '../domain/money';
import type { CaseInfo } from '../domain/loanTypes';
import type { BankScheduleRow, RecalcRow } from '../domain/scheduleTypes';
import type { ActualPayment } from '../domain/paymentTypes';
import { createAuditEntry, type AuditEntry } from '../domain/auditTypes';
import { info } from '../domain/auditFactories';

import {
  buildEqualPrincipalSchedule,
  type EqualPrincipalScheduleInput,
  type EqualPrincipalScheduleResult,
} from './equalPrincipalScheduleEngine';
import {
  buildEqualInstallmentSchedule,
  type EqualInstallmentScheduleInput,
  type EqualInstallmentScheduleResult,
} from './equalInstallmentScheduleEngine';
import {
  buildReamortizingSchedule,
  type ReamortizingScheduleInput,
  type ReamortizingScheduleResult,
} from './reamortizingScheduleEngine';
import {
  buildBalloonSchedule,
  type BalloonScheduleInput,
  type BalloonScheduleResult,
} from './balloonScheduleEngine';
import {
  compareSchedules,
  type ScheduleComparisonResult,
  type MatchingMode,
} from './scheduleComparisonEngine';
import {
  generateFindings,
  type FindingsResult,
} from './findingsEngine';
import {
  reconcileActualPayments,
  type PaymentReconciliationResult,
  type ReconciliationMatchingMode,
  type ReconciliationTarget,
} from './paymentReconciliationEngine';
import {
  buildLoanAuditReportModel,
  type ReportModelBuilderResult,
  type ReportMethodologyInput,
  type ReportPreparerInput,
} from './reportModelBuilder';
import {
  renderLoanAuditReportText,
  type ReportTextRenderResult,
} from '../renderers/reportTextRenderer';
import {
  renderLoanAuditPdf,
  type PdfRenderResult,
  type PdfRenderOptions,
  type PdfSummaryTableRow,
} from '../renderers/pdfReportRenderer';

/* ------------------------------------------------------------------ */
/* Audit codes specific to the orchestrator                            */
/* ------------------------------------------------------------------ */

export const PIPELINE_AUDIT_CODES = {
  PIPELINE_COMPARISON_SKIPPED: 'PIPELINE_COMPARISON_SKIPPED',
  PIPELINE_FINDINGS_SKIPPED: 'PIPELINE_FINDINGS_SKIPPED',
  PIPELINE_RECONCILIATION_SKIPPED: 'PIPELINE_RECONCILIATION_SKIPPED',
  PIPELINE_REPORT_SKIPPED: 'PIPELINE_REPORT_SKIPPED',
  PIPELINE_TEXT_RENDERED_AS_DEPENDENCY: 'PIPELINE_TEXT_RENDERED_AS_DEPENDENCY',
  PIPELINE_TEXT_SKIPPED: 'PIPELINE_TEXT_SKIPPED',
  PIPELINE_PDF_SKIPPED: 'PIPELINE_PDF_SKIPPED',
} as const;

const PL = PIPELINE_AUDIT_CODES;

export type PipelineStage =
  | 'schedule'
  | 'comparison'
  | 'findings'
  | 'reconciliation'
  | 'reportModel'
  | 'reportText'
  | 'pdf';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PipelineStatus = 'success' | 'requires_review' | 'missing_data';

export type ScheduleMode = 'equal_principal' | 'equal_installment' | 'reamortizing' | 'balloon';

export interface ComparisonOptions {
  readonly matchingMode?: MatchingMode;
  readonly dateToleranceDays?: number;
  readonly materialityThresholdCents?: number;
}

export interface ReconciliationOptions {
  readonly matchingMode?: ReconciliationMatchingMode;
  readonly dateToleranceDays?: number;
  readonly target?: ReconciliationTarget;
  readonly materialityThresholdCents?: number;
}

export interface FindingsOptions {
  readonly materialityThresholdCents?: number;
  readonly includeZeroDifferenceFinding?: boolean;
}

export interface LoanAuditPipelineInput {
  readonly caseInfo: CaseInfo;
  readonly scheduleMode: ScheduleMode;
  readonly scheduleInput: EqualPrincipalScheduleInput | EqualInstallmentScheduleInput | ReamortizingScheduleInput | BalloonScheduleInput;
  readonly bankRows: readonly BankScheduleRow[];
  readonly actualPayments?: readonly ActualPayment[];
  readonly comparisonOptions?: ComparisonOptions;
  readonly reconciliationOptions?: ReconciliationOptions;
  readonly findingsOptions?: FindingsOptions;
  readonly reportMethodology: ReportMethodologyInput;
  readonly generatedAt?: ISODateTime;
  readonly preparedBy?: ReportPreparerInput;
  readonly additionalNotes?: readonly string[];
  readonly currency?: CurrencyCode;
  readonly renderText?: boolean;
  readonly renderPdf?: boolean;
  readonly pdfOptions?: PdfRenderOptions;
  /** Optional pre-formatted comparative table rows for the PDF. */
  readonly pdfSummaryTable?: readonly PdfSummaryTableRow[];
}

export type RecalcScheduleResult =
  | EqualPrincipalScheduleResult
  | EqualInstallmentScheduleResult
  | ReamortizingScheduleResult
  | BalloonScheduleResult;

export interface LoanAuditPipelineResult {
  readonly status: PipelineStatus;
  readonly recalcScheduleResult: RecalcScheduleResult | null;
  readonly comparisonResult: ScheduleComparisonResult | null;
  readonly findingsResult: FindingsResult | null;
  readonly paymentReconciliationResult: PaymentReconciliationResult | null;
  readonly reportModelResult: ReportModelBuilderResult | null;
  readonly reportTextResult: ReportTextRenderResult | null;
  readonly pdfResult: PdfRenderResult | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function runLoanAuditPipeline(
  input: LoanAuditPipelineInput,
): LoanAuditPipelineResult {
  const currency: CurrencyCode = input.currency ?? 'EUR';
  const auditEntries: AuditEntry[] = [];

  /** Tag every stage entry with its stage name for traceability. */
  const collect = (stage: PipelineStage, entries: readonly AuditEntry[]): void => {
    for (const e of entries) {
      auditEntries.push(
        createAuditEntry({
          severity: e.severity,
          code: e.code,
          message: e.message,
          context: { ...(e.context ?? {}), stage },
        }),
      );
    }
  };
  const note = (stage: PipelineStage, code: string, message: string): void => {
    auditEntries.push(info(code, message, { stage }));
  };

  /* --- stage 1: schedule ------------------------------------------------- */
  const recalcScheduleResult: RecalcScheduleResult =
    input.scheduleMode === 'equal_principal'
      ? buildEqualPrincipalSchedule(input.scheduleInput as EqualPrincipalScheduleInput)
      : input.scheduleMode === 'reamortizing'
        ? buildReamortizingSchedule(input.scheduleInput as ReamortizingScheduleInput)
        : input.scheduleMode === 'balloon'
          ? buildBalloonSchedule(input.scheduleInput as BalloonScheduleInput)
          : buildEqualInstallmentSchedule(input.scheduleInput as EqualInstallmentScheduleInput);
  collect('schedule', recalcScheduleResult.auditEntries);

  const recalcRows: readonly RecalcRow[] = recalcScheduleResult.rows;

  /* --- stage 2: comparison ---------------------------------------------- */
  let comparisonResult: ScheduleComparisonResult | null = null;
  if (recalcRows.length > 0 && input.bankRows.length > 0) {
    comparisonResult = compareSchedules({
      bankRows: input.bankRows,
      recalcRows,
      ...(input.comparisonOptions?.matchingMode !== undefined
        ? { matchingMode: input.comparisonOptions.matchingMode }
        : {}),
      ...(input.comparisonOptions?.dateToleranceDays !== undefined
        ? { dateToleranceDays: input.comparisonOptions.dateToleranceDays }
        : {}),
      ...(input.comparisonOptions?.materialityThresholdCents !== undefined
        ? { materialityThresholdCents: input.comparisonOptions.materialityThresholdCents }
        : {}),
      currency,
    });
    collect('comparison', comparisonResult.auditEntries);
  } else {
    note(
      'comparison',
      PL.PIPELINE_COMPARISON_SKIPPED,
      'Η σύγκριση παραλείφθηκε: δεν υπάρχουν διαθέσιμες γραμμές επανυπολογισμού ή/και τράπεζας / fund.',
    );
  }

  /* --- stage 3: findings ------------------------------------------------- */
  let findingsResult: FindingsResult | null = null;
  if (comparisonResult !== null) {
    findingsResult = generateFindings({
      comparisonResult,
      ...(input.findingsOptions?.materialityThresholdCents !== undefined
        ? { materialityThresholdCents: input.findingsOptions.materialityThresholdCents }
        : {}),
      ...(input.findingsOptions?.includeZeroDifferenceFinding !== undefined
        ? { includeZeroDifferenceFinding: input.findingsOptions.includeZeroDifferenceFinding }
        : {}),
      currency,
    });
    collect('findings', findingsResult.auditEntries);
  } else {
    note(
      'findings',
      PL.PIPELINE_FINDINGS_SKIPPED,
      'Τα ευρήματα παραλείφθηκαν: δεν υπάρχει διαθέσιμο αποτέλεσμα σύγκρισης.',
    );
  }

  /* --- stage 4: payment reconciliation (optional) ------------------------ */
  let paymentReconciliationResult: PaymentReconciliationResult | null = null;
  if (input.actualPayments !== undefined && input.actualPayments.length > 0) {
    paymentReconciliationResult = reconcileActualPayments({
      actualPayments: input.actualPayments,
      bankRows: input.bankRows,
      recalcRows,
      ...(input.reconciliationOptions?.matchingMode !== undefined
        ? { matchingMode: input.reconciliationOptions.matchingMode }
        : {}),
      ...(input.reconciliationOptions?.dateToleranceDays !== undefined
        ? { dateToleranceDays: input.reconciliationOptions.dateToleranceDays }
        : {}),
      ...(input.reconciliationOptions?.target !== undefined
        ? { target: input.reconciliationOptions.target }
        : {}),
      ...(input.reconciliationOptions?.materialityThresholdCents !== undefined
        ? { materialityThresholdCents: input.reconciliationOptions.materialityThresholdCents }
        : {}),
      currency,
    });
    collect('reconciliation', paymentReconciliationResult.auditEntries);
  } else {
    note(
      'reconciliation',
      PL.PIPELINE_RECONCILIATION_SKIPPED,
      'Η συμφωνία πραγματικών καταβολών παραλείφθηκε: δεν δόθηκαν πραγματικές καταβολές· η συνολική διαφορά πραγματικής καταβολής δεν οριστικοποιείται.',
    );
  }

  /* --- stage 5: ReportModel --------------------------------------------- */
  let reportModelResult: ReportModelBuilderResult | null = null;
  if (comparisonResult !== null && findingsResult !== null) {
    reportModelResult = buildLoanAuditReportModel({
      caseInfo: input.caseInfo,
      comparisonResult,
      findingsResult,
      methodology: input.reportMethodology,
      ...(paymentReconciliationResult !== null
        ? { paymentReconciliationResult }
        : {}),
      ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
      ...(input.preparedBy !== undefined ? { preparedBy: input.preparedBy } : {}),
      ...(input.additionalNotes !== undefined ? { additionalNotes: input.additionalNotes } : {}),
      currency,
    });
    collect('reportModel', reportModelResult.auditEntries);
  } else {
    note(
      'reportModel',
      PL.PIPELINE_REPORT_SKIPPED,
      'Η μελέτη παραλείφθηκε: απαιτούνται αποτελέσματα σύγκρισης και ευρημάτων.',
    );
  }

  /* --- stage 6 + 7: text and PDF (optional, with dependency) ------------- */
  const wantText = input.renderText ?? false;
  const wantPdf = input.renderPdf ?? false;
  const reportModel = reportModelResult?.reportModel ?? null;

  let reportTextResult: ReportTextRenderResult | null = null;
  if ((wantText || wantPdf) && reportModel !== null) {
    if (wantPdf && !wantText) {
      note(
        'reportText',
        PL.PIPELINE_TEXT_RENDERED_AS_DEPENDENCY,
        'Η απόδοση κειμένου εκτελέστηκε ως εξάρτηση της παραγωγής PDF, αν και δεν ζητήθηκε ρητά.',
      );
    }
    reportTextResult = renderLoanAuditReportText(reportModel);
    collect('reportText', reportTextResult.auditEntries);
  } else if (wantText && reportModel === null) {
    note('reportText', PL.PIPELINE_TEXT_SKIPPED, 'Η απόδοση κειμένου παραλείφθηκε: δεν υπάρχει διαθέσιμο μοντέλο μελέτης.');
  }

  let pdfResult: PdfRenderResult | null = null;
  if (wantPdf) {
    if (reportTextResult !== null) {
      pdfResult = renderLoanAuditPdf({
        reportText: reportTextResult,
        ...(input.pdfSummaryTable !== undefined ? { summaryTable: input.pdfSummaryTable } : {}),
        ...(input.pdfOptions !== undefined ? { options: input.pdfOptions } : {}),
      });
      collect('pdf', pdfResult.auditEntries);
    } else {
      note('pdf', PL.PIPELINE_PDF_SKIPPED, 'Η παραγωγή PDF παραλείφθηκε: δεν υπάρχει διαθέσιμο κείμενο μελέτης.');
    }
  }

  /* --- status aggregation ------------------------------------------------ */
  const statuses: PipelineStatus[] = [recalcScheduleResult.status];
  if (comparisonResult !== null) statuses.push(comparisonResult.status);
  if (findingsResult !== null) statuses.push(findingsResult.status);
  if (paymentReconciliationResult !== null) statuses.push(paymentReconciliationResult.status);
  if (reportModelResult !== null) statuses.push(reportModelResult.status);
  if (reportTextResult !== null) statuses.push(reportTextResult.status);
  if (pdfResult !== null) statuses.push(pdfResult.status);

  // a required early stage that produced no usable downstream:
  const downstreamBlocked =
    comparisonResult === null || findingsResult === null || reportModelResult === null;

  const status: PipelineStatus = aggregateStatus(statuses, downstreamBlocked);

  return {
    status,
    recalcScheduleResult,
    comparisonResult,
    findingsResult,
    paymentReconciliationResult,
    reportModelResult,
    reportTextResult,
    pdfResult,
    auditEntries,
  };
}

/* ------------------------------------------------------------------ */
/* Status aggregation                                                  */
/* ------------------------------------------------------------------ */

/**
 * - If a required downstream stage could not be produced at all
 *   (comparison / findings / reportModel null), the pipeline is at
 *   least requires_review, and missing_data when that gap is the only
 *   problem and traces to missing input.
 * - Otherwise: any requires_review → requires_review; any
 *   missing_data among produced stages → requires_review (a produced
 *   stage reporting missing_data still needs review, since later
 *   stages ran); all success → success.
 */
function aggregateStatus(
  statuses: readonly PipelineStatus[],
  downstreamBlocked: boolean,
): PipelineStatus {
  if (downstreamBlocked) {
    return statuses.includes('requires_review') ? 'requires_review' : 'missing_data';
  }
  if (statuses.includes('requires_review') || statuses.includes('missing_data')) {
    return 'requires_review';
  }
  return 'success';
}
