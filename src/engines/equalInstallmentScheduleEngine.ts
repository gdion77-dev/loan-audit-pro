/**
 * Loan Audit PRO — src/engines/equalInstallmentScheduleEngine.ts
 * ------------------------------------------------------------------
 * Step 5-B: Equal Installment / Annuity Schedule Builder ONLY.
 *
 * Supports exclusively the EQUAL INSTALLMENT repayment type:
 *   - one fixed scheduled installment amount per period,
 *   - interest accrues each period on the OUTSTANDING OPENING
 *     BALANCE via the LOCKED engines (never on an installment),
 *   - principal portion = installment − interest − fees (through the
 *     locked allocation waterfall),
 *   - closing balance = opening − allocated principal,
 *   - the FINAL row adjusts the payment (up or down) to
 *     remaining principal + interest + fees, closing the balance to
 *     exactly zero with no residual cents and no overpayment.
 *
 * SCHEDULED INSTALLMENT (two MVP modes, documented):
 *   A. Provided (contract/bank/user): used as-is after integer/sign
 *      validation. The annuity formula is NOT used.
 *   B. Auto-calculated ONLY when ALL hold: fixed-rate regime, rate
 *      resolves as success, valid principal and term, and a known
 *      day-count convention. Formula (final rounding only):
 *        r = annualRatePercent / 100 / 12   (monthly periodic rate)
 *        payment = principal × r / (1 − (1 + r)^(−n))
 *      If r = 0: payment = round(principal / n), with the final-row
 *      adjustment absorbing any remainder deterministically.
 *      Floating rates and non-success rate statuses NEVER
 *      auto-calculate: ANNUITY_PAYMENT_NOT_CALCULABLE is returned.
 *
 * NEGATIVE AMORTIZATION GUARD: if a (non-final) period's installment
 * is below interest + fees, principal would be zero and interest
 * would go unpaid. Unpaid interest is NOT silently capitalized in
 * this step: the schedule STOPS with requires_review and
 * NEGATIVE_AMORTIZATION_REQUIRES_REVIEW; produced rows are kept,
 * totals remain null.
 *
 * MONTHLY DUE-DATE GENERATION: same documented method as Step 5-A —
 * next due = previous due + 1 calendar month with day-of-month
 * clamping; next start = previous due; day counting follows the
 * locked start-excluded / end-included convention.
 *
 * Scope guards: independent of Ν.3869/2010 and ΑΠ 6/2026; no other
 * repayment types; no comparison, no economicDifference; the Step
 * 5-A engine is NOT modified; no rate/day-count/interest formula is
 * duplicated — period interest comes only from the accrual engine.
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
import {
  calculateAccruedInterest,
  type RoundingMode,
} from './interestAccrualEngine';
import { buildSingleRecalcRow } from './recalcRowBuilder';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this engine                                 */
/* ------------------------------------------------------------------ */

export const EQUAL_INSTALLMENT_SCHEDULE_AUDIT_CODES = {
  AI_PRINCIPAL_MISSING: 'AI_PRINCIPAL_MISSING',
  AI_PRINCIPAL_EXPLICIT_ZERO: 'AI_PRINCIPAL_EXPLICIT_ZERO',
  AI_TERM_MISSING: 'AI_TERM_MISSING',
  AI_TERM_INVALID: 'AI_TERM_INVALID',
  AI_DATES_INVALID: 'AI_DATES_INVALID',
  AI_INSTALLMENT_INVALID: 'AI_INSTALLMENT_INVALID',
  ANNUITY_PAYMENT_NOT_CALCULABLE: 'ANNUITY_PAYMENT_NOT_CALCULABLE',
  NEGATIVE_AMORTIZATION_REQUIRES_REVIEW: 'NEGATIVE_AMORTIZATION_REQUIRES_REVIEW',
  AI_EARLY_PAYOFF_REQUIRES_REVIEW: 'AI_EARLY_PAYOFF_REQUIRES_REVIEW',
  AI_FINAL_ROW_ADJUSTED: 'AI_FINAL_ROW_ADJUSTED',
  AI_SCHEDULE_ABORTED_AT_ROW: 'AI_SCHEDULE_ABORTED_AT_ROW',
} as const;

const AI = EQUAL_INSTALLMENT_SCHEDULE_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type EqualInstallmentScheduleStatus =
  | 'success'
  | 'requires_review'
  | 'missing_data';

