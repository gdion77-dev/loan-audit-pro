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
import {
  buildActualPaymentsAmortization,
  type ActualPaymentsAmortizationResult,
  type DueInstallment,
  type ActualPaymentInput,
} from '../engines/actualPaymentsAmortizationEngine';

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
  /**
   * Parallel actual-payments amortization (ΑΚ 423 allocation order,
   * late interest, optional semi-annual capitalization) — a
   * presentation-only, separately computed track. null when the
   * locked pipeline did not run, or there is no recalculated
   * schedule to drive it.
   */
  readonly actualPaymentsAmortization: ActualPaymentsAmortizationResult | null;
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
    ...(scheduleMode === 'reamortizing'
      ? { resetFrequencyMonths: recalculationSettings.resetFrequencyMonths ?? null }
      : {}),
    ...(scheduleMode === 'balloon'
      ? { balloonAmountCents: recalculationSettings.balloonAmountCents ?? null }
      : {}),
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
  const proj = adapted.floatingRateProjection;
  const INDEX_LABEL: Record<string, string> = {
    EURIBOR_1M: 'Euribor 1Μ',
    EURIBOR_3M: 'Euribor 3Μ',
    EURIBOR_6M: 'Euribor 6Μ',
    EURIBOR_12M: 'Euribor 12Μ',
    ECB: 'επιτόκιο ΕΚΤ',
    other: 'δείκτης',
  };
  let rateText: string;
  if (rateConfig.regime.kind === 'fixed') {
    rateText = `σταθερό ${rateConfig.regime.annualRatePercent}%`;
  } else {
    const idxLabel = INDEX_LABEL[rateConfig.regime.indexType] ?? 'δείκτης';
    const ruleText = rateConfig.regime.referenceDateRule ? `, ${rateConfig.regime.referenceDateRule}` : '';
    rateText = `κυμαινόμενο: ${idxLabel} + περιθώριο ${rateConfig.regime.spreadPercent}%${ruleText}`;
  }
  const negativeIndexText =
    rateConfig.regime.kind === 'floating'
      ? 'αρνητικός δείκτης λαμβάνεται ως μηδέν (floor 0)'
      : 'δεν έχει προσδιοριστεί';
  const projectionNote =
    proj && proj.projectedCount > 0
      ? ` Για ${proj.projectedCount} μελλοντικές δόσεις χρησιμοποιήθηκε η τελευταία δημοσιευμένη τιμή δείκτη (${proj.lastPublishedValuePercent}% της ${proj.lastPublishedDate}).`
      : '';
  const methodology: ReportMethodologyInput = {
    scheduleType:
      scheduleMode === 'equal_principal'
        ? 'ίση δόση κεφαλαίου'
        : scheduleMode === 'reamortizing'
          ? 'κυμαινόμενη τοκοχρεολυτική δόση (αναπροσαρμοζόμενη)'
          : scheduleMode === 'balloon'
            ? 'δόση με υπόλοιπο (balloon)'
            : 'σταθερή τοκοχρεολυτική δόση',
    rateDescription: rateText,
    dayCountConvention: rateConfig.dayCount,
    law128Status: law128Text,
    negativeIndexPolicy: negativeIndexText,
    roundingPolicy: roundingMode ?? 'δεν έχει προσδιοριστεί',
    dataCoverageNote: `${bankRows.length} γραμμές δοσολογίου, ${actualPayments.length} πραγματικές καταβολές βάσει διαθέσιμων δεδομένων.${projectionNote}`,
  };

  return {
    caseInfo,
    scheduleMode,
    scheduleInput,
    bankRows,
    ...(actualPayments.length > 0
      ? {
          actualPayments,
          // The UI lets the user pick the exact schedule row from a
          // dropdown (tab «Πραγματικές Καταβολές»), so reconciliation
          // must use that explicit choice rather than guessing a match
          // by due date. This changes no amount, only which matching
          // strategy the locked engine is told to apply.
          reconciliationOptions: { matchingMode: 'manual_match_id' as const },
        }
      : {}),
    reportMethodology: methodology,
    currency,
    renderText: true,
    renderPdf,
  };
}

/**
 * Builds inputs for the actual-payments amortization engine from the
 * already-computed pipeline result (theoretical schedule) and the
 * adapter's actual payments / loan terms. Returns null when there is
 * no recalculated schedule to drive it (nothing to compute against).
 *
 * IMPORTANT: actual payments are matched by the user against BANK
 * schedule row IDs (e.g. "b1"), via the dropdown in «Πραγματικές
 * Καταβολές». The amortization track, however, is driven by the
 * RECALCULATED schedule rows (e.g. "EP-003"), which have their own,
 * independent row IDs. The bridge between the two — exactly as the
 * locked paymentReconciliationEngine.ts already does — is the shared
 * dueDate: a payment matched to bank row "b1" is re-matched here to
 * whichever recalculated row shares "b1"'s due date.
 */
