/**
 * Loan Audit PRO — src/engines/recalcRowBuilder.ts
 * ------------------------------------------------------------------
 * Step 4-B: Single Recalculation Row Builder ONLY.
 *
 * Composes the four LOCKED engines for exactly ONE period:
 *
 *   1. resolveRateForDate(rateConfig, dueDate)          [rate engine]
 *   2. calculateDayCount(periodStart, dueDate, conv)    [day count]
 *   3. calculateAccruedInterest(balance, rate, days)    [accrual]
 *   4. allocateSinglePayment(balance, interest, pay)    [allocation]
 *
 * and assembles one RecalcRow. NO internal logic of any engine is
 * duplicated here: interest comes ONLY from the accrual engine
 * (computed on the outstanding opening balance — never on a monthly
 * principal installment), principal and closing balance come ONLY
 * from the allocation engine.
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026; none of that logic
 *     is copied.
 *   - ONE period only: no loops over periods, no schedule
 *     generation, no next-due-date derivation.
 *   - NO comparison with bank/fund data and NO economicDifference —
 *     that belongs to the later comparison engine.
 *   - All upstream audit entries are preserved; nothing is hidden.
 *   - null = missing (never zero); explicit 0 balance / payment /
 *     fees are valid data.
 */

import type { ISODate, DayCountConvention } from '../domain/dateTypes';
import type { RateConfig } from '../domain/rateTypes';
import type { CurrencyCode } from '../domain/money';
import { moneyFromCents } from '../domain/money';
import type { RecalcRow, RateBreakdown } from '../domain/scheduleTypes';
import type { AuditEntry } from '../domain/auditTypes';
import { requiresReview } from '../domain/auditFactories';
import { resolveRateForDate, type RateResolutionResult } from './rateEngine';
import { calculateDayCount, type DayCountResult } from './dayCountEngine';
import {
  calculateAccruedInterest,
  type InterestAccrualResult,
  type RoundingMode,
} from './interestAccrualEngine';
import {
  allocateSinglePayment,
  type PaymentAllocationResult,
} from './paymentAllocationEngine';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this builder                                */
/* ------------------------------------------------------------------ */

export const RECALC_ROW_AUDIT_CODES = {
  /** A row was produced from preview values — not for signed use. */
  ROW_PREVIEW_REQUIRES_REVIEW: 'ROW_PREVIEW_REQUIRES_REVIEW',
} as const;

const RB = RECALC_ROW_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type SingleRecalcRowStatus = 'success' | 'requires_review' | 'missing_data';

export interface SingleRecalcRowInput {
  readonly rowId: string;
  readonly periodStartDate: ISODate;
  readonly dueDate: ISODate;
  readonly openingBalanceCents: number | null;
  readonly paymentAmountCents: number | null;
  readonly feesAndPremiumsCents?: number | null;
  readonly rateConfig: RateConfig;
  readonly dayCountConvention: DayCountConvention;
  readonly roundingMode?: RoundingMode;
  readonly currency?: CurrencyCode;
}