export interface EqualInstallmentScheduleInput {
  readonly principalCents: number | null;
  readonly termPeriods: number | null;
  readonly firstPeriodStartDate: ISODate;
  readonly firstDueDate: ISODate;
  readonly paymentFrequency: 'monthly';
  readonly rateConfig: RateConfig;
  readonly dayCountConvention: DayCountConvention;
  /** Provided fixed installment (mode A). null/absent = auto (mode B). */
  readonly scheduledInstallmentCents?: number | null;
  readonly feesAndPremiumsPerPeriodCents?: number | null;
  readonly roundingMode?: RoundingMode;
  readonly currency?: CurrencyCode;
}

export interface EqualInstallmentScheduleResult {
  readonly status: EqualInstallmentScheduleStatus;
  readonly rows: readonly RecalcRow[];
  /** The fixed installment used (provided or auto-calculated). */
  readonly scheduledInstallmentCents: number | null;
  readonly totalPrincipalCents: number | null;
  readonly totalInterestCents: number | null;
  readonly totalFeesCents: number | null;
  readonly totalInstallmentsCents: number | null;
  readonly finalClosingBalanceCents: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

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

/** Merge identical entries across rows into one with row context. */
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

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function buildEqualInstallmentSchedule(
  input: EqualInstallmentScheduleInput,
): EqualInstallmentScheduleResult {
  const scheduleEntries: AuditEntry[] = [];
  const currency: CurrencyCode = input.currency ?? 'EUR';

  const emptyResult = (
    status: EqualInstallmentScheduleStatus,
    rows: readonly RecalcRow[] = [],
    entries: readonly AuditEntry[] = scheduleEntries,
    installment: number | null = null,
  ): EqualInstallmentScheduleResult => ({
    status,
    rows,
    scheduledInstallmentCents: installment,
    totalPrincipalCents: null,
    totalInterestCents: null,
    totalFeesCents: null,
    totalInstallmentsCents: null,
    finalClosingBalanceCents: null,
    auditEntries: entries,
  });

  // --- input validation: null is missing, never zero -----------------
  if (input.principalCents === null) {
    scheduleEntries.push(
      requiresReview(AI.AI_PRINCIPAL_MISSING, 'Ελλιπή δεδομένα: μη διαθέσιμο κεφάλαιο. Το πρόγραμμα δεν παράγεται· το ελλείπον δεν αντικαθίσταται από μηδέν.'),
    );
    return emptyResult('missing_data');
  }
  if (input.termPeriods === null) {
    scheduleEntries.push(
      requiresReview(AI.AI_TERM_MISSING, 'Ελλιπή δεδομένα: μη διαθέσιμη διάρκεια (πλήθος περιόδων). Το πρόγραμμα δεν παράγεται.'),
    );
    return emptyResult('missing_data');
  }
  if (!Number.isSafeInteger(input.termPeriods) || input.termPeriods <= 0) {
    scheduleEntries.push(
      requiresReview(AI.AI_TERM_INVALID, `Ασυνέπεια δεδομένων: μη έγκυρη διάρκεια (${String(input.termPeriods)} περίοδοι).`),
    );
    return emptyResult('requires_review');
  }
  if (!Number.isSafeInteger(input.principalCents) || input.principalCents < 0) {
    scheduleEntries.push(
      requiresReview(AI.AI_PRINCIPAL_MISSING, `Ασυνέπεια δεδομένων: μη έγκυρο κεφάλαιο (${String(input.principalCents)} λεπτά).`),
    );
    return emptyResult('requires_review');
  }
  if (!isValidISODate(input.firstPeriodStartDate) || !isValidISODate(input.firstDueDate)) {
    scheduleEntries.push(
      requiresReview(AI.AI_DATES_INVALID, 'Ελλιπή δεδομένα: μη έγκυρη ημερομηνία έναρξης πρώτης περιόδου ή πρώτης δόσης.'),
    );
    return emptyResult('missing_data');
  }

  // --- explicit zero principal: documented design ---------------------
  if (input.principalCents === 0) {
    scheduleEntries.push(
      info(AI.AI_PRINCIPAL_EXPLICIT_ZERO, 'Πληροφορία: ρητά μηδενικό κεφάλαιο· παράγεται κενό πρόγραμμα με μηδενικά σύνολα.'),
    );
    return {
      status: 'success',
      rows: [],
      scheduledInstallmentCents: input.scheduledInstallmentCents ?? 0,
      totalPrincipalCents: 0,
      totalInterestCents: 0,
      totalFeesCents: 0,
      totalInstallmentsCents: 0,
      finalClosingBalanceCents: 0,
      auditEntries: scheduleEntries,
    };
  }

  const term = input.termPeriods;

  // --- scheduled installment: mode A (provided) or mode B (auto) -----
  let scheduledInstallment: number;

  if (input.scheduledInstallmentCents !== null && input.scheduledInstallmentCents !== undefined) {
    // Mode A: provided — used as-is, the formula is NOT applied.
    const provided = input.scheduledInstallmentCents;
    if (!Number.isSafeInteger(provided) || provided < 0) {
      scheduleEntries.push(
        requiresReview(AI.AI_INSTALLMENT_INVALID, `Ασυνέπεια δεδομένων: μη έγκυρη δηλωθείσα σταθερή δόση (${String(provided)} λεπτά).`),
      );
      return emptyResult('requires_review');
    }
    scheduledInstallment = provided;
  } else {
    // Mode B: auto-calculation, fixed-rate success only.
    const regime = input.rateConfig.regime;
    const firstRate = resolveRateForDate(input.rateConfig, input.firstDueDate);

    const calculable =
      regime.kind === 'fixed' &&
      firstRate.status === 'success' &&
      firstRate.appliedAnnualRatePercent !== null &&
      input.dayCountConvention !== 'unknown';

    if (!calculable) {
      scheduleEntries.push(
        requiresReview(
          AI.ANNUITY_PAYMENT_NOT_CALCULABLE,
          regime.kind === 'floating'
            ? 'Απαιτείται έλεγχος: δεν υπολογίζεται αυτόματα σταθερή δόση για κυμαινόμενο επιτόκιο σε αυτό το στάδιο. Δηλώστε τη συμβατική σταθερή δόση.'
            : 'Απαιτείται έλεγχος: δεν υπολογίζεται αυτόματα σταθερή δόση χωρίς οριστικοποιημένο σταθερό επιτόκιο και γνωστή σύμβαση ημερομέτρησης. Δηλώστε τη συμβατική σταθερή δόση ή συμπληρώστε τα στοιχεία επιτοκίου.',
          { rateStatus: firstRate.status, regime: regime.kind, dayCount: input.dayCountConvention },
        ),
      );
      const entries = [...firstRate.auditEntries, ...scheduleEntries];
      return emptyResult(
        firstRate.status === 'missing_data' ? 'missing_data' : 'requires_review',
        [],
        entries,
      );
    }

    const annualRatePercent = firstRate.appliedAnnualRatePercent as number;
    const r = annualRatePercent / 100 / 12; // monthly periodic rate
    if (r === 0) {
      // zero-rate: even split; the final-row adjustment absorbs remainder
      scheduledInstallment = Math.round(input.principalCents / term);
    } else {
      const raw = (input.principalCents * r) / (1 - Math.pow(1 + r, -term));
      scheduledInstallment = Math.round(raw); // final rounding only
    }
  }

  // --- period loop -----------------------------------------------------
  const fees = input.feesAndPremiumsPerPeriodCents ?? null;
  const feesForPayment = fees === null ? 0 : fees; // allocation records the assumption

  const rows: RecalcRow[] = [];
  const perRowEntries: { rowId: string; entries: readonly AuditEntry[] }[] = [];
  let openingBalance = input.principalCents;
  let periodStart = input.firstPeriodStartDate;
  let dueDate = input.firstDueDate;
  let totalInterest = 0;
  let totalFees = 0;
  let totalInstallments = 0;
  let anyRequiresReview = false;

  for (let i = 0; i < term; i++) {
    const rowId = `AI-${String(i + 1).padStart(3, '0')}`;
    const isFinal = i === term - 1;

    // First pass through the LOCKED pure engines for this period's
    // accrued interest (needed for the negative-amortization guard and
    // the final-row adjustment). The same pure functions re-run inside
    // the locked row builder with identical results — no formulas are
    // duplicated in this file.
    const rate = resolveRateForDate(input.rateConfig, dueDate);
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
        requiresReview(AI.AI_SCHEDULE_ABORTED_AT_ROW, `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): μη υπολογίσιμος τόκος περιόδου. Οι προηγούμενες γραμμές διατηρούνται· τα σύνολα δεν οριστικοποιούνται.`, { rowId, period: i + 1, dueDate }),
      );
      return emptyResult(
        accrual.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        scheduledInstallment,
      );
    }

