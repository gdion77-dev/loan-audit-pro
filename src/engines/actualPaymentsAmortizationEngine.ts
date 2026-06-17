/**
 * Loan Audit PRO — src/engines/actualPaymentsAmortizationEngine.ts
 * ------------------------------------------------------------------
 * Builds a PARALLEL amortization track driven by the debtor's ACTUAL
 * payments (dates and amounts), separate from the theoretical
 * recalculated schedule (equalInstallmentScheduleEngine.ts, LOCKED —
 * not modified by this file). For each contractual due date it
 * determines what was actually settled, accrues late-payment interest
 * (τόκος υπερημερίας) when declared for the case, and allocates each
 * actual payment in the legally mandated order.
 *
 * LEGAL / METHODOLOGY NOTES (confirmed with the user 2026-06-16,
 * including a second confirmed round on the payment-allocation order
 * — none of this is hard-coded as a universal default value, only
 * the ALLOCATION ORDER is a fixed legal rule):
 *
 *   1. PAYMENT ALLOCATION ORDER — ΑΚ 423 (mandatory, not configurable):
 *      Each actual payment is allocated, in this fixed order:
 *        a) accumulated unpaid interest carried over from earlier
 *           periods (oldest first — ΑΚ 422, oldest contractual
 *           interest before later default interest),
 *        b) the current period's late-payment interest, if any,
 *        c) the current period's own contractual interest,
 *        d) only the remainder reduces PRINCIPAL.
 *      The debtor cannot unilaterally redirect a payment to principal
 *      ahead of interest; this engine never lets it happen either.
 *
 *   2. LATE INTEREST BASIS — Άρθρο 345 ΑΚ:
 *      Accrues only on the outstanding (unpaid) portion of an overdue
 *      installment — never on the portion already paid, never on the
 *      loan's total outstanding principal. (Exception not modelled
 *      here: a validly terminated/accelerated contract makes the
 *      full remaining balance due — out of scope unless requested.)
 *
 *   3. LATE INTEREST RATE:
 *      Contractual annual rate + a surcharge in percentage points.
 *      The surcharge is NEVER hard-coded (2.5 points is a REGULATORY
 *      CEILING under ΠΔ/ΤΕ 2393/96, not a default), so it must be
 *      supplied per case (lateInterestSurchargePercent). null = not
 *      declared → no late interest is computed; affected rows are
 *      flagged requires_review rather than silently assuming 0 or the
 *      ceiling value.
 *
 *   4. UNPAID INTEREST NEVER SILENTLY BECOMES PRINCIPAL — ΑΚ 296 /
 *      Ν.2601/1998 άρθρο 12:
 *      Interest (contractual or late) left unpaid after allocation
 *      stays an outstanding INTEREST claim, carried forward to the
 *      next period; it is never added to principal as it accrues.
 *
 *   5. SEMI-ANNUAL CAPITALIZATION (ανατοκισμός) — NOT automatic:
 *      Only when capitalizeLateInterestSemiAnnually=true is supplied
 *      (an explicit, lawful, case-specific contractual basis is the
 *      caller's responsibility to establish), the accumulated unpaid
 *      interest carried into a six-monthly boundary is folded into
 *      principal at that boundary, exactly once per elapsed 6-month
 *      block, starting from the first due date in the schedule.
 *      Without this flag, capitalization never happens, per ΑΚ 296.
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026; no logic copied.
 *   - Does NOT modify equalInstallmentScheduleEngine.ts,
 *     interestAccrualEngine.ts, dayCountEngine.ts, rateEngine.ts, or
 *     paymentReconciliationEngine.ts. Reuses calculateDayCount
 *     (read-only call) for date arithmetic; reimplements the same
 *     documented formula (balance × rate/100 × fractionOfYear,
 *     half-up cents rounding) for late interest only.
 *   - Null discipline preserved: a missing input is null, never
 *     coerced to zero. An explicit zero payment is data.
 *   - Neutral wording only; no legal-conclusion language.
 */
import type { ISODate } from '../domain/dateTypes';
import type { CurrencyCode } from '../domain/money';
import type { AuditEntry } from '../domain/auditTypes';
import { info, requiresReview } from '../domain/auditFactories';
import { calculateDayCount } from './dayCountEngine';
import type { DayCountConvention } from '../domain/dateTypes';

/* ------------------------------------------------------------------ */
/* Audit codes                                                         */
/* ------------------------------------------------------------------ */

