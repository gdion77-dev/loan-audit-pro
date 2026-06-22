/**
 * Loan Audit PRO — src/ui-state/loanAuditDraftState.ts
 * ------------------------------------------------------------------
 * Lightweight, type-safe DRAFT state for the main form sections.
 * This is a skeleton, NOT the final form: each section holds a few
 * representative fields as FieldState so the three-state discipline
 * (value / explicit_zero / unknown) is enforced from the start.
 *
 * No engine imports, no calculation, no pipeline call. Amounts are
 * held as draft numbers (euro cents where numeric) only to exercise
 * the field model; conversion to the locked domain types happens in
 * a later wiring step.
 */

import {
  fieldUnknown,
  fieldValue,
  type FieldState,
} from './fieldState';

/* ------------------------------------------------------------------ */
/* Per-section drafts                                                  */
/* ------------------------------------------------------------------ */

export interface CaseInfoDraft {
  readonly debtorName: FieldState<string>;
  readonly contractNumber: FieldState<string>;
  readonly institution: FieldState<string>;
  readonly servicer: FieldState<string>;
}

export interface LoanTermsDraft {
  readonly principalCents: FieldState<number>;
  readonly termMonths: FieldState<number>;
  readonly startDate: FieldState<string>;
  readonly endDate: FieldState<string>;
}

export interface RateConfigDraft {
  /** e.g. 'fixed' | 'floating' — kept as draft string at this stage. */
  readonly regimeKind: FieldState<string>;
  readonly annualRatePercent: FieldState<number>;
  readonly spreadPercent: FieldState<number>;
  readonly law128Status: FieldState<string>;
  /** Ν.128/75 levy percent, used when status is 'added_separately'. */
  readonly law128Percent: FieldState<number>;
  /**
   * Surcharge in percentage points added to the contractual rate to
   * obtain the late-payment interest rate (τόκος υπερημερίας). NOT
   * hard-coded anywhere as 2.5 — that figure is only the regulatory
   * ceiling (ΠΔ/ΤΕ 2393/96), not a default. 'unknown' → no late
   * interest is computed anywhere in the audit.
   */
  readonly lateInterestSurchargePercent: FieldState<number>;
  /**
   * Whether the case has an explicit, lawful contractual basis for
   * semi-annual capitalization of unpaid late interest into
   * principal (Ν.2601/1998 άρθρο 12). 'yes' | 'no'; default/unknown
   * behaves as 'no' (capitalization never runs without an explicit
   * 'yes' — ΑΚ 296).
   */
  readonly capitalizeLateInterestSemiAnnually: FieldState<string>;
  /**
   * Floating-rate fields (used only when regimeKind = 'floating').
   * --------------------------------------------------------------
   * floatingIndexType: which reference index (EURIBOR_1M/3M/6M/12M,
   *   ECB, other). Maps to the domain FloatingIndexType.
   * rateSourceRule: how the index value for each period is selected.
   *   DEFAULT = 'CONTRACT_DEFINED' (audit-safe). Other values are
   *   explicit specializations or a manual override.
   * businessDaysBeforeReset: N business days before the period start
   *   (used only when rateSourceRule = 'BUSINESS_DAYS_BEFORE_RESET').
   * Negative-index handling is locked to floor-at-zero in the adapter
   *   (no UI field): a negative index is always treated as 0.
   */
  readonly floatingIndexType: FieldState<string>;
  readonly rateSourceRule: FieldState<string>;
  readonly businessDaysBeforeReset: FieldState<number>;
  /**
   * Index observations LOCKED into the case (reviewed & confirmed by the
   * user). These are plain input data, not editable form fields. When
   * present they feed the floating rateHistory deterministically, giving
   * the study a stable, traceable record of which values were used —
   * independent of any later change to the live ECB series.
   * Empty array = nothing locked yet.
   */
  readonly floatingRateObservations: readonly FloatingRateObservation[];
  /** Provenance of the locked observations (for the report). */
  readonly floatingRateLock: FloatingRateLockMeta | null;
}

/** A single locked index observation: ISO date + value in percent. */
export interface FloatingRateObservation {
  readonly date: string;
  readonly valuePercent: number;
}

/** Metadata describing how/when the observations were locked. */
export interface FloatingRateLockMeta {
  readonly source: 'ecb_api' | 'manual';
  readonly indexCode: string;
  /** ISO timestamp when the lock was performed. */
  readonly lockedAt: string;
  /** ISO date of the last published observation in the locked set. */
  readonly lastPublishedDate: string | null;
}

