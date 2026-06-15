/**
 * Loan Audit PRO — src/domain/rateTypes.ts
 * ------------------------------------------------------------------
 * Interest-rate regimes, Ν.128/75 contribution status, negative
 * Euribor policy and historical rate periods.
 *
 * Percent values are plain JS numbers (e.g. 2.5 = 2.50%): rates are
 * not money and are not stored as cents. Money stays integer cents.
 *
 * 'unknown' states are first-class values. Later engines MUST emit
 * an AuditEntry (warning / requires_review) when they encounter
 * Law128Status 'unknown', NegativeEuriborPolicy 'unknown' or
 * DayCountConvention 'unknown'. No silent defaults.
 */

import type { ISODate } from './dateTypes';

/** Floating-rate reference index. */
export type FloatingIndexType =
  | 'EURIBOR_1M'
  | 'EURIBOR_3M'
  | 'EURIBOR_6M'
  | 'EURIBOR_12M'
  | 'ECB'
  | 'other';

export const FLOATING_INDEX_TYPES: readonly FloatingIndexType[] = [
  'EURIBOR_1M',
  'EURIBOR_3M',
  'EURIBOR_6M',
  'EURIBOR_12M',
  'ECB',
  'other',
] as const;

/**
 * How a zero/negative index value is treated.
 *   as_is      -> negative index reduces the total rate
 *   floor_zero -> index floored at 0 before adding the spread
 *   unknown    -> contract term unclear; engines must compute BOTH
 *                 scenarios and flag «Απαιτείται έλεγχος».
 */
export type NegativeEuriborPolicy = 'as_is' | 'floor_zero' | 'unknown';

export const NEGATIVE_EURIBOR_POLICIES: readonly NegativeEuriborPolicy[] = [
  'as_is',
  'floor_zero',
  'unknown',
] as const;

export function isNegativeEuriborPolicy(value: unknown): value is NegativeEuriborPolicy {
  return (
    typeof value === 'string' &&
    (NEGATIVE_EURIBOR_POLICIES as readonly string[]).includes(value)
  );
}

/**
 * Καθεστώς εισφοράς Ν.128/75.
 *   included_in_rate -> ήδη ενσωματωμένη στο συμβατικό επιτόκιο
 *   added_separately -> προστίθεται χωριστά (ratePercent, e.g. 0.60 / 0.12)
 *   unknown          -> MUST raise an audit warning in later engines
 *                       («Απαιτείται έλεγχος καθεστώτος Ν.128/75»).
 */
export type Law128Status =
  | { readonly kind: 'included_in_rate'; readonly ratePercent: number | null }
  | { readonly kind: 'added_separately'; readonly ratePercent: number }
  | { readonly kind: 'unknown' };

export type Law128Kind = Law128Status['kind'];

export const LAW128_KINDS: readonly Law128Kind[] = [
  'included_in_rate',
  'added_separately',
  'unknown',
] as const;

export function isLaw128Kind(value: unknown): value is Law128Kind {
  return (
    typeof value === 'string' &&
    (LAW128_KINDS as readonly string[]).includes(value)
  );
}

/**
 * One historical rate period. Either the index value, or the total
 * applied rate (as reported by the bank), or both, may be known.
 * Missing numeric values are null — never silently 0.
 */
export interface RatePeriod {
  readonly from: ISODate;
  readonly to: ISODate;
  /** Index (e.g. Euribor) value in percent; may be negative. null = unknown. */
  readonly indexValuePercent: number | null;
  /** Total applied rate reported by the bank/fund. null = unknown. */
  readonly totalAppliedRatePercent: number | null;
  readonly source: RatePeriodSource;
}

export type RatePeriodSource =
  | 'contract'
  | 'bank_statement'
  | 'public_index'
  | 'user_input';

/** Interest-rate regime (discriminated union). */
export type RateRegime =
  | {
      readonly kind: 'fixed';
      /** Συμβατικό σταθερό ετήσιο επιτόκιο (%). */
      readonly annualRatePercent: number;
    }
  | {
      readonly kind: 'floating';
      readonly indexType: FloatingIndexType;
      /** Free-text label when indexType = 'other'. */
      readonly indexLabel: string | null;
      /** Περιθώριο (spread) σε %. */
      readonly spreadPercent: number;
      /**
       * Κανόνας ημερομηνίας αναφοράς, e.g.
       * «2 εργάσιμες πριν την έναρξη της περιόδου». null = unknown.
       */
      readonly referenceDateRule: string | null;
      /** Reset frequency in months. null = unknown. */
      readonly resetFrequencyMonths: number | null;
      readonly negativeEuriborPolicy: NegativeEuriborPolicy;
      /** Ιστορικό επιτοκίων ανά περίοδο, όταν υπάρχει. */
      readonly rateHistory: readonly RatePeriod[];
    };

export type RateRegimeKind = RateRegime['kind'];

export const RATE_REGIME_KINDS: readonly RateRegimeKind[] = ['fixed', 'floating'] as const;

export function isRateRegimeKind(value: unknown): value is RateRegimeKind {
  return (
    typeof value === 'string' &&
    (RATE_REGIME_KINDS as readonly string[]).includes(value)
  );
}

import type { DayCountConvention } from './dateTypes';

/** Complete rate configuration of a case. */
export interface RateConfig {
  readonly regime: RateRegime;
  readonly law128: Law128Status;
  readonly dayCount: DayCountConvention;
}