export const ACTUAL_PAYMENTS_AMORTIZATION_AUDIT_CODES = {
  LATE_INTEREST_ACCRUED: 'LATE_INTEREST_ACCRUED',
  LATE_INTEREST_SURCHARGE_MISSING: 'LATE_INTEREST_SURCHARGE_MISSING',
  INTEREST_UNDERPAID_CARRIED_FORWARD: 'INTEREST_UNDERPAID_CARRIED_FORWARD',
  PAYMENT_ALLOCATED: 'PAYMENT_ALLOCATED',
  INSTALLMENT_OVERPAID: 'INSTALLMENT_OVERPAID',
  SEMIANNUAL_CAPITALIZATION_APPLIED: 'SEMIANNUAL_CAPITALIZATION_APPLIED',
} as const;

const AC = ACTUAL_PAYMENTS_AMORTIZATION_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Input types                                                         */
/* ------------------------------------------------------------------ */

/** One contractually-due installment from the theoretical schedule. */
export interface DueInstallment {
  readonly rowId: string;
  readonly dueDate: ISODate;
  readonly installmentCents: number;
  /** Theoretical contractual interest for this period — read-only reference. */
  readonly interestCents: number;
  /** Theoretical contractual principal for this period — read-only reference. */
  readonly principalCents: number;
}

/** One actual payment made by the debtor. */
export interface ActualPaymentInput {
  readonly paymentId: string;
  readonly paymentDate: ISODate;
  readonly amountCents: number;
  /** Which due installment this payment is allocated against. */
  readonly matchedRowId: string;
}

export interface ActualPaymentsAmortizationConfig {
  readonly openingPrincipalCents: number;
  readonly contractualAnnualRatePercent: number;
  readonly dayCountConvention: DayCountConvention;
  /**
   * Surcharge in percentage points added to the contractual rate to
   * obtain the late-interest rate. null = not declared for this case
   * → no late interest is accrued (rows flagged requires_review,
   * never a silent assumption of 0 or the regulatory ceiling).
   */
  readonly lateInterestSurchargePercent: number | null;
  /** Default false — see methodology note 5 above. */
  readonly capitalizeLateInterestSemiAnnually?: boolean;
  readonly currency?: CurrencyCode;
}

/* ------------------------------------------------------------------ */
/* Result types                                                       */
/* ------------------------------------------------------------------ */

export type ActualAmortizationRowStatus =
  | 'settled_on_time'
  | 'settled_late'
  | 'partially_settled'
  | 'unsettled'
  | 'requires_review';

export interface ActualAmortizationRow {
  readonly rowId: string;
  readonly dueDate: ISODate;
  readonly installmentCents: number;
  readonly contractualInterestCents: number;
  /** Sum of actual payments allocated against this row's due date, in order received. */
  readonly paidCents: number;
  readonly lastPaymentDate: ISODate | null;
  /** Late interest accrued for THIS period's overdue portion (not the carried-forward balance). */
  readonly lateInterestAccruedCents: number | null;
  readonly lateDays: number | null;
  /** Portion of the payment(s) allocated to interest (carried-forward + late + current), per ΑΚ 423. */
  readonly appliedToInterestCents: number;
  /** Portion of the payment(s) allocated to principal — only the remainder after interest. */
  readonly appliedToPrincipalCents: number;
  /** Outstanding (unpaid) interest carried forward into the NEXT period — never added to principal here. */
  readonly unpaidInterestCarryForwardCents: number;
  readonly status: ActualAmortizationRowStatus;
  /** Real (actual-payment-driven) closing PRINCIPAL balance after this row. */
  readonly actualClosingBalanceCents: number;
}

