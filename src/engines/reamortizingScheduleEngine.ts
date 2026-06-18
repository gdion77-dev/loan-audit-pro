/**
 * Loan Audit PRO — src/engines/reamortizingScheduleEngine.ts
 * ------------------------------------------------------------------
 * Re-amortizing annuity schedule for FLOATING-rate loans.
 *
 * Banking practice (confirmed by Greek bank GTCs): for a floating loan,
 * the installment is RECOMPUTED at each rate-reset date using the
 * annuity formula on the CURRENT balance, the rate of that period, and
 * the REMAINING number of installments (the maturity stays fixed). The
 * reset frequency (monthly / quarterly / semi-annual / annual) is a
 * SEPARATE, declared parameter — it is NOT inferred from the index
 * tenor, because banks vary (e.g. Euribor 3M but monthly reset).
 *
 * DESIGN — this engine NEVER duplicates a locked financial formula:
 *   • period interest comes only from calculateAccruedInterest,
 *   • the day count comes only from calculateDayCount,
 *   • the applied rate comes only from resolveRateForDate,
 *   • each row is built only via buildSingleRecalcRow.
 * The only thing this file adds is WHEN to recompute the installment
 * (annuity) and the recomputation itself, which is a presentation of
 * the standard annuity identity, not an interest/day-count rule.
 *
 * Locked engines are unchanged. The fixed-installment engine
 * (equalInstallmentScheduleEngine) is also unchanged; this is a
 * separate engine selected only for the re-amortizing schedule mode.
 */

import {
  isValidISODate,
  type ISODate,
  type DayCountConvention,
} from '../domain/dateTypes';
import type { RateConfig } from '../domain/rateTypes';
import type { CurrencyCode } from '../domain/money';
import type { RecalcRow } from '../domain/scheduleTypes';
import { createAuditEntry, type AuditEntry } from '../domain/auditTypes';
import { info, requiresReview } from '../domain/auditFactories';
import { resolveRateForDate } from './rateEngine';
import { calculateDayCount } from './dayCountEngine';
import { calculateAccruedInterest, type RoundingMode } from './interestAccrualEngine';
import { buildSingleRecalcRow } from './recalcRowBuilder';

export const REAMORTIZING_SCHEDULE_AUDIT_CODES = {
  RA_PRINCIPAL_MISSING: 'RA_PRINCIPAL_MISSING',
  RA_PRINCIPAL_EXPLICIT_ZERO: 'RA_PRINCIPAL_EXPLICIT_ZERO',
  RA_TERM_MISSING: 'RA_TERM_MISSING',
  RA_TERM_INVALID: 'RA_TERM_INVALID',
  RA_DATES_INVALID: 'RA_DATES_INVALID',
  RA_RESET_FREQ_INVALID: 'RA_RESET_FREQ_INVALID',
  RA_RATE_NOT_RESOLVED: 'RA_RATE_NOT_RESOLVED',
  RA_INSTALLMENT_RECOMPUTED: 'RA_INSTALLMENT_RECOMPUTED',
  RA_NEGATIVE_AMORTIZATION_REQUIRES_REVIEW: 'RA_NEGATIVE_AMORTIZATION_REQUIRES_REVIEW',
  RA_FINAL_ROW_ADJUSTED: 'RA_FINAL_ROW_ADJUSTED',
  RA_SCHEDULE_ABORTED_AT_ROW: 'RA_SCHEDULE_ABORTED_AT_ROW',
  RA_EARLY_PAYOFF_REQUIRES_REVIEW: 'RA_EARLY_PAYOFF_REQUIRES_REVIEW',
} as const;

const RA = REAMORTIZING_SCHEDULE_AUDIT_CODES;

export type ReamortizingScheduleStatus = 'success' | 'requires_review' | 'missing_data';

export interface ReamortizingScheduleInput {
  readonly principalCents: number | null;
  readonly termPeriods: number | null;
  readonly firstPeriodStartDate: ISODate;
  readonly firstDueDate: ISODate;
  readonly paymentFrequency: 'monthly';
  readonly rateConfig: RateConfig;
  readonly dayCountConvention: DayCountConvention;
  /** Reset frequency in months (1, 3, 6, 12). Declared, not inferred. */
  readonly resetFrequencyMonths: number | null;
  readonly feesAndPremiumsPerPeriodCents?: number | null;
  readonly roundingMode?: RoundingMode;
  readonly currency?: CurrencyCode;
}