function buildAmortizationInputs(
  result: LoanAuditPipelineResult,
  adapted: DraftToDomainResult,
): {
  readonly due: readonly DueInstallment[];
  readonly payments: readonly ActualPaymentInput[];
  readonly openingPrincipalCents: number;
  readonly contractualAnnualRatePercent: number;
  readonly dayCountConvention: LoanAuditPipelineInput['scheduleInput']['dayCountConvention'];
} | null {
  const recalcRows = result.recalcScheduleResult?.rows ?? [];
  if (recalcRows.length === 0) return null;
  const firstRow = recalcRows[0]!;

  // Bridge: bank rowId -> dueDate, and dueDate -> recalc rowId.
  const bankRowIdToDueDate = new Map<string, string>();
  for (const b of adapted.bankRows) bankRowIdToDueDate.set(b.rowId, b.dueDate);
  const dueDateToRecalcRowId = new Map<string, string>();
  for (const r of recalcRows) {
    if (!dueDateToRecalcRowId.has(r.dueDate)) dueDateToRecalcRowId.set(r.dueDate, r.rowId);
  }

  const payments: ActualPaymentInput[] = adapted.actualPayments
    .filter((p) => p.matchedScheduleRowId !== null)
    .map((p) => {
      const targetId = p.matchedScheduleRowId as string;
      // Bridge via due date when the target is a bank rowId; if it's
      // already a recalc rowId (or unresolvable), pass it through
      // unchanged — the engine itself reports any non-matching ID.
      const bridgedDueDate = bankRowIdToDueDate.get(targetId);
      const resolvedId =
        bridgedDueDate !== undefined
          ? dueDateToRecalcRowId.get(bridgedDueDate) ?? targetId
          : targetId;
      return {
        paymentId: p.paymentId,
        paymentDate: p.date,
        amountCents: p.amount.cents,
        matchedRowId: resolvedId,
      };
    });

  // A recalc row has a "recorded exception" iff at least one actual
  // payment is matched to it. Rows without any recorded payment are
  // treated by the engine as cleanly paid on time (no arrears).
  const rowsWithRecordedPayment = new Set<string>(payments.map((p) => p.matchedRowId));

  // Sum extra charges by year-month, then attach each period's total to
  // the due installment that falls in the same month. Charges that don't
  // line up with any installment month are ignored here (they have no
  // period to attach to); the engine treats them via the matched row.
  const extraByMonth = new Map<string, number>();
  for (const c of adapted.extraCharges) {
    const ym = c.dateISO.slice(0, 7);
    extraByMonth.set(ym, (extraByMonth.get(ym) ?? 0) + c.amountCents);
  }

  const due: DueInstallment[] = recalcRows.map((r) => {
    const ym = r.dueDate.slice(0, 7);
    const extra = extraByMonth.get(ym) ?? 0;
    return {
      rowId: r.rowId,
      dueDate: r.dueDate,
      installmentCents: r.installment.cents,
      interestCents: r.interest.cents,
      principalCents: r.principal.cents,
      hasRecordedException: rowsWithRecordedPayment.has(r.rowId) || extra > 0,
      ...(extra > 0 ? { extraChargesCents: extra } : {}),
    };
  });

  const openingPrincipalCents = adapted.loanTerms?.principalCents ?? firstRow.openingBalance.cents;
  const dayCountConvention = adapted.rateConfig !== null ? adapted.rateConfig.dayCount : 'unknown';

  return {
    due,
    payments,
    openingPrincipalCents,
    contractualAnnualRatePercent: firstRow.appliedAnnualRatePercent,
    dayCountConvention,
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
      actualPaymentsAmortization: null,
    };
  }

  const input = buildPipelineInputFromAdapter(adapted, currency, renderPdf);
  if (input === null) {
    return {
      runStatus: 'missing_data',
      result: null,
      message: 'Δεν είναι δυνατή η ασφαλής κατάρτιση εισόδου μελέτης με τα διαθέσιμα δεδομένα.',
      actualPaymentsAmortization: null,
    };
  }

  const result = runLoanAuditPipeline(input);

  // Second, separate step: the actual-payments amortization track.
  // Pure presentation/analysis layer on top of the locked result —
  // never feeds back into it. Only runs when there are actual
  // payments to drive it; otherwise null (nothing to show).
  let actualPaymentsAmortization: ActualPaymentsAmortizationResult | null = null;
  if (adapted.actualPayments.length > 0) {
    const amortInputs = buildAmortizationInputs(result, adapted);
    if (amortInputs !== null) {
      const surchargeField = draft.rateConfigDraft.lateInterestSurchargePercent;
      const capitalizeField = draft.rateConfigDraft.capitalizeLateInterestSemiAnnually;
      actualPaymentsAmortization = buildActualPaymentsAmortization(amortInputs.due, amortInputs.payments, {
        openingPrincipalCents: amortInputs.openingPrincipalCents,
        contractualAnnualRatePercent: amortInputs.contractualAnnualRatePercent,
        dayCountConvention: amortInputs.dayCountConvention,
        lateInterestSurchargePercent:
          surchargeField.status === 'value' ? surchargeField.value : null,
        capitalizeLateInterestSemiAnnually:
          capitalizeField.status === 'value' && capitalizeField.value === 'yes',
        accrueDefaultInterestOnExtraCharges: adapted.accrueInterestOnExtraCharges,
        chargesPaidBeforePrincipal: adapted.chargesPaidBeforePrincipal,
        currency,
      });
    }
  }

  return {
    runStatus: result.status,
    result,
    message:
      result.status === 'success'
        ? 'Η μελέτη εκτελέστηκε με επιτυχία.'
        : 'Η μελέτη εκτελέστηκε· ορισμένα σημεία απαιτούν έλεγχο.',
    actualPaymentsAmortization,
  };
}