export interface BankScheduleDraftRow {
  readonly rowId: FieldState<string>;
  readonly dueDate: FieldState<string>;
  readonly installmentCents: FieldState<number>;
  readonly principalCents: FieldState<number>;
  readonly interestCents: FieldState<number>;
  readonly balanceCents: FieldState<number>;
  readonly note: FieldState<string>;
}

export interface BankScheduleDraft {
  readonly rows: readonly BankScheduleDraftRow[];
  readonly dayCountConvention: FieldState<string>;
  readonly sourceNote: FieldState<string>;
}

export interface ActualPaymentDraftRow {
  readonly paymentId: FieldState<string>;
  readonly paymentDate: FieldState<string>;
  readonly amountCents: FieldState<number>;
  readonly matchedScheduleRowId: FieldState<string>;
  readonly note: FieldState<string>;
}

export interface ActualPaymentsDraft {
  readonly rows: readonly ActualPaymentDraftRow[];
  readonly sourceNote: FieldState<string>;
}

/** One extra non-amortising charge (insurance, legal, etc.) on a date. */
export interface ExtraChargeDraftRow {
  readonly chargeId: FieldState<string>;
  readonly chargeDate: FieldState<string>;
  readonly amountCents: FieldState<number>;
  /** Free-text label: ασφάλιστρα, νομικά, έξοδα, etc. */
  readonly description: FieldState<string>;
}

export interface ExtraChargesDraft {
  readonly rows: readonly ExtraChargeDraftRow[];
  /**
   * Whether unpaid extra charges accrue default interest like principal.
   * 'yes' (default) = charges accrue; 'no' = conservative (owed but
   * interest-free). Stored as a draft string for the select control.
   */
  readonly accrueInterestOnCharges: FieldState<string>;
}

export interface RecalculationSettingsDraft {
  /** 'equal_principal' | 'equal_installment' — draft string for now. */
  readonly scheduleMode: FieldState<string>;
  readonly roundingMode: FieldState<string>;
  readonly feesAndPremiumsPerPeriodCents: FieldState<number>;
  /** Reset frequency for the re-amortizing schedule mode. */
  readonly installmentResetFrequency: FieldState<string>;
  /** Residual lump sum paid with the final installment (balloon mode). */
  readonly balloonAmountCents: FieldState<number>;
}

/* ------------------------------------------------------------------ */
/* Aggregate draft state                                               */
/* ------------------------------------------------------------------ */

export interface ReportNotesDraft {
  /** Free-text economic observations written by the analyst (printed in the report). */
  readonly analystNotes: FieldState<string>;
}

export interface LoanAuditDraftState {
  readonly caseInfoDraft: CaseInfoDraft;
  readonly loanTermsDraft: LoanTermsDraft;
  readonly rateConfigDraft: RateConfigDraft;
  readonly bankScheduleDraft: BankScheduleDraft;
  readonly actualPaymentsDraft: ActualPaymentsDraft;
  readonly recalculationSettingsDraft: RecalculationSettingsDraft;
  readonly reportNotesDraft: ReportNotesDraft;
  readonly extraChargesDraft: ExtraChargesDraft;
}

/**
 * Fresh draft state: every field starts UNKNOWN (value null) — never
 * zero. This is the safe initial condition before any user input or
 * import; explicit zeros only ever arise from deliberate entry.
 */
export function createEmptyDraftState(): LoanAuditDraftState {
  return {
    caseInfoDraft: {
      debtorName: fieldUnknown<string>('manual'),
      contractNumber: fieldUnknown<string>('manual'),
      institution: fieldUnknown<string>('manual'),
      servicer: fieldUnknown<string>('manual'),
    },
    loanTermsDraft: {
      principalCents: fieldUnknown<number>('manual'),
      termMonths: fieldUnknown<number>('manual'),
      startDate: fieldUnknown<string>('manual'),
      endDate: fieldUnknown<string>('manual'),
    },
    rateConfigDraft: {
      regimeKind: fieldUnknown<string>('manual'),
      annualRatePercent: fieldUnknown<number>('manual'),
      spreadPercent: fieldUnknown<number>('manual'),
      law128Status: fieldUnknown<string>('manual'),
      law128Percent: fieldUnknown<number>('manual'),
      lateInterestSurchargePercent: fieldUnknown<number>('manual'),
      capitalizeLateInterestSemiAnnually: fieldUnknown<string>('manual'),
      floatingIndexType: fieldUnknown<string>('manual'),
      rateSourceRule: fieldUnknown<string>('manual'),
      businessDaysBeforeReset: fieldUnknown<number>('manual'),
      floatingRateObservations: [],
      floatingRateLock: null,
    },
    bankScheduleDraft: {
      rows: [],
      dayCountConvention: fieldUnknown<string>('manual'),
      sourceNote: fieldUnknown<string>('manual'),
    },
    actualPaymentsDraft: {
      rows: [],
      sourceNote: fieldUnknown<string>('manual'),
    },
    recalculationSettingsDraft: {
      scheduleMode: fieldUnknown<string>('manual'),
      roundingMode: fieldUnknown<string>('manual'),
      feesAndPremiumsPerPeriodCents: fieldUnknown<number>('manual'),
      installmentResetFrequency: fieldUnknown<string>('manual'),
      balloonAmountCents: fieldUnknown<number>('manual'),
    },
    reportNotesDraft: {
      analystNotes: fieldUnknown<string>('manual'),
    },
    extraChargesDraft: {
      rows: [],
      accrueInterestOnCharges: fieldValue<string>('yes', 'manual'),
    },
  };
}

