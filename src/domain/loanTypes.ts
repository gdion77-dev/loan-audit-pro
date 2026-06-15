/**
 * Loan Audit PRO — src/domain/loanTypes.ts
 * ------------------------------------------------------------------
 * Case information and loan / repayment structure types.
 *
 * Scope guard:
 *   - This app is NOT about Ν.3869/2010.
 *   - This app is NOT about ΑΠ 6/2026 and copies none of that logic.
 *   - Interest in later engines is computed on the OUTSTANDING
 *     PRINCIPAL BALANCE with an explicit day-count convention —
 *     never only on a monthly principal installment.
 */

import type { ISODate } from './dateTypes';
import type { Money, CurrencyCode } from './money';

/** Στοιχεία υπόθεσης. Missing/unknown optional facts are null. */
export interface CaseInfo {
  readonly caseId: string;
  /** Ονοματεπώνυμο ή επωνυμία οφειλέτη. */
  readonly debtorName: string;
  /** Αριθμός σύμβασης. */
  readonly contractNumber: string;
  /** Τράπεζα / fund. */
  readonly institution: string;
  /** Servicer, if different from institution. null = not applicable / unknown. */
  readonly servicer: string | null;
  /** Ημερομηνία αρχικής σύμβασης. */
  readonly contractDate: ISODate;
  /** Ημερομηνία ρύθμισης. null = δεν υπάρχει ρύθμιση / άγνωστο. */
  readonly restructuringDate: ISODate | null;
  /** Αρχικό κεφάλαιο (ή κεφάλαιο ρύθμισης). */
  readonly principal: Money;
  readonly currency: CurrencyCode;
  readonly startDate: ISODate;
  readonly endDate: ISODate;
  readonly termMonths: number;
  readonly notes: string | null;
}

/** Supported loan / repayment types (discriminant values). */
export type LoanTypeKind =
  | 'amortizing_equal_installment' // τοκοχρεολυτικό, σταθερή δόση
  | 'equal_principal' // ίση δόση κεφαλαίου
  | 'interest_only' // περίοδος μόνο τόκων, μετά άλλος τύπος
  | 'balloon' // τελική μεγάλη δόση
  | 'custom_bank_schedule'; // δοσολόγιο τράπεζας ως δεδομένο

export const LOAN_TYPE_KINDS: readonly LoanTypeKind[] = [
  'amortizing_equal_installment',
  'equal_principal',
  'interest_only',
  'balloon',
  'custom_bank_schedule',
] as const;

export function isLoanTypeKind(value: unknown): value is LoanTypeKind {
  return (
    typeof value === 'string' &&
    (LOAN_TYPE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Structured (discriminated-union) description of the repayment type,
 * carrying the parameters each type needs. Types only — the
 * amortization engine that consumes this is a later step.
 */
export type LoanStructure =
  | { readonly kind: 'amortizing_equal_installment' }
  | { readonly kind: 'equal_principal' }
  | {
      readonly kind: 'interest_only';
      /** Number of interest-only months at the start. */
      readonly interestOnlyMonths: number;
      /** Repayment type after the interest-only period. */
      readonly thereafter: Exclude<LoanTypeKind, 'interest_only'>;
    }
  | {
      readonly kind: 'balloon';
      /** Τελική μεγάλη δόση. null = declared but amount unknown. */
      readonly balloonAmount: Money | null;
    }
  | { readonly kind: 'custom_bank_schedule' };

export type PaymentFrequencyUnit = 'month' | 'quarter' | 'semester';

export interface PaymentFrequency {
  readonly unit: PaymentFrequencyUnit;
  /** Day of month installments fall due. null = unknown. */
  readonly dayOfMonth: number | null;
}