export interface ReamortizingScheduleResult {
  readonly status: ReamortizingScheduleStatus;
  readonly rows: readonly RecalcRow[];
  /** The installment used at the first period (informational). */
  readonly firstInstallmentCents: number | null;
  /** Number of times the installment was recomputed across the term. */
  readonly recomputeCount: number;
  readonly totalPrincipalCents: number | null;
  readonly totalInterestCents: number | null;
  readonly totalFeesCents: number | null;
  readonly totalInstallmentsCents: number | null;
  readonly finalClosingBalanceCents: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/** Previous due date + 1 calendar month, day clamped to month length. */
function addOneMonthClamped(date: ISODate): ISODate {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const targetY = m === 12 ? y + 1 : y;
  const targetM = m === 12 ? 1 : m + 1;
  const daysInTarget = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();
  const clampedD = Math.min(d, daysInTarget);
  return `${targetY}-${String(targetM).padStart(2, '0')}-${String(clampedD).padStart(2, '0')}` as ISODate;
}

function aggregateAuditEntries(
  perRow: ReadonlyArray<{ rowId: string; entries: readonly AuditEntry[] }>,
): AuditEntry[] {
  const byKey = new Map<string, { entry: AuditEntry; rowIds: string[] }>();
  const order: string[] = [];
  for (const { rowId, entries } of perRow) {
    for (const e of entries) {
      const key = `${e.severity}|${e.code}|${e.message}`;
      const existing = byKey.get(key);
      if (existing) existing.rowIds.push(rowId);
      else {
        byKey.set(key, { entry: e, rowIds: [rowId] });
        order.push(key);
      }
    }
  }
  return order.map((key) => {
    const { entry, rowIds } = byKey.get(key)!;
    return createAuditEntry({
      severity: entry.severity,
      code: entry.code,
      message: entry.message,
      context: { ...(entry.context ?? {}), rowIds, occurrences: rowIds.length },
    });
  });
}

/**
 * Standard annuity installment for a balance, monthly rate and number of
 * remaining periods. This is the textbook annuity identity, not a
 * day-count/interest rule (those stay in the locked engines).
 */
function annuityInstallmentCents(
  balanceCents: number,
  monthlyRate: number,
  remainingPeriods: number,
): number {
  if (remainingPeriods <= 0) return balanceCents;
  if (monthlyRate === 0) return Math.round(balanceCents / remainingPeriods);
  const raw = (balanceCents * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -remainingPeriods));
  return Math.round(raw);
}