/** A fresh extra-charge draft row: chargeId concrete, others unknown. */
export function createEmptyExtraChargeDraftRow(chargeId: string): ExtraChargeDraftRow {
  return {
    chargeId: fieldValue<string>(chargeId, 'manual'),
    chargeDate: fieldUnknown<string>('manual'),
    amountCents: fieldUnknown<number>('manual'),
    description: fieldUnknown<string>('manual'),
  };
}

/**
 * A fresh bank schedule draft row: rowId is a concrete generated
 * value (so rows are addressable), every economic field starts
 * UNKNOWN — never zero.
 */
export function createEmptyBankScheduleDraftRow(rowId: string): BankScheduleDraftRow {
  return {
    rowId: fieldValue<string>(rowId, 'manual'),
    dueDate: fieldUnknown<string>('manual'),
    installmentCents: fieldUnknown<number>('manual'),
    principalCents: fieldUnknown<number>('manual'),
    interestCents: fieldUnknown<number>('manual'),
    balanceCents: fieldUnknown<number>('manual'),
    note: fieldUnknown<string>('manual'),
  };
}

/**
 * A fresh actual payment draft row: paymentId is a concrete generated
 * value (so rows are addressable), every other field starts UNKNOWN —
 * the amount is never zero by default.
 */
export function createEmptyActualPaymentDraftRow(paymentId: string): ActualPaymentDraftRow {
  return {
    paymentId: fieldValue<string>(paymentId, 'manual'),
    paymentDate: fieldUnknown<string>('manual'),
    amountCents: fieldUnknown<number>('manual'),
    matchedScheduleRowId: fieldUnknown<string>('manual'),
    note: fieldUnknown<string>('manual'),
  };
}

/** Section keys, handy for iteration in tests and future wiring. */
export const DRAFT_SECTION_KEYS = [
  'caseInfoDraft',
  'loanTermsDraft',
  'rateConfigDraft',
  'bankScheduleDraft',
  'actualPaymentsDraft',
  'recalculationSettingsDraft',
] as const satisfies readonly (keyof LoanAuditDraftState)[];

/* ------------------------------------------------------------------ */
/* Select option metadata (UI labels ↔ stable codes)                   */
/* ------------------------------------------------------------------ */

export interface DraftSelectOption {
  readonly code: string;
  readonly label: string;
  readonly unknown?: boolean;
}

/** Καθεστώς επιτοκίου. */
export const REGIME_KIND_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'fixed', label: 'Σταθερό' },
  { code: 'floating', label: 'Κυμαινόμενο' },
  { code: 'unknown', label: 'Άγνωστο', unknown: true },
] as const;

/** Καθεστώς εισφοράς Ν.128/75. */
export const LAW128_STATUS_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'included_in_rate', label: 'Περιλαμβάνεται στο επιτόκιο' },
  { code: 'added_separately', label: 'Προστίθεται χωριστά' },
  { code: 'unknown', label: 'Άγνωστο / απαιτείται έλεγχος', unknown: true },
] as const;

/** Εξαμηνιαία κεφαλαιοποίηση τόκου υπερημερίας — μόνο αν προβλέπεται ρητά στη σύμβαση. */
export const CAPITALIZE_LATE_INTEREST_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'no', label: 'Όχι — δεν προβλέπεται ρητά στη σύμβαση' },
  { code: 'yes', label: 'Ναι — προβλέπεται ρητά στη σύμβαση (Ν.2601/1998 άρθρο 12)' },
  { code: 'unknown', label: 'Άγνωστο / απαιτείται έλεγχος', unknown: true },
] as const;

