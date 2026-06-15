/**
 * Loan Audit PRO — src/engines/equalPrincipalScheduleEngine.ts
 * ------------------------------------------------------------------
 * Step 5-A: Equal Principal Schedule Builder ONLY.
 *
 * The FIRST multi-period engine. Supports exclusively the EQUAL
 * PRINCIPAL repayment type:
 *   - each period has a fixed planned principal component,
 *   - interest accrues on the OUTSTANDING OPENING BALANCE of the
 *     period (via the locked engines — never on an installment),
 *   - scheduled installment = planned principal + accrued interest
 *     + fees/premiums,
 *   - closing balance = opening balance − allocated principal,
 *     and becomes the next period's opening balance.
 *
 * PRINCIPAL CENTS DISTRIBUTION (documented deterministic method):
 *   basePrincipalCents = floor(principalCents / termPeriods)
 *   remainderCents     = principalCents − basePrincipalCents × term
 *   The first `remainderCents` periods receive basePrincipalCents + 1;
 *   the rest receive basePrincipalCents. The sum is EXACTLY the
 *   original principal — no cent is ever lost or invented, and the
 *   final balance closes to exactly zero by construction.
 *
 * MONTHLY DUE-DATE GENERATION (documented MVP method):
 *   period 1: periodStart = firstPeriodStartDate, due = firstDueDate.
 *   period n: periodStart = previous due date,
 *             due = previous due date + 1 calendar month, with the
 *             day-of-month CLAMPED to the target month's length
 *             (e.g. 31 Jan → 29 Feb 2024 → 29 Mar, the clamped day
 *             persists). Deterministic; only 'monthly' is supported.
 *   Day counting itself follows the locked Step 3-A convention:
 *   period start EXCLUDED, due date INCLUDED.
 *
 * Per period the LOCKED single-row builder is used, which itself
 * composes rate → day count → accrual → allocation. The only extra
 * step here is computing the scheduled payment amount as
 * plannedPrincipal + accruedInterest + fees, where the accrued
 * interest is obtained FROM the locked accrual path (a first pass of
 * the same pure engines) — no rate, day-count or interest formula is
 * duplicated in this file.
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026; no such logic.
 *   - NO other repayment types (no fixed-installment formula, no
 *     deferred-interest periods, no large final payment, no custom
 *     bank schedule).
 *   - NO comparison with bank data, NO economicDifference.
 *   - Closing balances can never go below zero (allocation engine
 *     invariant).
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

export const EQUAL_PRINCIPAL_SCHEDULE_AUDIT_CODES = {
  SCHEDULE_PRINCIPAL_MISSING: 'SCHEDULE_PRINCIPAL_MISSING',
  SCHEDULE_PRINCIPAL_EXPLICIT_ZERO: 'SCHEDULE_PRINCIPAL_EXPLICIT_ZERO',
  SCHEDULE_TERM_MISSING: 'SCHEDULE_TERM_MISSING',
  SCHEDULE_TERM_INVALID: 'SCHEDULE_TERM_INVALID',
  SCHEDULE_DATES_INVALID: 'SCHEDULE_DATES_INVALID',
  SCHEDULE_ABORTED_AT_ROW: 'SCHEDULE_ABORTED_AT_ROW',
} as const;

const ES = EQUAL_PRINCIPAL_SCHEDULE_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type EqualPrincipalScheduleStatus =
  | 'success'
  | 'requires_review'
  | 'missing_data';

export interface EqualPrincipalScheduleInput {
  readonly principalCents: number | null;
  readonly termPeriods: number | null;
  readonly firstPeriodStartDate: ISODate;
  readonly firstDueDate: ISODate;
  readonly paymentFrequency: 'monthly';
  readonly rateConfig: RateConfig;
  readonly dayCountConvention: DayCountConvention;
  readonly feesAndPremiumsPerPeriodCents?: number | null;
  readonly roundingMode?: RoundingMode;
  readonly currency?: CurrencyCode;
}

export interface EqualPrincipalScheduleResult {
  readonly status: EqualPrincipalScheduleStatus;
  /** Rows built so far; complete on success, possibly partial on abort. */
  readonly rows: readonly RecalcRow[];
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
  const mm = String(targetM).padStart(2, '0');
  const dd = String(clampedD).padStart(2, '0');
  return `${targetY}-${mm}-${dd}` as ISODate;
}

