/**
 * Loan Audit PRO — src/engines/interestAccrualEngine.ts
 * ------------------------------------------------------------------
 * Step 3-B: Interest Accrual Engine ONLY.
 *
 * Given an opening principal balance (integer cents), a resolved
 * annual rate (rate engine output) and a day-count result (day count
 * engine output), computes the monetary interest accrued for ONE
 * period. Pure function: no mutation, no I/O, no hidden state.
 *
 * FORMULA (the only formula in this engine):
 *
 *   interest = openingBalance × (appliedAnnualRatePercent / 100)
 *                              × fractionOfYear
 *
 * where openingBalance is the OUTSTANDING PRINCIPAL BALANCE at the
 * start of the period (openingBalanceCents / 100 as a decimal
 * amount), and fractionOfYear comes from the day count engine
 * (days / yearBasis, start excluded / end included).
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026; none of that logic
 *     is copied. In particular, interest is NEVER computed on a
 *     monthly principal installment and no installment value is ever
 *     used as the principal base — the base is always the
 *     outstanding opening balance.
 *   - NO amortization, NO installments, NO schedule rows, NO balance
 *     updates, NO principal allocation. One period in, one interest
 *     amount out.
 *   - Null discipline: null is missing, never zero. An explicit
 *     zero balance is data and yields zero interest with success.
 *   - Negative rates: if the (locked) rate engine produced a
 *     negative applied rate, the resulting negative interest is
 *     allowed and surfaced with an info entry — it is never silently
 *     floored to zero here. Floor policies belong to rate
 *     configuration, not to this engine.
 *   - Precision: the raw interest amount keeps full floating
 *     precision; rounding to cents happens exactly once, at the end,
 *     under an explicit rounding mode (default half_up).
 */

import type { CurrencyCode } from '../domain/money';
import type { AuditEntry } from '../domain/auditTypes';
import type { RateResolutionResult } from './rateEngine';
import type { DayCountResult } from './dayCountEngine';
import {
  info,
  requiresReview,
} from '../domain/auditFactories';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this engine                                 */
/* ------------------------------------------------------------------ */

export const INTEREST_ACCRUAL_AUDIT_CODES = {
  /** Opening balance missing (null) — never coerced to zero. */
  BALANCE_MISSING: 'BALANCE_MISSING',
  /** Opening balance present but not a safe integer of cents. */
  BALANCE_INVALID: 'BALANCE_INVALID',
  /** Interest computed from a preview rate — not for signed use. */
  INTEREST_PREVIEW_REQUIRES_REVIEW: 'INTEREST_PREVIEW_REQUIRES_REVIEW',
  /** Negative applied rate produced negative interest (explicit). */
  NEGATIVE_INTEREST_PRODUCED: 'NEGATIVE_INTEREST_PRODUCED',
} as const;

const IC = INTEREST_ACCRUAL_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type RoundingMode = 'half_up' | 'floor' | 'ceil';

export type InterestAccrualStatus = 'success' | 'requires_review' | 'missing_data';

export interface InterestAccrualInput {
  /** Outstanding principal at period start, integer cents. null = missing. */
  readonly openingBalanceCents: number | null;
  readonly rateResolution: RateResolutionResult;
  readonly dayCount: DayCountResult;
  /** Default 'half_up' (half away from zero, to the nearest cent). */
  readonly roundingMode?: RoundingMode;
  readonly currency?: CurrencyCode;
}

