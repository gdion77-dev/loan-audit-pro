/**
 * Loan Audit PRO — src/domain/paymentTypes.ts
 * ------------------------------------------------------------------
 * Actual payments made by the debtor and their matching to schedule
 * rows. Matching logic itself is a later engine (Step with
 * paymentReconciliationEngine); only the types live here.
 */

import type { ISODate } from './dateTypes';
import type { Money } from './money';

/**
 * Confidence of the payment-to-installment match.
 *   manual          -> matched by the user
 *   auto_exact      -> exact amount + date within tolerance
 *   auto_heuristic  -> approximate match; requires user confirmation
 *   unmatched       -> no match; must surface as a finding
 */
export type MatchConfidence =
  | 'manual'
  | 'auto_exact'
  | 'auto_heuristic'
  | 'unmatched';

export const MATCH_CONFIDENCES: readonly MatchConfidence[] = [
  'manual',
  'auto_exact',
  'auto_heuristic',
  'unmatched',
] as const;

/** Μία πραγματική καταβολή. */
export interface ActualPayment {
  readonly paymentId: string;
  readonly date: ISODate;
  /** Amount actually paid. Always known for a recorded payment. */
  readonly amount: Money;
  readonly description: string | null;
  /** Matched BankScheduleRow.rowId. null = not matched (yet). */
  readonly matchedScheduleRowId: string | null;
  readonly matchConfidence: MatchConfidence;
}