export function buildReamortizingSchedule(
  input: ReamortizingScheduleInput,
): ReamortizingScheduleResult {
  const scheduleEntries: AuditEntry[] = [];
  const currency: CurrencyCode = input.currency ?? 'EUR';

  const emptyResult = (
    status: ReamortizingScheduleStatus,
    rows: readonly RecalcRow[] = [],
    entries: readonly AuditEntry[] = scheduleEntries,
    firstInstallment: number | null = null,
    recomputeCount = 0,
  ): ReamortizingScheduleResult => ({
    status,
    rows,
    firstInstallmentCents: firstInstallment,
    recomputeCount,
    totalPrincipalCents: null,
    totalInterestCents: null,
    totalFeesCents: null,
    totalInstallmentsCents: null,
    finalClosingBalanceCents: null,
    auditEntries: entries,
  });

  // --- validation: null is missing, never zero ----------------------
  if (input.principalCents === null) {
    scheduleEntries.push(requiresReview(RA.RA_PRINCIPAL_MISSING, 'Ελλιπή δεδομένα: μη διαθέσιμο κεφάλαιο. Το πρόγραμμα δεν παράγεται· το ελλείπον δεν αντικαθίσταται από μηδέν.'));
    return emptyResult('missing_data');
  }
  if (input.termPeriods === null) {
    scheduleEntries.push(requiresReview(RA.RA_TERM_MISSING, 'Ελλιπή δεδομένα: μη διαθέσιμη διάρκεια (πλήθος περιόδων). Το πρόγραμμα δεν παράγεται.'));
    return emptyResult('missing_data');
  }
  if (!Number.isSafeInteger(input.termPeriods) || input.termPeriods <= 0) {
    scheduleEntries.push(requiresReview(RA.RA_TERM_INVALID, `Ασυνέπεια δεδομένων: μη έγκυρη διάρκεια (${String(input.termPeriods)} περίοδοι).`));
    return emptyResult('requires_review');
  }
  if (!Number.isSafeInteger(input.principalCents) || input.principalCents < 0) {
    scheduleEntries.push(requiresReview(RA.RA_PRINCIPAL_MISSING, `Ασυνέπεια δεδομένων: μη έγκυρο κεφάλαιο (${String(input.principalCents)} λεπτά).`));
    return emptyResult('requires_review');
  }
  if (!isValidISODate(input.firstPeriodStartDate) || !isValidISODate(input.firstDueDate)) {
    scheduleEntries.push(requiresReview(RA.RA_DATES_INVALID, 'Ελλιπή δεδομένα: μη έγκυρη ημερομηνία έναρξης πρώτης περιόδου ή πρώτης δόσης.'));
    return emptyResult('missing_data');
  }
  const resetFreq = input.resetFrequencyMonths;
  if (resetFreq === null) {
    scheduleEntries.push(requiresReview(RA.RA_RESET_FREQ_INVALID, 'Ελλιπή δεδομένα: μη δηλωμένη συχνότητα αναπροσαρμογής δόσης (μήνες). Το πρόγραμμα δεν παράγεται.'));
    return emptyResult('missing_data');
  }
  if (!Number.isSafeInteger(resetFreq) || resetFreq <= 0) {
    scheduleEntries.push(requiresReview(RA.RA_RESET_FREQ_INVALID, `Ασυνέπεια δεδομένων: μη έγκυρη συχνότητα αναπροσαρμογής (${String(resetFreq)} μήνες).`));
    return emptyResult('requires_review');
  }

  if (input.principalCents === 0) {
    scheduleEntries.push(info(RA.RA_PRINCIPAL_EXPLICIT_ZERO, 'Πληροφορία: ρητά μηδενικό κεφάλαιο· παράγεται κενό πρόγραμμα με μηδενικά σύνολα.'));
    return {
      status: 'success',
      rows: [],
      firstInstallmentCents: 0,
      recomputeCount: 0,
      totalPrincipalCents: 0,
      totalInterestCents: 0,
      totalFeesCents: 0,
      totalInstallmentsCents: 0,
      finalClosingBalanceCents: 0,
      auditEntries: scheduleEntries,
    };
  }

  const term = input.termPeriods;
  const fees = input.feesAndPremiumsPerPeriodCents ?? null;
  const feesForPayment = fees === null ? 0 : fees;

  const rows: RecalcRow[] = [];
  const perRowEntries: { rowId: string; entries: readonly AuditEntry[] }[] = [];
  let openingBalance = input.principalCents;
  let periodStart = input.firstPeriodStartDate;
  let dueDate = input.firstDueDate;
  let totalInterest = 0;
  let totalFees = 0;
  let totalInstallments = 0;
  let anyRequiresReview = false;

  let currentInstallment: number | null = null;
  let firstInstallment: number | null = null;
  let recomputeCount = 0;

  for (let i = 0; i < term; i++) {
    const rowId = `RA-${String(i + 1).padStart(3, '0')}`;
    const isFinal = i === term - 1;
    const remaining = term - i; // installments left INCLUDING this one

    // Resolve this period's applied rate (locked engine).
    const rate = resolveRateForDate(input.rateConfig, dueDate);

    // Recompute the installment at the first period and at every reset
    // boundary (i is a multiple of the reset frequency). Between resets
    // the installment stays constant.
    const isResetBoundary = i === 0 || i % resetFreq === 0;
    if (isResetBoundary) {
      if (rate.status !== 'success' || rate.appliedAnnualRatePercent === null) {
        perRowEntries.push({ rowId, entries: rate.auditEntries });
        scheduleEntries.push(
          requiresReview(
            RA.RA_RATE_NOT_RESOLVED,
            `Απαιτείται έλεγχος: στην περίοδο αναπροσαρμογής ${i + 1} (${dueDate}) δεν επιλύεται εφαρμοζόμενο επιτόκιο· η δόση δεν επανυπολογίζεται και το πρόγραμμα διακόπτεται.`,
            { rowId, period: i + 1, dueDate, rateStatus: rate.status },
          ),
        );
        return emptyResult(
          rate.status === 'missing_data' ? 'missing_data' : 'requires_review',
          rows,
          [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
          firstInstallment,
          recomputeCount,
        );
      }
      const monthlyRate = (rate.appliedAnnualRatePercent as number) / 100 / 12;
      currentInstallment = annuityInstallmentCents(openingBalance, monthlyRate, remaining);
      if (i === 0) {
        firstInstallment = currentInstallment;
      } else {
        recomputeCount += 1;
        scheduleEntries.push(
          info(
            RA.RA_INSTALLMENT_RECOMPUTED,
            `Πληροφορία: στην περίοδο ${i + 1} (${dueDate}) η δόση επαναϋπολογίστηκε λόγω αναπροσαρμογής επιτοκίου σε ${currentInstallment} λεπτά, επί του τρέχοντος υπολοίπου (${openingBalance} λεπτά) και ${remaining} εναπομεινασών δόσεων, με ετήσιο επιτόκιο ${rate.appliedAnnualRatePercent}%.`,
            { rowId, period: i + 1, dueDate, installmentCents: currentInstallment, balanceCents: openingBalance, remainingPeriods: remaining },
          ),
        );
      }
    }

    // First-pass interest (for guards and the final-row adjustment).
    const dayCount = calculateDayCount(periodStart, dueDate, input.dayCountConvention);
    const accrual = calculateAccruedInterest({
      openingBalanceCents: openingBalance,
      rateResolution: rate,
      dayCount,
      ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
      currency,
    });

    if (accrual.interestCents === null) {
      perRowEntries.push({ rowId, entries: accrual.auditEntries });
      scheduleEntries.push(
        requiresReview(RA.RA_SCHEDULE_ABORTED_AT_ROW, `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): μη υπολογίσιμος τόκος περιόδου. Οι προηγούμενες γραμμές διατηρούνται· τα σύνολα δεν οριστικοποιούνται.`, { rowId, period: i + 1, dueDate }),
      );
      return emptyResult(
        accrual.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        firstInstallment,
        recomputeCount,
      );
    }

    const installmentForRow = currentInstallment as number;

    // Negative-amortization guard for non-final rows.
    if (!isFinal && installmentForRow < accrual.interestCents + feesForPayment) {
      perRowEntries.push({ rowId, entries: accrual.auditEntries });
      scheduleEntries.push(
        requiresReview(
          RA.RA_NEGATIVE_AMORTIZATION_REQUIRES_REVIEW,
          `Απαιτείται έλεγχος: στην περίοδο ${i + 1} (${dueDate}) η δόση (${installmentForRow} λεπτά) υπολείπεται των τόκων και εξόδων περιόδου (${accrual.interestCents + feesForPayment} λεπτά). Ο μη καταβληθείς τόκος ΔΕΝ κεφαλαιοποιείται σιωπηρά· το πρόγραμμα διακόπτεται.`,
          { rowId, period: i + 1, dueDate, installmentCents: installmentForRow, interestPlusFeesCents: accrual.interestCents + feesForPayment },
        ),
      );
      return emptyResult(
        'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        firstInstallment,
        recomputeCount,
      );
    }

    // Final-row adjustment: close exactly to zero.
    let paymentForRow = installmentForRow;
    if (isFinal) {
      paymentForRow = openingBalance + accrual.interestCents + feesForPayment;
      if (paymentForRow !== installmentForRow) {
        scheduleEntries.push(
          info(
            RA.RA_FINAL_ROW_ADJUSTED,
            `Πληροφορία: η τελική δόση προσαρμόστηκε σε ${paymentForRow} λεπτά (από ${installmentForRow}) ώστε το υπόλοιπο να κλείσει ακριβώς στο μηδέν.`,
            { rowId, installmentCents: installmentForRow, finalPaymentCents: paymentForRow },
          ),
        );
      }
    }

    const built = buildSingleRecalcRow({
      rowId,
      periodStartDate: periodStart,
      dueDate,
      openingBalanceCents: openingBalance,
      paymentAmountCents: paymentForRow,
      feesAndPremiumsCents: fees,
      rateConfig: input.rateConfig,
      dayCountConvention: input.dayCountConvention,
      ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
      currency,
    });

    perRowEntries.push({ rowId, entries: built.auditEntries });

    if (built.row === null) {
      scheduleEntries.push(
        requiresReview(RA.RA_SCHEDULE_ABORTED_AT_ROW, `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): η γραμμή δεν μπόρεσε να παραχθεί με ασφάλεια. Οι προηγούμενες γραμμές διατηρούνται· τα σύνολα δεν οριστικοποιούνται.`, { rowId, period: i + 1, dueDate }),
      );
      return emptyResult(
        built.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        firstInstallment,
        recomputeCount,
      );
    }

    if (built.status === 'requires_review') anyRequiresReview = true;

    rows.push(built.row);
    totalInterest += built.row.interest.cents;
    totalFees += built.allocation?.feesAndPremiumsDueCents ?? 0;
    totalInstallments += built.row.installment.cents;

    if (built.row.closingBalance.cents === 0 && !isFinal) {
      scheduleEntries.push(
        requiresReview(
          RA.RA_EARLY_PAYOFF_REQUIRES_REVIEW,
          `Απαιτείται έλεγχος: το υπόλοιπο μηδενίστηκε στην περίοδο ${i + 1} από ${term}, πριν από τη λήξη. Το πρόγραμμα διακόπτεται και τα σύνολα δεν οριστικοποιούνται.`,
          { rowId, period: i + 1, termPeriods: term },
        ),
      );
      return emptyResult(
        'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        firstInstallment,
        recomputeCount,
      );
    }

    openingBalance = built.row.closingBalance.cents;
    periodStart = dueDate;
    dueDate = addOneMonthClamped(dueDate);
  }

  return {
    status: anyRequiresReview ? 'requires_review' : 'success',
    rows,
    firstInstallmentCents: firstInstallment,
    recomputeCount,
    totalPrincipalCents: input.principalCents - openingBalance,
    totalInterestCents: totalInterest,
    totalFeesCents: totalFees,
    totalInstallmentsCents: totalInstallments,
    finalClosingBalanceCents: openingBalance,
    auditEntries: [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
  };
}