export interface SingleRecalcRowResult {
  readonly status: SingleRecalcRowStatus;
  /** Assembled row, or null when no safe row can be produced. */
  readonly row: RecalcRow | null;
  /** null when allocation could not run (e.g. interest unavailable). */
  readonly allocation: PaymentAllocationResult | null;
  readonly rateResolution: RateResolutionResult;
  readonly dayCount: DayCountResult;
  readonly interestAccrual: InterestAccrualResult | null;
  /** Union of ALL upstream entries plus this builder's own. */
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Build ONE recalculation row by composing the locked engines.
 *
 * Status propagation:
 *   missing_data    -> a critical stage returned missing_data (rate,
 *                      day count, balance, payment); row is null
 *   requires_review -> a numeric path exists but at least one stage
 *                      requires review (preview rate, unknown
 *                      day-count, negative interest); a preview row
 *                      may be produced and is explicitly marked
 *   success         -> all four stages returned success
 */
export function buildSingleRecalcRow(
  input: SingleRecalcRowInput,
): SingleRecalcRowResult {
  const currency: CurrencyCode = input.currency ?? 'EUR';

  // --- stage 1+2: rate and day count (independent) -------------------
  const rateResolution = resolveRateForDate(input.rateConfig, input.dueDate);
  const dayCount = calculateDayCount(
    input.periodStartDate,
    input.dueDate,
    input.dayCountConvention,
  );

  // --- stage 3: accrual (carries rate + day count entries forward) ---
  const interestAccrual = calculateAccruedInterest({
    openingBalanceCents: input.openingBalanceCents,
    rateResolution,
    dayCount,
    ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
    currency,
  });

  // accrual.auditEntries already contains rate + day count entries.
  const auditEntries: AuditEntry[] = [...interestAccrual.auditEntries];

  // --- no computable interest: stop before allocation ----------------
  if (interestAccrual.interestCents === null) {
    return {
      status: interestAccrual.status === 'missing_data' ? 'missing_data' : 'requires_review',
      row: null,
      allocation: null,
      rateResolution,
      dayCount,
      interestAccrual,
      auditEntries,
    };
  }

  // --- stage 4: allocation -------------------------------------------
  const allocation = allocateSinglePayment({
    openingBalanceCents: input.openingBalanceCents,
    accruedInterestCents: interestAccrual.interestCents,
    paymentAmountCents: input.paymentAmountCents,
    feesAndPremiumsCents:
      input.feesAndPremiumsCents === undefined ? null : input.feesAndPremiumsCents,
    allocationOrder: 'fees_interest_principal',
    currency,
    source: 'scheduled_installment',
  });
  auditEntries.push(...allocation.auditEntries);

  if (allocation.status === 'missing_data') {
    return {
      status: 'missing_data',
      row: null,
      allocation,
      rateResolution,
      dayCount,
      interestAccrual,
      auditEntries,
    };
  }
  if (allocation.status === 'requires_review') {
    // e.g. negative accrued interest: no forced allocation, no row.
    return {
      status: 'requires_review',
      row: null,
      allocation,
      rateResolution,
      dayCount,
      interestAccrual,
      auditEntries,
    };
  }

  // --- assemble the row (values come ONLY from the engines) ----------
  const appliedAnnualRatePercent = rateResolution.appliedAnnualRatePercent as number;
  const rateBreakdown: RateBreakdown = {
    indexPercent: rateResolution.effectiveIndexPercent,
    spreadPercent: rateResolution.spreadPercent,
    law128Percent: rateResolution.law128Percent,
    totalPercent: appliedAnnualRatePercent,
  };

  const upstreamRequiresReview =
    rateResolution.status === 'requires_review' ||
    dayCount.status === 'requires_review' ||
    interestAccrual.status === 'requires_review';

  const assumptions = auditEntries
    .filter((e) => e.severity === 'assumption' || e.severity === 'requires_review')
    .map((e) => e.code);

  const row: RecalcRow = Object.freeze({
    rowId: input.rowId,
    dueDate: input.dueDate,
    openingBalance: moneyFromCents(allocation.openingBalanceCents as number, currency),
    appliedAnnualRatePercent,
    rateBreakdown,
    dayCountDays: dayCount.days as number,
    interest: moneyFromCents(interestAccrual.interestCents, currency),
    principal: moneyFromCents(allocation.allocatedToPrincipalCents as number, currency),
    installment: moneyFromCents(allocation.paymentAmountCents as number, currency),
    closingBalance: moneyFromCents(allocation.closingBalanceCents as number, currency),
    assumptions,
  });

  if (upstreamRequiresReview) {
    auditEntries.push(
      requiresReview(
        RB.ROW_PREVIEW_REQUIRES_REVIEW,
        'Απαιτείται έλεγχος: η γραμμή επανυπολογισμού παρήχθη από μη οριστικοποιημένα μεγέθη (προεπισκόπηση) και δεν προορίζεται για υπογεγραμμένη χρήση χωρίς επιβεβαίωση.',
        { rowId: input.rowId, dueDate: input.dueDate },
      ),
    );
    return {
      status: 'requires_review',
      row,
      allocation,
      rateResolution,
      dayCount,
      interestAccrual,
      auditEntries,
    };
  }

  return {
    status: 'success',
    row,
    allocation,
    rateResolution,
    dayCount,
    interestAccrual,
    auditEntries,
  };
}
