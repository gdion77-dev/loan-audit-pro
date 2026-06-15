/**
 * Loan Audit PRO — src/ui-state/pipelineExecutor.ts
 * ------------------------------------------------------------------
 * Bridges the validated draft to the LOCKED pipeline runner in a
 * controlled way. Two pure helpers:
 *   - canExecutePipeline(summary): the draft must be 'ready'.
 *   - executePipelineFromDraft(draft): re-validates, builds a safe
 *     LoanAuditPipelineInput from the adapter result, and calls
 *     runLoanAuditPipeline with renderText + renderPdf. If the draft
 *     is not ready, or a safe input cannot be built, it does NOT call
 *     the pipeline and returns a blocked outcome.
 *
 * This module performs NO calculation itself — it only shapes input
 * and delegates to the locked runner. No download, no persistence,
 * no backend, no auth.
 */

import { adaptDraftToDomain, type DraftToDomainResult } from './draftToDomainAdapter';
import { buildDraftValidationSummary, type DraftValidationSummary } from './draftValidationSummary';
import type { LoanAuditDraftState } from './loanAuditDraftState';
import type { CurrencyCode } from '../domain/money';
import type { RoundingMode } from '../engines/interestAccrualEngine';
import {
  runLoanAuditPipeline,
  type LoanAuditPipelineInput,
  type LoanAuditPipelineResult,
  type ScheduleMode,
} from '../engines/loanAuditPipelineRunner';
import type { ReportMethodologyInput } from '../engines/reportModelBuilder';

export type PipelineRunStatus =
  | 'not_run'
  | 'running'
  | 'success'
  | 'requires_review'
  | 'missing_data'
  | 'failed';

export interface PipelineExecutionOutcome {
  readonly runStatus: PipelineRunStatus;
  readonly result: LoanAuditPipelineResult | null;
  /** Greek, user-facing reason when execution is blocked or notable. */
  readonly message: string;
}

/** Execution is allowed only for a fully-ready draft. */
export function canExecutePipeline(summary: DraftValidationSummary): boolean {
  return summary.status === 'ready';
}

const ROUNDING_CODES: readonly RoundingMode[] = ['half_up', 'floor', 'ceil'];

/** Maps a draft rounding code to a RoundingMode, else null (no invention). */
function toRoundingMode(code: string | null): RoundingMode | null {
  return code !== null && (ROUNDING_CODES as readonly string[]).includes(code)
    ? (code as RoundingMode)
    : null;
}

/**
 * Builds a safe pipeline input from an adapter result, or null when
 * the necessary pieces are absent. Never invents missing values.
 */
export function buildPipelineInputFromAdapter(
  adapted: DraftToDomainResult,
  currency: CurrencyCode = 'EUR',
  renderPdf = true,
): LoanAuditPipelineInput | null {
  const { caseInfo, loanTerms, rateConfig, recalculationSettings, bankRows, actualPayments } = adapted;
  if (
    caseInfo === null ||
    loanTerms === null ||
    rateConfig === null ||
    recalculationSettings === null
  ) {
    return null;
  }

  const scheduleMode: ScheduleMode = recalculationSettings.scheduleMode;
  const roundingMode = toRoundingMode(recalculationSettings.roundingMode);

  // first due date: earliest bank row dueDate if present, else the
  // loan start date. Never fabricated beyond these known inputs.
  const dueDates = bankRows
    .map((r) => r.dueDate)
    .filter((d): d is typeof d => d !== null)
    .sort((a, b) => (a < b ? -1 : 1));
  const firstDueDate = dueDates[0] ?? loanTerms.endDate;

  const scheduleInput = {
    principalCents: loanTerms.principalCents,
    termPeriods: loanTerms.termMonths,
    firstPeriodStartDate: loanTerms.startDate,
    firstDueDate,
    paymentFrequency: 'monthly' as const,
    rateConfig,
    dayCountConvention: rateConfig.dayCount,
    feesAndPremiumsPerPeriodCents: recalculationSettings.feesAndPremiumsPerPeriodCents,
    ...(roundingMode !== null ? { roundingMode } : {}),
    currency,
  };

  // methodology: described from KNOWN draft fields only.
  const law128Text =
    rateConfig.law128.kind === 'included_in_rate'
      ? 'περιλαμβάνεται στο επιτόκιο'
      : rateConfig.law128.kind === 'added_separately'
        ? 'προστίθεται χωριστά'
        : 'δεν έχει προσδιοριστεί';
  const rateText =
    rateConfig.regime.kind === 'fixed'
      ? `σταθερό ${rateConfig.regime.annualRatePercent}%`
      : `κυμαινόμενο με περιθώριο ${rateConfig.regime.spreadPercent}%`;
  const methodology: ReportMethodologyInput = {
    scheduleType: scheduleMode === 'equal_principal' ? 'ίση δόση κεφαλαίου' : 'σταθερή τοκοχρεολυτική δόση',
    rateDescription: rateText,
    dayCountConvention: rateConfig.dayCount,
    law128Status: law128Text,
    negativeIndexPolicy: 'δεν έχει προσδιοριστεί',
    roundingPolicy: roundingMode ?? 'δεν έχει προσδιοριστεί',
    dataCoverageNote: `${bankRows.length} γραμμές δοσολογίου, ${actualPayments.length} πραγματικές καταβολές βάσει διαθέσιμων δεδομένων.`,
  };

  return {
    caseInfo,
    scheduleMode,
    scheduleInput,
    bankRows,
    ...(actualPayments.length > 0 ? { actualPayments } : {}),
    reportMethodology: methodology,
    currency,
    renderText: true,
    renderPdf,
  };
}

/**
 * Controlled execution from a draft. Re-validates, gates on 'ready',
 * builds a safe input and runs the locked pipeline. Returns a blocked
 * outcome (no pipeline call) when not ready or when input can't be
 * built safely.
 */
export function executePipelineFromDraft(
  draft: LoanAuditDraftState,
  options?: { readonly currency?: CurrencyCode; readonly renderPdf?: boolean },
): PipelineExecutionOutcome {
  const currency: CurrencyCode = options?.currency ?? 'EUR';
  const renderPdf = options?.renderPdf ?? true;
  const adapted = adaptDraftToDomain(draft, { currency });
  const summary = buildDraftValidationSummary(adapted);

  if (!canExecutePipeline(summary)) {
    return {
      runStatus: summary.status === 'missing_data' ? 'missing_data' : 'requires_review',
      result: null,
      message: 'Η μελέτη δεν μπορεί να εκτελεστεί ακόμη. Συμπληρώστε ή ελέγξτε τα ελλείποντα δεδομένα.',
    };
  }

  const input = buildPipelineInputFromAdapter(adapted, currency, renderPdf);
  if (input === null) {
    return {
      runStatus: 'missing_data',
      result: null,
      message: 'Δεν είναι δυνατή η ασφαλής κατάρτιση εισόδου μελέτης με τα διαθέσιμα δεδομένα.',
    };
  }

  const result = runLoanAuditPipeline(input);
  return {
    runStatus: result.status,
    result,
    message:
      result.status === 'success'
        ? 'Η μελέτη εκτελέστηκε με επιτυχία.'
        : 'Η μελέτη εκτελέστηκε· ορισμένα σημεία απαιτούν έλεγχο.',
  };
}