export interface InterestAccrualResult {
  readonly status: InterestAccrualStatus;
  readonly openingBalanceCents: number | null;
  readonly appliedAnnualRatePercent: number | null;
  readonly dayCountDays: number | null;
  readonly fractionOfYear: number | null;
  /**
   * Interest in decimal currency units at FULL precision (unrounded).
   * null whenever interest could not be computed.
   */
  readonly rawInterestAmount: number | null;
  /** Interest rounded to integer cents under roundingMode. */
  readonly interestCents: number | null;
  /** interestCents/100 − rawInterestAmount (signed, decimal units). */
  readonly roundingDifference: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Rounding (applied exactly once, at the end)                         */
/* ------------------------------------------------------------------ */

function roundToCents(rawAmount: number, mode: RoundingMode): number {
  // Normalize binary floating-point noise at the last ulp BEFORE the
  // single final rounding step: products like 100 × (6.06/100) ×
  // (30/360) yield 50.499999999999986 raw cents where the exact value
  // is 50.5. Doubles carry ~15.95 significant decimal digits, so
  // re-reading at 15 significant digits removes one-ulp noise without
  // altering any genuinely distinct amount. This is noise
  // normalization, not premature rounding — documented audit policy.
  const rawCents = Number((rawAmount * 100).toPrecision(15));
  switch (mode) {
    case 'half_up':
      // half away from zero: 0.5 -> 1, -0.5 -> -1
      return Math.sign(rawCents) * Math.round(Math.abs(rawCents));
    case 'floor':
      return Math.floor(rawCents);
    case 'ceil':
      return Math.ceil(rawCents);
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Status semantics:
 *   success         -> confirmed inputs; interestCents is final for
 *                      the period (subject only to display rounding)
 *   requires_review -> either a PREVIEW interest computed from a
 *                      preview rate (marked by audit entry
 *                      INTEREST_PREVIEW_REQUIRES_REVIEW, never for
 *                      signed use), or no numeric result where an
 *                      unknown blocks computation
 *   missing_data    -> a required input is absent; interestCents null
 *
 * All audit entries from the rate resolution and the day count are
 * carried forward so nothing reported upstream is ever dropped.
 */
export function calculateAccruedInterest(
  input: InterestAccrualInput,
): InterestAccrualResult {
  const roundingMode: RoundingMode = input.roundingMode ?? 'half_up';
  const { rateResolution, dayCount } = input;

  // Carry forward ALL upstream audit entries, always.
  const auditEntries: AuditEntry[] = [
    ...rateResolution.auditEntries,
    ...dayCount.auditEntries,
  ];

  const base = {
    openingBalanceCents: input.openingBalanceCents,
    appliedAnnualRatePercent: rateResolution.appliedAnnualRatePercent,
    dayCountDays: dayCount.days,
    fractionOfYear: dayCount.fractionOfYear,
    rawInterestAmount: null as number | null,
    interestCents: null as number | null,
    roundingDifference: null as number | null,
  };

  // --- opening balance: null is missing, never zero -----------------
  if (input.openingBalanceCents === null) {
    auditEntries.push(
      requiresReview(
        IC.BALANCE_MISSING,
        'Ελλιπή δεδομένα: μη διαθέσιμο υπόλοιπο κεφαλαίου έναρξης περιόδου. Ο τόκος δεν υπολογίζεται· το ελλείπον δεν αντικαθίσταται από μηδέν.',
      ),
    );
    return { status: 'missing_data', ...base, auditEntries };
  }
  if (!Number.isSafeInteger(input.openingBalanceCents)) {
    auditEntries.push(
      requiresReview(
        IC.BALANCE_INVALID,
        `Ασυνέπεια δεδομένων: το υπόλοιπο κεφαλαίου έναρξης δεν είναι ακέραιος αριθμός λεπτών (${String(
          input.openingBalanceCents,
        )}).`,
      ),
    );
    return { status: 'missing_data', ...base, auditEntries };
  }

  // --- upstream missing_data blocks everything ----------------------
  if (rateResolution.status === 'missing_data' || dayCount.status === 'missing_data') {
    return { status: 'missing_data', ...base, auditEntries };
  }

  // --- requires_review without numbers: nothing to compute ----------
  const ratePercent = rateResolution.appliedAnnualRatePercent;
  const fraction = dayCount.fractionOfYear;

  const upstreamRequiresReview =
    rateResolution.status === 'requires_review' ||
    dayCount.status === 'requires_review';

  if (ratePercent === null || fraction === null) {
    // e.g. unknown floor policy on a negative index (rate null), or
    // unknown day-count convention (fraction null). No invented values.
    return { status: 'requires_review', ...base, auditEntries };
  }

  // --- the formula: interest on OUTSTANDING OPENING BALANCE ---------
  const openingBalanceDecimal = input.openingBalanceCents / 100;
  const rawInterestAmount =
    openingBalanceDecimal * (ratePercent / 100) * fraction;

  const interestCents = roundToCents(rawInterestAmount, roundingMode);
  const roundingDifference = interestCents / 100 - rawInterestAmount;

  if (ratePercent < 0 && rawInterestAmount < 0) {
    auditEntries.push(
      info(
        IC.NEGATIVE_INTEREST_PRODUCED,
        `Πληροφορία: αρνητικό εφαρμοσθέν επιτόκιο (${ratePercent}%) παρήγαγε αρνητικό τόκο περιόδου. Δεν εφαρμόζεται σιωπηρός μηδενισμός· τυχόν όρος floor ανήκει στη διαμόρφωση επιτοκίου.`,
        { appliedAnnualRatePercent: ratePercent, rawInterestAmount },
      ),
    );
  }

  if (upstreamRequiresReview) {
    auditEntries.push(
      requiresReview(
        IC.INTEREST_PREVIEW_REQUIRES_REVIEW,
        'Απαιτείται έλεγχος: ο τόκος της περιόδου υπολογίστηκε από επιτόκιο προεπισκόπησης (μη οριστικοποιημένο). Το ποσό αποτελεί προεπισκόπηση και δεν προορίζεται για υπογεγραμμένη χρήση χωρίς επιβεβαίωση.',
      ),
    );
    return {
      status: 'requires_review',
      ...base,
      rawInterestAmount,
      interestCents,
      roundingDifference,
      auditEntries,
    };
  }

  return {
    status: 'success',
    ...base,
    rawInterestAmount,
    interestCents,
    roundingDifference,
    auditEntries,
  };
}