    // --- negative-amortization guard (non-final rows) -----------------
    if (!isFinal && scheduledInstallment < accrual.interestCents + feesForPayment) {
      perRowEntries.push({ rowId, entries: accrual.auditEntries });
      scheduleEntries.push(
        requiresReview(
          AI.NEGATIVE_AMORTIZATION_REQUIRES_REVIEW,
          `Απαιτείται έλεγχος: στην περίοδο ${i + 1} (${dueDate}) η σταθερή δόση (${scheduledInstallment} λεπτά) υπολείπεται των τόκων και εξόδων περιόδου (${accrual.interestCents + feesForPayment} λεπτά). Ο μη καταβληθείς τόκος ΔΕΝ κεφαλαιοποιείται σιωπηρά· το πρόγραμμα διακόπτεται και τα σύνολα δεν οριστικοποιούνται.`,
          { rowId, period: i + 1, dueDate, scheduledInstallmentCents: scheduledInstallment, interestPlusFeesCents: accrual.interestCents + feesForPayment },
        ),
      );
      return emptyResult(
        'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        scheduledInstallment,
      );
    }

    // --- final-row adjustment (documented): close to exactly zero -----
    let paymentForRow = scheduledInstallment;
    if (isFinal) {
      paymentForRow = openingBalance + accrual.interestCents + feesForPayment;
      if (paymentForRow !== scheduledInstallment) {
        scheduleEntries.push(
          info(
            AI.AI_FINAL_ROW_ADJUSTED,
            `Πληροφορία: η τελική δόση προσαρμόστηκε σε ${paymentForRow} λεπτά (από ${scheduledInstallment}) ώστε το υπόλοιπο να κλείσει ακριβώς στο μηδέν, χωρίς υπολειπόμενα λεπτά και χωρίς υπερκαταβολή.`,
            { rowId, scheduledInstallmentCents: scheduledInstallment, finalPaymentCents: paymentForRow },
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
        requiresReview(AI.AI_SCHEDULE_ABORTED_AT_ROW, `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): η γραμμή δεν μπόρεσε να παραχθεί με ασφάλεια. Οι προηγούμενες γραμμές διατηρούνται· τα σύνολα δεν οριστικοποιούνται.`, { rowId, period: i + 1, dueDate }),
      );
      return emptyResult(
        built.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        scheduledInstallment,
      );
    }

    if (built.status === 'requires_review') anyRequiresReview = true;

    rows.push(built.row);
    totalInterest += built.row.interest.cents;
    totalFees += built.allocation?.feesAndPremiumsDueCents ?? 0;
    totalInstallments += built.row.installment.cents;

    // --- early payoff guard: balance must not reach 0 before the end --
    if (built.row.closingBalance.cents === 0 && !isFinal) {
      scheduleEntries.push(
        requiresReview(
          AI.AI_EARLY_PAYOFF_REQUIRES_REVIEW,
          `Απαιτείται έλεγχος: το υπόλοιπο μηδενίστηκε στην περίοδο ${i + 1} από ${term}, πριν από τη λήξη του προγράμματος. Η δηλωθείσα σταθερή δόση δεν συμβαδίζει με τη διάρκεια· το πρόγραμμα διακόπτεται και τα σύνολα δεν οριστικοποιούνται.`,
          { rowId, period: i + 1, termPeriods: term },
        ),
      );
      return emptyResult(
        'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        scheduledInstallment,
      );
    }

    openingBalance = built.row.closingBalance.cents;
    periodStart = dueDate;
    dueDate = addOneMonthClamped(dueDate);
  }

  const totalPrincipal = rows.reduce((sum, r) => sum + r.principal.cents, 0);
  const finalClosing = rows[rows.length - 1]!.closingBalance.cents;

  return {
    status: anyRequiresReview ? 'requires_review' : 'success',
    rows,
    scheduledInstallmentCents: scheduledInstallment,
    totalPrincipalCents: totalPrincipal,
    totalInterestCents: totalInterest,
    totalFeesCents: totalFees,
    totalInstallmentsCents: totalInstallments,
    finalClosingBalanceCents: finalClosing,
    auditEntries: [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
  };
}
