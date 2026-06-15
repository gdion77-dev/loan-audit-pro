/**
 * Loan Audit PRO — src/engines/paymentAllocationEngine.ts
 * ------------------------------------------------------------------
 * Step 4-A: Single-period Payment Allocation Engine ONLY.
 *
 * Given the opening balance, the accrued interest of ONE period
 * (already computed upstream by the locked interest accrual engine),
 * a payment/installment amount and optional fees/premiums, allocates
 * the payment in the fixed MVP waterfall:
 *
 *   fees/premiums → interest → principal
 *
 * and returns the allocation, any unpaid components, any overpayment
 * and the closing balance. Pure function: no mutation, no I/O.
 *
 * All monetary values are INTEGER CENTS. null = missing (never zero);
 * explicit 0 is valid data.
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026; none of that logic
 *     is copied.
 *   - ONE period only: no loops over periods, no schedule rows, no
 *     due dates, no interest computation, no calls to the rate /
 *     day-count / interest-accrual engines. The accrued interest
 *     arrives as an input (e.g. InterestAccrualResult.interestCents
 *     from the locked accrual engine).
 *   - closingBalance can never go below zero and
 *     allocatedToPrincipal can never exceed the opening balance;
 *     any excess is surfaced as overpayment, explicitly.
 *   - Negative accrued interest is NOT silently zeroed and NOT
 *     allocated: it returns requires_review until a credit policy
 *     is explicitly designed.
 */

import type { CurrencyCode } from '../domain/money';
import type { AuditEntry } from '../domain/auditTypes';
import {
  VALIDATION_AUDIT_CODES as C,
  info,
  assumption,
  requiresReview,
} from '../domain/auditFactories';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this engine                                 */
/* ------------------------------------------------------------------ */

export const PAYMENT_ALLOCATION_AUDIT_CODES = {
  /** Same code value as the accrual engine uses for a null balance. */
  BALANCE_MISSING: 'BALANCE_MISSING',
  /** Reused from Step 1-B validators. */
  PAYMENT_AMOUNT_MISSING: C.PAYMENT_AMOUNT_MISSING,
  /** Accrued interest for the period is null. */
  INTEREST_MISSING: 'INTEREST_MISSING',
  /** Fees were null and assumed zero — explicit assumption. */
  FEES_ASSUMED_ZERO: 'FEES_ASSUMED_ZERO',
  /** Allocation order not provided — MVP default assumed. */
  ALLOCATION_ORDER_ASSUMED: 'ALLOCATION_ORDER_ASSUMED',
  /** Payment exceeded fees + interest + full principal. */
  OVERPAYMENT_AFTER_FULL_PRINCIPAL: 'OVERPAYMENT_AFTER_FULL_PRINCIPAL',
  /** Negative accrued interest — no credit policy designed yet. */
  NEGATIVE_INTEREST_REQUIRES_REVIEW: 'NEGATIVE_INTEREST_REQUIRES_REVIEW',
  /** Negative or non-integer payment amount. */
  PAYMENT_AMOUNT_INVALID: 'PAYMENT_AMOUNT_INVALID',
  /** Negative or non-integer fees/premiums. */
  FEES_INVALID: 'FEES_INVALID',
  /** Non-integer opening balance. */
  BALANCE_INVALID: 'BALANCE_INVALID',
} as const;

const PA = PAYMENT_ALLOCATION_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AllocationOrder = 'fees_interest_principal';

export type PaymentAllocationStatus = 'success' | 'requires_review' | 'missing_data';

export type PaymentSource =
  | 'scheduled_installment'
  | 'actual_payment'
  | 'bank_schedule'
  | 'user_input';

export interface PaymentAllocationInput {
  /** Outstanding principal at period start, integer cents. null = missing. */
  readonly openingBalanceCents: number | null;
  /** Accrued interest of the period (from the accrual engine). null = missing. */
  readonly accruedInterestCents: number | null;
  /** Payment or scheduled installment amount. null = missing. */
  readonly paymentAmountCents: number | null;
  /** Fees / premiums due. null = not provided (assumed 0 with audit entry). */
  readonly feesAndPremiumsCents?: number | null;
  /** MVP supports only the default waterfall. */
  readonly allocationOrder?: AllocationOrder;
  readonly currency?: CurrencyCode;
  readonly source?: PaymentSource;
}

