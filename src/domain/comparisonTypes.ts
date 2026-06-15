/**
 * Loan Audit PRO — src/domain/comparisonTypes.ts
 * ------------------------------------------------------------------
 * Per-period comparison between bank/fund data and our independent
 * recalculation. Types only; the comparison engine is a later step.
 *
 * Sign convention for differences (documented once, used everywhere):
 *   economicDifference = bank value − recalculated value
 *   > 0 : bank figure higher than our recalculation
 *   = 0 : agreement
 *   < 0 : bank figure lower than our recalculation
 * The difference is a neutral «οικονομική διαφορά» — it carries no
 * legal characterization.
 */

import type { ISODate } from './dateTypes';
import type { NullableMoney } from './money';

/**
 * Severity of a per-row comparison outcome.
 *   none            -> agreement (within rounding threshold)
 *   rounding        -> difference below materiality threshold
 *   deviation       -> οικονομική απόκλιση άνω κατωφλίου
 *   missing_data    -> ελλιπή δεδομένα, row excluded from totals
 *   requires_review -> απαιτείται χειροκίνητος έλεγχος
 */
export type FindingLevel =
  | 'none'
  | 'rounding'
  | 'deviation'
  | 'missing_data'
  | 'requires_review';

export const FINDING_LEVELS: readonly FindingLevel[] = [
  'none',
  'rounding',
  'deviation',
  'missing_data',
  'requires_review',
] as const;

export function isFindingLevel(value: unknown): value is FindingLevel {
  return (
    typeof value === 'string' &&
    (FINDING_LEVELS as readonly string[]).includes(value)
  );
}

/** Σύγκριση ανά περίοδο (μήνα/δόση). */
export interface ComparisonRow {
  /** 1-based period number. */
  readonly period: number;
  readonly dueDate: ISODate;

  /** Bank/fund figures — null when missing in the source. */
  readonly bankInstallment: NullableMoney;
  readonly bankPrincipal: NullableMoney;
  readonly bankInterest: NullableMoney;
  readonly bankBalance: NullableMoney;

  /**
   * Our recalculated figures. Nullable because a period may exist on
   * one side only (unaligned rows) — null then means "no recalculated
   * row for this period", never zero.
   */
  readonly recalculatedInstallment: NullableMoney;
  readonly recalculatedPrincipal: NullableMoney;
  readonly recalculatedInterest: NullableMoney;
  readonly recalculatedBalance: NullableMoney;

  /** Πραγματικά καταβληθέν στην περίοδο. null = no recorded payment data. */
  readonly actualPaid: NullableMoney;

  /**
   * Οικονομική διαφορά της περιόδου (bank − recalculated, in cents;
   * may be positive, zero or negative). null when either side is
   * missing — a missing side never produces a fake difference.
   */
  readonly economicDifference: NullableMoney;

  readonly findingLevel: FindingLevel;
  /** Ουδέτερη τεχνική παρατήρηση. null = none. */
  readonly notes: string | null;
}