export interface ActualPaymentsAmortizationResult {
  readonly status: 'success' | 'requires_review' | 'missing_data';
  readonly rows: readonly ActualAmortizationRow[];
  readonly totalLateInterestCents: number | null;
  /** Unpaid interest still outstanding after the last row (not folded into principal unless capitalized). */
  readonly finalUnpaidInterestCents: number;
  readonly finalActualBalanceCents: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function roundHalfUpCents(rawCents: number): number {
  return Math.sign(rawCents) * Math.round(Math.abs(rawCents));
}

/** Interest on a given base, for the days between two dates (start excluded, end included). */
function accrueInterestOnBase(
  baseCents: number,
  fromExclusive: ISODate,
  toInclusive: ISODate,
  ratePercent: number,
  dayCountConvention: DayCountConvention,
): { cents: number; days: number | null; auditEntries: AuditEntry[] } {
  if (baseCents <= 0) return { cents: 0, days: 0, auditEntries: [] };
  const dc = calculateDayCount(fromExclusive, toInclusive, dayCountConvention);
  if (dc.status !== 'success' || dc.fractionOfYear === null) {
    return { cents: 0, days: dc.days, auditEntries: [...dc.auditEntries] };
  }
  const raw = (baseCents / 100) * (ratePercent / 100) * dc.fractionOfYear * 100;
  return { cents: roundHalfUpCents(raw), days: dc.days, auditEntries: [...dc.auditEntries] };
}

/** 6-month boundaries from `anchor`, up to and including `upTo`. */
function sixMonthBoundariesUpTo(anchor: ISODate, upTo: ISODate): ISODate[] {
  const boundaries: ISODate[] = [];
  const [ay, am, ad] = anchor.split('-').map(Number) as [number, number, number];
  let y = ay;
  let m = am;
  let step = 0;
  while (step < 240) {
    m += 6;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(ad).padStart(2, '0')}` as ISODate;
    if (candidate > upTo) break;
    boundaries.push(candidate);
    step += 1;
  }
  return boundaries;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Builds the actual-payment-driven amortization track applying the
 * ΑΚ 423 allocation order (unpaid interest carry-forward, then this
 * period's late interest, then this period's contractual interest,
 * then principal). Pure function: no mutation of inputs, no I/O. Rows
 * are produced in the order of `dueInstallments` (caller is
 * responsible for chronological order).
 */
export function buildActualPaymentsAmortization(
  dueInstallments: readonly DueInstallment[],
  actualPayments: readonly ActualPaymentInput[],
  config: ActualPaymentsAmortizationConfig,
): ActualPaymentsAmortizationResult {
  const auditEntries: AuditEntry[] = [];
  const currency = config.currency ?? 'EUR';

  if (dueInstallments.length === 0) {
    return {
      status: 'missing_data',
      rows: [],
      totalLateInterestCents: null,
      finalUnpaidInterestCents: 0,
      finalActualBalanceCents: null,
      auditEntries,
    };
  }

  const surcharge = config.lateInterestSurchargePercent;
  if (surcharge === null) {
    auditEntries.push(
      requiresReview(
        AC.LATE_INTEREST_SURCHARGE_MISSING,
        'Δεν έχει δηλωθεί προσαύξηση τόκου υπερημερίας για την υπόθεση· δεν υπολογίζεται τόκος υπερημερίας (παραμένει null, δεν τεκμαίρεται μηδέν ή το ανώτατο νόμιμο όριο).',
      ),
    );
  }
  const lateRatePercent =
    surcharge !== null ? config.contractualAnnualRatePercent + surcharge : null;

  let runningPrincipalCents = config.openingPrincipalCents;
  let unpaidInterestCarryForwardCents = 0;
  let totalLateInterestCents = surcharge !== null ? 0 : null;
  let anyRequiresReview = surcharge === null;
  const capitalize = config.capitalizeLateInterestSemiAnnually === true;
  const anchorDate = dueInstallments[0]!.dueDate;
  const appliedBoundaries = new Set<string>();

  const rows: ActualAmortizationRow[] = [];

  for (const due of dueInstallments) {
    const payments = actualPayments
      .filter((p) => p.matchedRowId === due.rowId)
      .slice()
      .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

    const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const lastPaymentDate = payments.length > 0 ? payments[payments.length - 1]!.paymentDate : null;

    // --- 1. Late interest for THIS period's overdue portion --------
    let lateInterestAccruedCents: number | null = null;
    let lateDays: number | null = null;
    const overdueBase = Math.max(0, due.installmentCents - paidCents);
    const wasEverLate = lastPaymentDate !== null && lastPaymentDate > due.dueDate;

    if ((overdueBase > 0 || wasEverLate) && lateRatePercent !== null) {
      const toDate = lastPaymentDate;
      if (toDate !== null && toDate > due.dueDate) {
        const lateBase = paidCents >= due.installmentCents ? due.installmentCents : overdueBase;
        const accrual = accrueInterestOnBase(
          lateBase,
          due.dueDate,
          toDate,
          lateRatePercent,
          config.dayCountConvention,
        );
        lateInterestAccruedCents = accrual.cents;
        lateDays = accrual.days;
        auditEntries.push(...accrual.auditEntries);
        if (accrual.cents > 0) {
          auditEntries.push(
            info(
              AC.LATE_INTEREST_ACCRUED,
              `Δόση ${due.rowId}: τόκος υπερημερίας ${accrual.cents / 100} ${currency} για ${accrual.days ?? '—'} ημέρες επί ${lateBase / 100} ${currency} (επιτόκιο ${lateRatePercent}%).`,
            ),
          );
        }
        if (totalLateInterestCents !== null) totalLateInterestCents += accrual.cents;
      } else if (toDate === null && overdueBase > 0) {
        anyRequiresReview = true;
      }
    } else if (overdueBase > 0 && lateRatePercent === null) {
      anyRequiresReview = true;
    }

    // --- 2. ΑΚ 423 allocation of this period's actual payment(s) ----
    let remaining = paidCents;
    let appliedToInterestCents = 0;

    const carryDue = unpaidInterestCarryForwardCents;
    const fromCarry = Math.min(remaining, carryDue);
    remaining -= fromCarry;
    appliedToInterestCents += fromCarry;
    unpaidInterestCarryForwardCents -= fromCarry;

    const lateDue = lateInterestAccruedCents ?? 0;
    const fromLate = Math.min(remaining, lateDue);
    remaining -= fromLate;
    appliedToInterestCents += fromLate;
    const unpaidLateThisPeriod = lateDue - fromLate;

    const contractualDue = due.interestCents;
    const fromContractual = Math.min(remaining, contractualDue);
    remaining -= fromContractual;
    appliedToInterestCents += fromContractual;
    const unpaidContractualThisPeriod = contractualDue - fromContractual;

    const appliedToPrincipalCents = remaining;
    unpaidInterestCarryForwardCents += unpaidLateThisPeriod + unpaidContractualThisPeriod;

    if (unpaidLateThisPeriod > 0 || unpaidContractualThisPeriod > 0) {
      auditEntries.push(
        info(
          AC.INTEREST_UNDERPAID_CARRIED_FORWARD,
          `Δόση ${due.rowId}: ανεξόφλητος τόκος ${(unpaidLateThisPeriod + unpaidContractualThisPeriod) / 100} ${currency} μεταφέρεται ως οφειλόμενος τόκος στην επόμενη περίοδο (ΑΚ 423/296) — δεν προστίθεται στο κεφάλαιο.`,
        ),
      );
    }
    auditEntries.push(
      info(
        AC.PAYMENT_ALLOCATED,
        `Δόση ${due.rowId}: καταβολή ${paidCents / 100} ${currency} καταλογίστηκε — τόκοι ${appliedToInterestCents / 100} ${currency}, κεφάλαιο ${appliedToPrincipalCents / 100} ${currency} (ΑΚ 423).`,
      ),
    );

    runningPrincipalCents -= appliedToPrincipalCents;

    if (appliedToPrincipalCents > due.principalCents) {
      auditEntries.push(
        info(
          AC.INSTALLMENT_OVERPAID,
          `Δόση ${due.rowId}: υπερκάλυψη ${(appliedToPrincipalCents - due.principalCents) / 100} ${currency} έναντι του θεωρητικού κεφαλαίου της δόσης, μετά τον καταλογισμό τόκων.`,
        ),
      );
    }

    // --- 3. Status ----------------------------------------------------
    let status: ActualAmortizationRowStatus;
    const fullySettled = overdueBase === 0 && unpaidLateThisPeriod === 0 && unpaidContractualThisPeriod === 0;
    if (fullySettled) {
      status = wasEverLate ? 'settled_late' : 'settled_on_time';
    } else if (paidCents === 0 && lastPaymentDate === null) {
      status = 'unsettled';
    } else {
      status = 'partially_settled';
    }
    if ((overdueBase > 0 && lateRatePercent === null) || (overdueBase > 0 && lastPaymentDate === null)) {
      status = 'requires_review';
    }

    rows.push({
      rowId: due.rowId,
      dueDate: due.dueDate,
      installmentCents: due.installmentCents,
      contractualInterestCents: due.interestCents,
      paidCents,
      lastPaymentDate,
      lateInterestAccruedCents,
      lateDays,
      appliedToInterestCents,
      appliedToPrincipalCents,
      unpaidInterestCarryForwardCents,
      status,
      actualClosingBalanceCents: runningPrincipalCents,
    });

    // --- 4. Optional semi-annual capitalization (ΑΚ 296 exception) ---
    if (capitalize) {
      for (const boundary of sixMonthBoundariesUpTo(anchorDate, due.dueDate)) {
        if (appliedBoundaries.has(boundary)) continue;
        appliedBoundaries.add(boundary);
        if (unpaidInterestCarryForwardCents > 0) {
          const capitalized = unpaidInterestCarryForwardCents;
          runningPrincipalCents += capitalized;
          unpaidInterestCarryForwardCents = 0;
          auditEntries.push(
            info(
              AC.SEMIANNUAL_CAPITALIZATION_APPLIED,
              `Εξαμηνιαία κεφαλαιοποίηση (${boundary}): ανεξόφλητος τόκος ${capitalized / 100} ${currency} προστέθηκε στο κεφάλαιο, βάσει ρητής συμβατικής πρόβλεψης ανατοκισμού (άρθ. 12 Ν.2601/1998).`,
            ),
          );
          rows[rows.length - 1] = {
            ...rows[rows.length - 1]!,
            actualClosingBalanceCents: runningPrincipalCents,
            unpaidInterestCarryForwardCents,
          };
        }
      }
    }
  }

  const finalRow = rows[rows.length - 1];
  return {
    status: anyRequiresReview ? 'requires_review' : 'success',
    rows,
    totalLateInterestCents,
    finalUnpaidInterestCents: unpaidInterestCarryForwardCents,
    finalActualBalanceCents: finalRow ? finalRow.actualClosingBalanceCents : config.openingPrincipalCents,
    auditEntries,
  };
}
