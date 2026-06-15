/**
 * Loan Audit PRO — src/domain/scheduleTypes.ts
 * ------------------------------------------------------------------
 * Bank/fund schedule rows (as provided) and our recalculated rows.
 *
 * The two are deliberately SEPARATE types and are never merged:
 * bank data is evidence, our recalculation is an independent
 * computation; they only meet in the comparison engine (later step).
 *
 * Null-vs-zero: every numeric bank field allows null. null = the
 * statement did not provide the value; 0 = the statement explicitly
 * says zero.
 */

import type { ISODate } from './dateTypes';
import type { Money, NullableMoney } from './money';

export type PaymentStatus = 'paid' | 'partial' | 'unpaid' | 'unknown';

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'paid',
  'partial',
  'unpaid',
  'unknown',
] as const;

/** Confidence of the data extraction for a source row. */
export type SourceConfidence = 'verbatim' | 'manual_entry' | 'parsed' | 'low';

/** Μία γραμμή δοσολογίου τράπεζας / fund, όπως δόθηκε. */
export interface BankScheduleRow {
  readonly rowId: string;
  readonly dueDate: ISODate;
  readonly installmentAmount: NullableMoney;
  readonly principalPortion: NullableMoney;
  readonly interestPortion: NullableMoney;
  /** Έξοδα / ασφάλιστρα. */
  readonly feesAndPremiums: NullableMoney;
  /** Υπόλοιπο κεφαλαίου μετά τη δόση. */
  readonly balanceAfter: NullableMoney;
  readonly paymentStatus: PaymentStatus;
  /** Original raw text of the row (paste/scan), kept for audit. */
  readonly rawText: string | null;
  /** Source page (statement / PDF page number). null = unknown. */
  readonly sourcePage: number | null;
  readonly sourceConfidence: SourceConfidence;
}

/**
 * Ανάλυση εφαρμοστέου επιτοκίου μίας περιόδου.
 * null components = not applicable or unknown (e.g. fixed-rate loans
 * have no index component; unknown Ν.128/75 has null law128Percent).
 */
export interface RateBreakdown {
  readonly indexPercent: number | null;
  readonly spreadPercent: number | null;
  readonly law128Percent: number | null;
  /** Total annual rate actually applied in our recalculation (%). */
  readonly totalPercent: number;
}

/** Reference to an assumption registered in the audit log. */
export type AssumptionRef = string;

/**
 * Μία γραμμή του ΔΙΚΟΥ ΜΑΣ επανυπολογισμού.
 * Produced by the amortization engine (later step). In our own
 * recalculation nothing is "missing", so fields are non-null Money.
 * Interest is always computed on openingBalance (outstanding
 * principal) — never only on a monthly principal installment.
 */
export interface RecalcRow {
  readonly rowId: string;
  readonly dueDate: ISODate;
  /** Υπόλοιπο κεφαλαίου στην έναρξη της περιόδου. */
  readonly openingBalance: Money;
  /** Συνολικό εφαρμοσθέν ετήσιο επιτόκιο (%). */
  readonly appliedAnnualRatePercent: number;
  readonly rateBreakdown: RateBreakdown;
  /** Ημέρες τοκισμού της περιόδου κατά τη σύμβαση ημερομέτρησης. */
  readonly dayCountDays: number;
  readonly interest: Money;
  readonly principal: Money;
  readonly installment: Money;
  readonly closingBalance: Money;
  /** Codes of assumptions that affected this row. */
  readonly assumptions: readonly AssumptionRef[];
}