/** Είδος δείκτη κυμαινόμενου επιτοκίου. Codes match domain FloatingIndexType. */
export const FLOATING_INDEX_TYPE_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'EURIBOR_1M', label: 'Euribor 1 μηνός' },
  { code: 'EURIBOR_3M', label: 'Euribor 3 μηνών' },
  { code: 'EURIBOR_6M', label: 'Euribor 6 μηνών' },
  { code: 'EURIBOR_12M', label: 'Euribor 12 μηνών' },
  { code: 'ECB', label: 'Επιτόκιο ΕΚΤ (πράξεις κύριας αναχρηματοδότησης)' },
  { code: 'other', label: 'Άλλος δείκτης' },
  { code: 'unknown', label: 'Άγνωστο / απαιτείται έλεγχος', unknown: true },
] as const;

/**
 * Κανόνας επιλογής τιμής δείκτη ανά περίοδο εκτοκισμού.
 * DEFAULT (audit-safe) = 'CONTRACT_DEFINED'. Η «μέση μηνιαία τιμή»
 * δεν είναι default — μόνο τεχνική εκτίμηση με ρητή ένδειξη.
 */
export const RATE_SOURCE_RULE_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'CONTRACT_DEFINED', label: 'Όπως ορίζει η σύμβαση (προεπιλογή)' },
  { code: 'RESET_DATE_VALUE', label: 'Τιμή ημέρας αναπροσαρμογής (reset)' },
  { code: 'BUSINESS_DAYS_BEFORE_RESET', label: 'Ν εργάσιμες πριν την έναρξη περιόδου' },
  { code: 'MONTHLY_AVERAGE', label: 'Μέση μηνιαία τιμή (τεχνική εκτίμηση — όχι ακριβής αναπαραγωγή)' },
  { code: 'MANUAL_RATE', label: 'Χειροκίνητη καταχώρηση τιμών' },
  { code: 'unknown', label: 'Άγνωστο / απαιτείται έλεγχος', unknown: true },
] as const;
export const SCHEDULE_MODE_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'equal_installment', label: 'Σταθερή τοκοχρεολυτική δόση (σταθερό επιτόκιο)' },
  { code: 'reamortizing', label: 'Κυμαινόμενη τοκοχρεολυτική δόση (αναπροσαρμοζόμενη)' },
  { code: 'equal_principal', label: 'Ίση δόση κεφαλαίου (σταθερό χρεολύσιο)' },
  { code: 'balloon', label: 'Δόση με υπόλοιπο (balloon)' },
  { code: 'unknown', label: 'Άγνωστο', unknown: true },
] as const;

/** Συχνότητα αναπροσαρμογής δόσης (re-amortizing). */
export const INSTALLMENT_RESET_FREQUENCY_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'monthly', label: 'Μηνιαία (κάθε μήνα)' },
  { code: 'quarterly', label: 'Τριμηνιαία (κάθε 3 μήνες)' },
  { code: 'semiannual', label: 'Εξαμηνιαία (κάθε 6 μήνες)' },
  { code: 'annual', label: 'Ετήσια (κάθε 12 μήνες)' },
  { code: 'unknown', label: 'Άγνωστο / απαιτείται έλεγχος', unknown: true },
] as const;

/** Πολιτική στρογγυλοποίησης. */
export const ROUNDING_MODE_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'half_up', label: 'Εμπορική στρογγυλοποίηση' },
  { code: 'floor', label: 'Προς τα κάτω' },
  { code: 'ceil', label: 'Προς τα πάνω' },
  { code: 'unknown', label: 'Άγνωστο', unknown: true },
] as const;

/**
 * Σύμβαση ημερομέτρησης (day-count). Codes match the locked
 * DayCountConvention type exactly (ACT_360 / ACT_365 / 30_360 /
 * 30E_360); the «Άγνωστο» option maps to FieldState unknown.
 */
export const DAY_COUNT_CONVENTION_OPTIONS: readonly DraftSelectOption[] = [
  { code: 'ACT_360', label: 'ACT/360' },
  { code: 'ACT_365', label: 'ACT/365 Fixed' },
  { code: '30_360', label: '30/360 US' },
  { code: '30E_360', label: '30E/360' },
  { code: 'unknown', label: 'Άγνωστο', unknown: true },
] as const;