export interface PaymentAllocationResult {
  readonly status: PaymentAllocationStatus;
  readonly openingBalanceCents: number | null;
  readonly paymentAmountCents: number | null;
  readonly feesAndPremiumsDueCents: number | null;
  readonly interestDueCents: number | null;
  readonly allocatedToFeesCents: number | null;
  readonly allocatedToInterestCents: number | null;
  readonly allocatedToPrincipalCents: number | null;
  readonly unpaidFeesCents: number | null;
  readonly unpaidInterestCents: number | null;
  readonly overpaymentCents: number | null;
  readonly closingBalanceCents: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Allocate ONE payment over ONE period: fees → interest → principal.
 *
 * Status semantics:
 *   success         -> complete allocation (unpaid components and
 *                      overpayment, if any, are explicit outputs —
 *                      a partial payment is still a successful
 *                      allocation)
 *   requires_review -> inputs present but inconsistent (negative
 *                      interest / payment / fees); nothing allocated
 *   missing_data    -> a required input is null; nothing allocated
 */
export function allocateSinglePayment(
  input: PaymentAllocationInput,
): PaymentAllocationResult {
  const auditEntries: AuditEntry[] = [];

  const nullResult = (status: PaymentAllocationStatus): PaymentAllocationResult => ({
    status,
    openingBalanceCents: input.openingBalanceCents ?? null,
    paymentAmountCents: input.paymentAmountCents ?? null,
    feesAndPremiumsDueCents: input.feesAndPremiumsCents ?? null,
    interestDueCents: input.accruedInterestCents ?? null,
    allocatedToFeesCents: null,
    allocatedToInterestCents: null,
    allocatedToPrincipalCents: null,
    unpaidFeesCents: null,
    unpaidInterestCents: null,
    overpaymentCents: null,
    closingBalanceCents: null,
    auditEntries,
  });

  // --- allocation order: MVP default, assumed explicitly -------------
  if (input.allocationOrder === undefined) {
    auditEntries.push(
      assumption(
        PA.ALLOCATION_ORDER_ASSUMED,
        'Ρητή υπόθεση: σειρά καταλογισμού «έξοδα/ασφάλιστρα → τόκοι → κεφάλαιο» (προεπιλογή MVP), καθώς δεν δηλώθηκε σειρά.',
      ),
    );
  }

  // --- missing inputs: null is missing, never zero -------------------
  let missing = false;

  if (input.openingBalanceCents === null) {
    missing = true;
    auditEntries.push(
      requiresReview(
        PA.BALANCE_MISSING,
        'Ελλιπή δεδομένα: μη διαθέσιμο υπόλοιπο κεφαλαίου έναρξης. Ο καταλογισμός δεν εκτελείται· το ελλείπον δεν αντικαθίσταται από μηδέν.',
      ),
    );
  }
  if (input.paymentAmountCents === null) {
    missing = true;
    auditEntries.push(
      requiresReview(
        PA.PAYMENT_AMOUNT_MISSING,
        'Ελλιπή δεδομένα: μη διαθέσιμο ποσό καταβολής/δόσης. Ο καταλογισμός δεν εκτελείται.',
      ),
    );
  }
  if (input.accruedInterestCents === null) {
    missing = true;
    auditEntries.push(
      requiresReview(
        PA.INTEREST_MISSING,
        'Ελλιπή δεδομένα: μη διαθέσιμος δεδουλευμένος τόκος περιόδου. Ο καταλογισμός δεν εκτελείται.',
      ),
    );
  }

  if (missing) return nullResult('missing_data');

  const openingBalance = input.openingBalanceCents as number;
  const payment = input.paymentAmountCents as number;
  const interestDue = input.accruedInterestCents as number;

  // --- fees: null assumed 0 ONLY with explicit assumption ------------
  let feesDue: number;
  if (input.feesAndPremiumsCents === null || input.feesAndPremiumsCents === undefined) {
    feesDue = 0;
    auditEntries.push(
      assumption(
        PA.FEES_ASSUMED_ZERO,
        'Ρητή υπόθεση: δεν δηλώθηκαν έξοδα/ασφάλιστρα περιόδου· θεωρούνται μηδενικά για τον καταλογισμό. Απαιτείται αντιπαραβολή με την πηγή.',
      ),
    );
  } else {
    feesDue = input.feesAndPremiumsCents; // explicit 0 is valid data
  }

  // --- integrity of present values -----------------------------------
  let invalid = false;

  if (!Number.isSafeInteger(openingBalance) || openingBalance < 0) {
    invalid = true;
    auditEntries.push(
      requiresReview(
        PA.BALANCE_INVALID,
        `Ασυνέπεια δεδομένων: μη έγκυρο υπόλοιπο κεφαλαίου έναρξης (${String(openingBalance)}).`,
      ),
    );
  }
  if (!Number.isSafeInteger(payment) || payment < 0) {
    invalid = true;
    auditEntries.push(
      requiresReview(
        PA.PAYMENT_AMOUNT_INVALID,
        `Ασυνέπεια δεδομένων: μη έγκυρο (αρνητικό ή μη ακέραιο) ποσό καταβολής (${String(payment)}).`,
      ),
    );
  }
  if (!Number.isSafeInteger(feesDue) || feesDue < 0) {
    invalid = true;
    auditEntries.push(
      requiresReview(
        PA.FEES_INVALID,
        `Ασυνέπεια δεδομένων: μη έγκυρα (αρνητικά ή μη ακέραια) έξοδα/ασφάλιστρα (${String(feesDue)}).`,
      ),
    );
  }
  if (!Number.isSafeInteger(interestDue)) {
    invalid = true;
    auditEntries.push(
      requiresReview(
        PA.INTEREST_MISSING,
        `Ασυνέπεια δεδομένων: μη ακέραιος δεδουλευμένος τόκος (${String(interestDue)}).`,
      ),
    );
  }

  // --- negative interest: no credit policy yet — review, no zeroing --
  if (!invalid && interestDue < 0) {
    auditEntries.push(
      requiresReview(
        PA.NEGATIVE_INTEREST_REQUIRES_REVIEW,
        `Απαιτείται έλεγχος: αρνητικός δεδουλευμένος τόκος περιόδου (${interestDue} λεπτά). Δεν εφαρμόζεται σιωπηρός μηδενισμός ούτε καταλογισμός πίστωσης· ο χειρισμός αρνητικού τόκου απαιτεί ρητή πολιτική.`,
        { accruedInterestCents: interestDue },
      ),
    );
    return nullResult('requires_review');
  }

  if (invalid) return nullResult('requires_review');

  // --- the waterfall: fees → interest → principal --------------------
  let remaining = payment;

  const allocatedToFees = Math.min(remaining, feesDue);
  remaining -= allocatedToFees;

  const allocatedToInterest = Math.min(remaining, interestDue);
  remaining -= allocatedToInterest;

  // principal can never exceed the opening balance:
  const allocatedToPrincipal = Math.min(remaining, openingBalance);
  remaining -= allocatedToPrincipal;

  const unpaidFees = feesDue - allocatedToFees;
  const unpaidInterest = interestDue - allocatedToInterest;
  const overpayment = remaining; // >= 0 by construction
  const closingBalance = openingBalance - allocatedToPrincipal; // >= 0

  if (overpayment > 0) {
    auditEntries.push(
      info(
        PA.OVERPAYMENT_AFTER_FULL_PRINCIPAL,
        `Πληροφορία: η καταβολή υπερκαλύπτει έξοδα, τόκους και πλήρες υπόλοιπο κεφαλαίου· πλεόνασμα ${overpayment} λεπτών. Το υπόλοιπο κλεισίματος δεν γίνεται αρνητικό.`,
        { overpaymentCents: overpayment },
      ),
    );
  }

  return {
    status: 'success',
    openingBalanceCents: openingBalance,
    paymentAmountCents: payment,
    feesAndPremiumsDueCents: feesDue,
    interestDueCents: interestDue,
    allocatedToFeesCents: allocatedToFees,
    allocatedToInterestCents: allocatedToInterest,
    allocatedToPrincipalCents: allocatedToPrincipal,
    unpaidFeesCents: unpaidFees,
    unpaidInterestCents: unpaidInterest,
    overpaymentCents: overpayment,
    closingBalanceCents: closingBalance,
    auditEntries,
  };
}