/**
 * Deduplicate identical audit entries across rows: entries with the
 * same severity + code + message are merged into one entry whose
 * context lists the affected rowIds and the occurrence count. Unique
 * entries keep their original context, enriched with their rowId.
 */
function aggregateAuditEntries(
  perRow: ReadonlyArray<{ rowId: string; entries: readonly AuditEntry[] }>,
): AuditEntry[] {
  const byKey = new Map<string, { entry: AuditEntry; rowIds: string[] }>();
  const order: string[] = [];
  for (const { rowId, entries } of perRow) {
    for (const e of entries) {
      const key = `${e.severity}|${e.code}|${e.message}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.rowIds.push(rowId);
      } else {
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
      context: {
        ...(entry.context ?? {}),
        rowIds,
        occurrences: rowIds.length,
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function buildEqualPrincipalSchedule(
  input: EqualPrincipalScheduleInput,
): EqualPrincipalScheduleResult {
  const scheduleEntries: AuditEntry[] = [];
  const currency: CurrencyCode = input.currency ?? 'EUR';

  const emptyResult = (
    status: EqualPrincipalScheduleStatus,
    rows: readonly RecalcRow[] = [],
    entries: readonly AuditEntry[] = scheduleEntries,
  ): EqualPrincipalScheduleResult => ({
    status,
    rows,
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
      requiresReview(
        ES.SCHEDULE_PRINCIPAL_MISSING,
        'Ελλιπή δεδομένα: μη διαθέσιμο κεφάλαιο. Το πρόγραμμα δεν παράγεται· το ελλείπον δεν αντικαθίσταται από μηδέν.',
      ),
    );
    return emptyResult('missing_data');
  }
  if (input.termPeriods === null) {
    scheduleEntries.push(
      requiresReview(
        ES.SCHEDULE_TERM_MISSING,
        'Ελλιπή δεδομένα: μη διαθέσιμη διάρκεια (πλήθος περιόδων). Το πρόγραμμα δεν παράγεται.',
      ),
    );
    return emptyResult('missing_data');
  }
  if (!Number.isSafeInteger(input.termPeriods) || input.termPeriods <= 0) {
    scheduleEntries.push(
      requiresReview(
        ES.SCHEDULE_TERM_INVALID,
        `Ασυνέπεια δεδομένων: μη έγκυρη διάρκεια (${String(input.termPeriods)} περίοδοι). Απαιτείται θετικός ακέραιος.`,
      ),
    );
    return emptyResult('requires_review');
  }
  if (!Number.isSafeInteger(input.principalCents) || input.principalCents < 0) {
    scheduleEntries.push(
      requiresReview(
        ES.SCHEDULE_PRINCIPAL_MISSING,
        `Ασυνέπεια δεδομένων: μη έγκυρο κεφάλαιο (${String(input.principalCents)} λεπτά).`,
      ),
    );
    return emptyResult('requires_review');
  }
  if (!isValidISODate(input.firstPeriodStartDate) || !isValidISODate(input.firstDueDate)) {
    scheduleEntries.push(
      requiresReview(
        ES.SCHEDULE_DATES_INVALID,
        'Ελλιπή δεδομένα: μη έγκυρη ημερομηνία έναρξης πρώτης περιόδου ή πρώτης δόσης.',
      ),
    );
    return emptyResult('missing_data');
  }

  // --- explicit zero principal: documented design ---------------------
  // An explicitly zero principal is valid data; the schedule is empty
  // (no periods to repay), totals are explicit zeros and the final
  // balance is zero. Recorded with an info entry.
  if (input.principalCents === 0) {
    scheduleEntries.push(
      info(
        ES.SCHEDULE_PRINCIPAL_EXPLICIT_ZERO,
        'Πληροφορία: ρητά μηδενικό κεφάλαιο· παράγεται κενό πρόγραμμα με μηδενικά σύνολα.',
      ),
    );
    return {
      status: 'success',
      rows: [],
      totalPrincipalCents: 0,
      totalInterestCents: 0,
      totalFeesCents: 0,
      totalInstallmentsCents: 0,
      finalClosingBalanceCents: 0,
      auditEntries: scheduleEntries,
    };
  }

  // --- principal distribution (documented deterministic method) -------
  const term = input.termPeriods;
  const basePrincipal = Math.floor(input.principalCents / term);
  const remainder = input.principalCents - basePrincipal * term;
  const plannedPrincipal = (index: number): number =>
    index < remainder ? basePrincipal + 1 : basePrincipal;

  // --- period loop -----------------------------------------------------
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
    const rowId = `EP-${String(i + 1).padStart(3, '0')}`;

    // First pass through the LOCKED pure engines to obtain the period's
    // accrued interest (needed to compute the scheduled payment). The
    // same pure functions are then re-invoked inside the locked row
    // builder — identical inputs, identical results, no duplicated
    // formulas in this file.
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
        requiresReview(
          ES.SCHEDULE_ABORTED_AT_ROW,
          `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): μη υπολογίσιμος τόκος περιόδου. Οι προηγούμενες γραμμές διατηρούνται· τα σύνολα δεν οριστικοποιούνται.`,
          { rowId, period: i + 1, dueDate },
        ),
      );
      const aggregated = [...aggregateAuditEntries(perRowEntries), ...scheduleEntries];
      return emptyResult(
        accrual.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        aggregated,
      );
    }

    const fees = input.feesAndPremiumsPerPeriodCents ?? null;
    const feesForPayment = fees === null ? 0 : fees; // allocation records the assumption
    const scheduledPayment = plannedPrincipal(i) + accrual.interestCents + feesForPayment;

    const built = buildSingleRecalcRow({
      rowId,
      periodStartDate: periodStart,
      dueDate,
      openingBalanceCents: openingBalance,
      paymentAmountCents: scheduledPayment,
      feesAndPremiumsCents: fees,
      rateConfig: input.rateConfig,
      dayCountConvention: input.dayCountConvention,
      ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
      currency,
    });

    perRowEntries.push({ rowId, entries: built.auditEntries });

    if (built.row === null) {
      scheduleEntries.push(
        requiresReview(
          ES.SCHEDULE_ABORTED_AT_ROW,
          `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): η γραμμή δεν μπόρεσε να παραχθεί με ασφάλεια. Οι προηγούμενες γραμμές διατηρούνται· τα σύνολα δεν οριστικοποιούνται.`,
          { rowId, period: i + 1, dueDate },
        ),
      );
      const aggregated = [...aggregateAuditEntries(perRowEntries), ...scheduleEntries];
      return emptyResult(
        built.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        aggregated,
      );
    }

    if (built.status === 'requires_review') anyRequiresReview = true;

    rows.push(built.row);
    totalInterest += built.row.interest.cents;
    totalFees += built.allocation?.feesAndPremiumsDueCents ?? 0;
    totalInstallments += built.row.installment.cents;

    // chain: closing balance becomes the next opening balance
    openingBalance = built.row.closingBalance.cents;
    periodStart = dueDate;
    dueDate = addOneMonthClamped(dueDate);
  }

  const totalPrincipal = rows.reduce((sum, r) => sum + r.principal.cents, 0);
  const finalClosing = rows[rows.length - 1]!.closingBalance.cents;

  const auditEntries = [...aggregateAuditEntries(perRowEntries), ...scheduleEntries];

  return {
    status: anyRequiresReview ? 'requires_review' : 'success',
    rows,
    totalPrincipalCents: totalPrincipal,
    totalInterestCents: totalInterest,
    totalFeesCents: totalFees,
    totalInstallmentsCents: totalInstallments,
    finalClosingBalanceCents: finalClosing,
    auditEntries,
  };
}
