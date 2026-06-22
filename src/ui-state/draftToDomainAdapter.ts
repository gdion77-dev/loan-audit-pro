/**
 * Loan Audit PRO — src/ui-state/draftToDomainAdapter.ts
 * ------------------------------------------------------------------
 * Translates the UI LoanAuditDraftState into domain-ready structures
 * WITHOUT silent assumptions. The cardinal rule of the whole project
 * holds here too: unknown NEVER becomes 0, invalid input NEVER
 * becomes 0; an explicit_zero becomes 0 only where the domain field
 * legitimately allows a zero. Missing critical inputs are recorded
 * as missingData (they block readiness); softer gaps become warnings
 * (they require review). Rows are never dropped silently — an empty
 * row is excluded with an info/warning that preserves its rowId.
 *
 * This module performs NO calculation: it does not call any engine,
 * the pipeline runner, the reconciliation engine or any renderer. It
 * only shapes data and reports gaps.
 */

import {
  isValue,
  isExplicitZero,
  type FieldState,
} from './fieldState';
import type {
  LoanAuditDraftState,
  BankScheduleDraftRow,
  ActualPaymentDraftRow,
} from './loanAuditDraftState';
import { moneyFromCents, type Money, type NullableMoney, type CurrencyCode } from '../domain/money';
import { isValidISODate, isDayCountConvention, type ISODate, type DayCountConvention } from '../domain/dateTypes';
import type { CaseInfo } from '../domain/loanTypes';
import type { RateConfig, RateRegime, Law128Status, FloatingIndexType } from '../domain/rateTypes';
import { isFloatingIndexType } from '../domain/rateTypes';
import { buildContinuousRateHistory, type RateSourceRule } from './floatingRateResolver';
import type { BankScheduleRow } from '../domain/scheduleTypes';
import type { ActualPayment } from '../domain/paymentTypes';

/* ------------------------------------------------------------------ */
/* Issue + result types                                                */
/* ------------------------------------------------------------------ */

export type DraftStatus = 'ready' | 'requires_review' | 'missing_data';

export type DraftIssueLevel = 'info' | 'warning' | 'requires_review' | 'missing_data';

export interface DraftIssue {
  readonly level: DraftIssueLevel;
  readonly section: string;
  readonly fieldLabel: string;
  readonly message: string;
  readonly rowId?: string;
  readonly source: 'draft';
}

/** Prepared (not yet validated by engines) loan-terms object. */
export interface PreparedLoanTerms {
  readonly principalCents: number;
  readonly termMonths: number;
  readonly startDate: ISODate;
  readonly endDate: ISODate;
}

/** Prepared recalculation settings object. */
export interface PreparedRecalculationSettings {
  readonly scheduleMode: 'equal_principal' | 'equal_installment' | 'reamortizing' | 'balloon';
  readonly roundingMode: string | null;
  readonly feesAndPremiumsPerPeriodCents: number | null;
  /** Months between installment recomputations (re-amortizing mode). */
  readonly resetFrequencyMonths: number | null;
  /** Residual lump sum paid with the final installment (balloon mode). */
  readonly balloonAmountCents: number | null;
}

/** One prepared extra charge (date + amount + label). */
export interface PreparedExtraCharge {
  readonly dateISO: string;
  readonly amountCents: number;
  readonly description: string | null;
}

export interface DraftToDomainResult {
  readonly status: DraftStatus;
  readonly caseInfo: CaseInfo | null;
  readonly loanTerms: PreparedLoanTerms | null;
  readonly rateConfig: RateConfig | null;
  readonly bankRows: readonly BankScheduleRow[];
  readonly actualPayments: readonly ActualPayment[];
  readonly recalculationSettings: PreparedRecalculationSettings | null;
  /** Extra non-amortising charges (insurance/legal) by date. */
  readonly extraCharges: readonly PreparedExtraCharge[];
  /** Whether unpaid extra charges accrue default interest (default true). */
  readonly accrueInterestOnExtraCharges: boolean;
  readonly missingData: readonly DraftIssue[];
  readonly warnings: readonly DraftIssue[];
  /**
   * Floating-rate provenance for the report (present only when a
   * floating rateHistory was resolved from locked observations).
   */
  readonly floatingRateProjection: FloatingRateProjectionInfo | null;
}

export interface FloatingRateProjectionInfo {
  readonly indexType: string;
  readonly sourceRule: string | null;
  readonly negativeIndexPolicy: 'floor_zero';
  readonly projectedCount: number;
  readonly lastPublishedDate: string | null;
  readonly lastPublishedValuePercent: number | null;
}

/* ------------------------------------------------------------------ */
/* Small field readers (no silent zero)                                */
/* ------------------------------------------------------------------ */

/** A string value if present, else null (unknown stays null). */
function readString(field: FieldState<string>): string | null {
  return isValue(field) ? field.value : null;
}

/** A number value, treating explicit_zero as a real 0; unknown → null. */
function readNumber(field: FieldState<number>): number | null {
  if (isExplicitZero(field)) return 0;
  if (isValue(field)) return field.value;
  return null; // unknown / invalid — never coerced to 0
}

/** Money in cents → NullableMoney; unknown → null, explicit_zero → 0. */
function readMoney(field: FieldState<number>, currency: CurrencyCode): NullableMoney {
  const cents = readNumber(field);
  return cents === null ? null : moneyFromCents(cents, currency);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function adaptDraftToDomain(
  draft: LoanAuditDraftState,
  options?: { readonly currency?: CurrencyCode; readonly caseId?: string },
): DraftToDomainResult {
  const currency: CurrencyCode = options?.currency ?? 'EUR';
  const missingData: DraftIssue[] = [];
  const warnings: DraftIssue[] = [];

  const miss = (section: string, fieldLabel: string, message: string, rowId?: string): void => {
    missingData.push({ level: 'missing_data', section, fieldLabel, message, source: 'draft', ...(rowId !== undefined ? { rowId } : {}) });
  };
  const review = (section: string, fieldLabel: string, message: string, rowId?: string): void => {
    warnings.push({ level: 'requires_review', section, fieldLabel, message, source: 'draft', ...(rowId !== undefined ? { rowId } : {}) });
  };
  const warn = (section: string, fieldLabel: string, message: string, rowId?: string): void => {
    warnings.push({ level: 'warning', section, fieldLabel, message, source: 'draft', ...(rowId !== undefined ? { rowId } : {}) });
  };
  const note = (section: string, fieldLabel: string, message: string, rowId?: string): void => {
    warnings.push({ level: 'info', section, fieldLabel, message, source: 'draft', ...(rowId !== undefined ? { rowId } : {}) });
  };

  /* --- case info -------------------------------------------------------- */
  const ci = draft.caseInfoDraft;
  const debtorName = readString(ci.debtorName);
  const contractNumber = readString(ci.contractNumber);
  const institution = readString(ci.institution);
  const servicer = readString(ci.servicer);
  if (debtorName === null) miss('case_info', 'Οφειλέτης', 'Ελλείπει το όνομα του οφειλέτη.');
  if (contractNumber === null) miss('case_info', 'Αριθμός σύμβασης', 'Ελλείπει ο αριθμός σύμβασης.');
  if (institution === null) miss('case_info', 'Τράπεζα / Fund', 'Ελλείπει η τράπεζα / fund.');

  /* --- loan terms ------------------------------------------------------- */
  const lt = draft.loanTermsDraft;
  const principalCents = readNumber(lt.principalCents);
  const termMonths = readNumber(lt.termMonths);
  const startDateRaw = readString(lt.startDate);
  const endDateRaw = readString(lt.endDate);
  if (principalCents === null) miss('loan_terms', 'Κεφάλαιο αναφοράς', 'Ελλείπει το κεφάλαιο αναφοράς· δεν τεκμαίρεται μηδενικό.');
  if (termMonths === null) miss('loan_terms', 'Διάρκεια (μήνες)', 'Ελλείπει η διάρκεια σε μήνες.');
  const startDate = startDateRaw !== null && isValidISODate(startDateRaw) ? startDateRaw : null;
  const endDate = endDateRaw !== null && isValidISODate(endDateRaw) ? endDateRaw : null;
  if (startDateRaw === null) miss('loan_terms', 'Ημερομηνία έναρξης', 'Ελλείπει η ημερομηνία έναρξης.');
  else if (startDate === null) review('loan_terms', 'Ημερομηνία έναρξης', 'Μη έγκυρη ημερομηνία έναρξης (αναμένεται ΕΕΕΕ-ΜΜ-ΗΗ)· απαιτείται έλεγχος.');
  if (endDateRaw === null) miss('loan_terms', 'Ημερομηνία λήξης', 'Ελλείπει η ημερομηνία λήξης.');
  else if (endDate === null) review('loan_terms', 'Ημερομηνία λήξης', 'Μη έγκυρη ημερομηνία λήξης (αναμένεται ΕΕΕΕ-ΜΜ-ΗΗ)· απαιτείται έλεγχος.');

  const loanTerms: PreparedLoanTerms | null =
    principalCents !== null && termMonths !== null && startDate !== null && endDate !== null
      ? { principalCents, termMonths, startDate, endDate }
      : null;

  /* --- rate config ------------------------------------------------------ */
  const rc = draft.rateConfigDraft;
  const regimeKind = readString(rc.regimeKind);
  const annualRatePercent = readNumber(rc.annualRatePercent);
  const spreadPercent = readNumber(rc.spreadPercent);
  const law128Code = readString(rc.law128Status);
  const law128Percent = readNumber(rc.law128Percent);
  const floatingIndexCode = readString(rc.floatingIndexType);
  const rateSourceRule = readString(rc.rateSourceRule);
  const businessDaysBeforeReset = readNumber(rc.businessDaysBeforeReset);

  let regime: RateRegime | null = null;
  if (regimeKind === null) {
    miss('rate_config', 'Καθεστώς επιτοκίου', 'Ελλείπει το καθεστώς επιτοκίου.');
  } else if (regimeKind === 'fixed') {
    if (annualRatePercent === null) {
      miss('rate_config', 'Σταθερό ετήσιο επιτόκιο %', 'Σταθερό καθεστώς χωρίς ετήσιο επιτόκιο· δεν τεκμαίρεται τιμή.');
    } else {
      regime = { kind: 'fixed', annualRatePercent };
    }
  } else if (regimeKind === 'floating') {
    if (spreadPercent === null) {
      miss('rate_config', 'Περιθώριο %', 'Κυμαινόμενο καθεστώς χωρίς περιθώριο· δεν τεκμαίρεται τιμή.');
    } else {
      // Index type: use the selected value when valid; unknown/absent
      // falls back to 'other' and is flagged for review (never silently
      // assumed).
      let indexType: FloatingIndexType;
      if (isFloatingIndexType(floatingIndexCode)) {
        indexType = floatingIndexCode;
      } else {
        indexType = 'other';
        review('rate_config', 'Είδος δείκτη', 'Κυμαινόμενο καθεστώς χωρίς προσδιορισμένο είδος δείκτη· απαιτείται έλεγχος.');
      }

      // Rate-source rule → human-readable referenceDateRule recorded on
      // the regime (surfaced in the methodology/report). The audit-safe
      // default is CONTRACT_DEFINED.
      let referenceDateRule: string | null = null;
      if (rateSourceRule === null || rateSourceRule === 'unknown') {
        referenceDateRule = null;
        review('rate_config', 'Κανόνας πηγής επιτοκίου', 'Δεν έχει προσδιοριστεί ο κανόνας επιλογής τιμής δείκτη· απαιτείται έλεγχος (audit-safe προεπιλογή: όπως ορίζει η σύμβαση).');
      } else if (rateSourceRule === 'CONTRACT_DEFINED') {
        referenceDateRule = 'Όπως ορίζει η σύμβαση';
      } else if (rateSourceRule === 'RESET_DATE_VALUE') {
        referenceDateRule = 'Τιμή ημέρας αναπροσαρμογής (reset)';
      } else if (rateSourceRule === 'BUSINESS_DAYS_BEFORE_RESET') {
        if (businessDaysBeforeReset === null) {
          referenceDateRule = 'Εργάσιμες ημέρες πριν την έναρξη περιόδου';
          review('rate_config', 'Εργάσιμες ημέρες πριν την έναρξη περιόδου', 'Επιλέχθηκε «Ν εργάσιμες πριν» χωρίς αριθμό ημερών· καταχωρήστε τον αριθμό.');
        } else {
          referenceDateRule = `${businessDaysBeforeReset} εργάσιμες ημέρες πριν την έναρξη της περιόδου εκτοκισμού`;
        }
      } else if (rateSourceRule === 'MONTHLY_AVERAGE') {
        referenceDateRule = 'Μέση μηνιαία τιμή (τεχνική εκτίμηση)';
        review('rate_config', 'Κανόνας πηγής επιτοκίου', 'Η μέση μηνιαία τιμή είναι τεχνική εκτίμηση και δεν αναπαράγει κατ’ ανάγκη την τραπεζική καρτέλα· επισημαίνεται αναλόγως.');
      } else if (rateSourceRule === 'MANUAL_RATE') {
        referenceDateRule = 'Χειροκίνητη καταχώρηση τιμών δείκτη';
      } else {
        referenceDateRule = null;
        review('rate_config', 'Κανόνας πηγής επιτοκίου', 'Μη αναγνωρισμένος κανόνας πηγής επιτοκίου· απαιτείται έλεγχος.');
      }

      regime = {
        kind: 'floating',
        indexType,
        indexLabel: null,
        spreadPercent,
        referenceDateRule,
        resetFrequencyMonths: null,
        // Locked policy: a negative index is always treated as zero
        // (floor at 0) — the applied rate never drops below the spread.
        negativeEuriborPolicy: 'floor_zero',
        rateHistory: [],
      };
    }
  } else {
    review('rate_config', 'Καθεστώς επιτοκίου', 'Μη αναγνωρισμένο καθεστώς επιτοκίου· απαιτείται έλεγχος.');
  }

  let law128: Law128Status | null = null;
  if (law128Code === null || law128Code === 'unknown') {
    law128 = { kind: 'unknown' };
    review('rate_config', 'Καθεστώς εισφοράς Ν.128/75', 'Το καθεστώς της εισφοράς δεν έχει προσδιοριστεί· απαιτείται έλεγχος.');
  } else if (law128Code === 'included_in_rate') {
    law128 = { kind: 'included_in_rate', ratePercent: null };
  } else if (law128Code === 'added_separately') {
    // added_separately requires a numeric rate. When the user has entered
    // the levy percent, use it; otherwise flag for review (never default).
    if (law128Percent === null) {
      law128 = { kind: 'unknown' };
      review('rate_config', 'Εισφορά Ν.128/75 %', 'Χωριστή εισφορά χωρίς ποσοστό· καταχωρήστε το ποσοστό της εισφοράς.');
    } else {
      law128 = { kind: 'added_separately', ratePercent: law128Percent };
    }
  } else {
    law128 = { kind: 'unknown' };
    review('rate_config', 'Καθεστώς εισφοράς Ν.128/75', 'Μη αναγνωρισμένο καθεστώς εισφοράς· απαιτείται έλεγχος.');
  }

  // Day-count convention is held on the bank schedule draft. A valid
  // convention is required for a computable schedule; unknown/absent
  // blocks readiness (missing_data) — never silently defaulted.
  const dayCountRaw = readString(draft.bankScheduleDraft.dayCountConvention);
  let dayCountConvention: DayCountConvention = 'unknown';
  if (dayCountRaw === null) {
    miss('bank_schedule', 'Σύμβαση ημερομέτρησης', 'Ελλείπει η σύμβαση ημερομέτρησης (day-count)· απαιτείται για τον επανυπολογισμό.');
  } else if (isDayCountConvention(dayCountRaw)) {
    dayCountConvention = dayCountRaw;
  } else {
    review('bank_schedule', 'Σύμβαση ημερομέτρησης', 'Μη αναγνωρισμένη σύμβαση ημερομέτρησης· απαιτείται έλεγχος.');
  }

  let rateConfig: RateConfig | null =
    regime !== null && law128 !== null ? { regime, law128, dayCount: dayCountConvention } : null;
  let floatingRateProjection: FloatingRateProjectionInfo | null = null;

  /* --- bank schedule rows ----------------------------------------------- */
  const bankRows: BankScheduleRow[] = [];
  draft.bankScheduleDraft.rows.forEach((row: BankScheduleDraftRow, index) => {
    const rowId = isValue(row.rowId) ? row.rowId.value : `bank-${index}`;
    const dueDateRaw = readString(row.dueDate);
    const installment = readMoney(row.installmentCents, currency);
    const principal = readMoney(row.principalCents, currency);
    const interest = readMoney(row.interestCents, currency);
    const balance = readMoney(row.balanceCents, currency);
    const noteText = readString(row.note);

    const hasAnyAmount = installment !== null || principal !== null || interest !== null || balance !== null;

    if (dueDateRaw === null && !hasAnyAmount) {
      note('bank_schedule', 'Γραμμή δοσολογίου', 'Κενή γραμμή δοσολογίου· εξαιρέθηκε από τα δεδομένα.', rowId);
      return; // excluded, but explicitly reported (not silent)
    }
    if (dueDateRaw === null || !isValidISODate(dueDateRaw)) {
      review('bank_schedule', 'Ημερομηνία δόσης', 'Γραμμή δοσολογίου χωρίς έγκυρη ημερομηνία δόσης· απαιτείται έλεγχος.', rowId);
      return; // cannot build a row without a valid dueDate; context preserved
    }
    if (!hasAnyAmount) {
      warn('bank_schedule', 'Ποσά δόσης', 'Γραμμή δοσολογίου χωρίς διαθέσιμα ποσά· τα ποσά παραμένουν κενά.', rowId);
    }

    bankRows.push({
      rowId,
      dueDate: dueDateRaw,
      installmentAmount: installment,
      principalPortion: principal,
      interestPortion: interest,
      feesAndPremiums: null,
      balanceAfter: balance,
      paymentStatus: 'unknown',
      rawText: noteText,
      sourcePage: null,
      sourceConfidence: 'manual_entry',
    });
  });

  /* --- floating rateHistory from locked observations -------------------- */
  // When the regime is floating and the user has locked index values,
  // resolve a per-installment rateHistory using the contract rule and the
  // known due dates. Future installments reuse the last published value
  // (flagged), and negative values are floored to zero.
  if (
    rateConfig !== null &&
    rateConfig.regime.kind === 'floating' &&
    rc.floatingRateObservations.length > 0
  ) {
    const ruleCode = (readString(rc.rateSourceRule) ?? 'unknown') as RateSourceRule;
    const source = rc.floatingRateLock?.source === 'manual' ? 'user_input' : 'public_index';

    // Continuous history covers EVERY due date (including theoretical
    // schedule dates we never enumerated). Each monthly observation
    // becomes a period; the first extends back and the last extends far
    // forward, so future installments use the last published value.
    const continuous = buildContinuousRateHistory(rc.floatingRateObservations, source);

    const enrichedRegime: RateRegime = {
      ...rateConfig.regime,
      rateHistory: continuous.periods,
    };
    rateConfig = { ...rateConfig, regime: enrichedRegime };

    // Count how many KNOWN bank-row due dates fall after the last
    // published observation (those are projected). When there are no
    // bank rows, projection is still disclosed generically in the report.
    const lastPub = continuous.lastPublishedDate;
    let projectedCount = 0;
    if (lastPub !== null) {
      const lastPubDay = /^\d{4}-\d{2}$/.test(lastPub) ? `${lastPub}-01` : lastPub;
      projectedCount = bankRows.filter(
        (r) => typeof r.dueDate === 'string' && isValidISODate(r.dueDate) && r.dueDate > lastPubDay,
      ).length;
    }

    floatingRateProjection = {
      indexType: rateConfig.regime.kind === 'floating' ? rateConfig.regime.indexType : 'other',
      sourceRule: ruleCode === 'unknown' ? null : ruleCode,
      negativeIndexPolicy: 'floor_zero',
      projectedCount,
      lastPublishedDate: continuous.lastPublishedDate,
      lastPublishedValuePercent: continuous.lastPublishedValuePercent,
    };

    if (projectedCount > 0) {
      note(
        'rate_config',
        'Μελλοντικές δόσεις',
        `Για ${projectedCount} μελλοντικές δόσεις χρησιμοποιήθηκε η τελευταία δημοσιευμένη τιμή δείκτη (${continuous.lastPublishedValuePercent}% της ${continuous.lastPublishedDate}). Επισημαίνεται στη μελέτη.`,
      );
    }
  } else if (
    rateConfig !== null &&
    rateConfig.regime.kind === 'floating' &&
    rc.floatingRateObservations.length === 0
  ) {
    review(
      'rate_config',
      'Τιμές δείκτη',
      'Κυμαινόμενο καθεστώς χωρίς κλειδωμένες τιμές δείκτη· αντλήστε/καταχωρήστε και κλειδώστε τιμές για οριστικό υπολογισμό.',
    );
  }

  /* --- actual payments rows --------------------------------------------- */
  const actualPayments: ActualPayment[] = [];
  draft.actualPaymentsDraft.rows.forEach((row: ActualPaymentDraftRow, index) => {
    const paymentId = isValue(row.paymentId) ? row.paymentId.value : `payment-${index}`;
    const dateRaw = readString(row.paymentDate);
    const amount: NullableMoney = readMoney(row.amountCents, currency);
    const matched = readString(row.matchedScheduleRowId);
    const noteText = readString(row.note);

    if (dateRaw === null && amount === null) {
      note('actual_payments', 'Πραγματική καταβολή', 'Κενή γραμμή καταβολής· εξαιρέθηκε από τα δεδομένα.', paymentId);
      return; // excluded, explicitly reported
    }
    if (dateRaw === null || !isValidISODate(dateRaw)) {
      review('actual_payments', 'Ημερομηνία καταβολής', 'Καταβολή χωρίς έγκυρη ημερομηνία· απαιτείται έλεγχος.', paymentId);
      return;
    }
    if (amount === null) {
      // a recorded payment needs a known amount; do NOT assume zero
      review('actual_payments', 'Ποσό καταβολής', 'Καταβολή χωρίς διαθέσιμο ποσό· δεν τεκμαίρεται μηδενικό και η καταβολή απαιτεί έλεγχο.', paymentId);
      return;
    }

    const payment: ActualPayment = {
      paymentId,
      date: dateRaw,
      amount: amount as Money,
      description: noteText,
      matchedScheduleRowId: matched,
      matchConfidence: matched !== null ? 'manual' : 'unmatched',
    };
    actualPayments.push(payment);
  });

  /* --- recalculation settings ------------------------------------------- */
  const rs = draft.recalculationSettingsDraft;
  const scheduleModeCode = readString(rs.scheduleMode);
  const roundingModeCode = readString(rs.roundingMode);
  const feesCents = readNumber(rs.feesAndPremiumsPerPeriodCents);

  let scheduleMode: 'equal_principal' | 'equal_installment' | 'reamortizing' | 'balloon' | null = null;
  if (scheduleModeCode === null || scheduleModeCode === 'unknown') {
    miss('recalc_settings', 'Τύπος επανυπολογισμού', 'Ελλείπει ο τύπος επανυπολογισμού.');
  } else if (
    scheduleModeCode === 'equal_principal' ||
    scheduleModeCode === 'equal_installment' ||
    scheduleModeCode === 'reamortizing' ||
    scheduleModeCode === 'balloon'
  ) {
    scheduleMode = scheduleModeCode;
  } else {
    review('recalc_settings', 'Τύπος επανυπολογισμού', 'Μη αναγνωρισμένος τύπος επανυπολογισμού· απαιτείται έλεγχος.');
  }

  const roundingMode = roundingModeCode !== null && roundingModeCode !== 'unknown' ? roundingModeCode : null;
  if (roundingMode === null) {
    review('recalc_settings', 'Πολιτική στρογγυλοποίησης', 'Η πολιτική στρογγυλοποίησης δεν έχει προσδιοριστεί· απαιτείται έλεγχος.');
  }
  if (feesCents === null) {
    review('recalc_settings', 'Έξοδα / ασφάλιστρα ανά περίοδο', 'Τα έξοδα ανά περίοδο δεν έχουν προσδιοριστεί· δεν τεκμαίρονται μηδενικά.');
  }

  // Reset frequency (re-amortizing mode only). Required when that mode is
  // selected; ignored otherwise.
  const resetFreqCode = readString(rs.installmentResetFrequency);
  let resetFrequencyMonths: number | null = null;
  if (scheduleMode === 'reamortizing') {
    const map: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
    if (resetFreqCode !== null && resetFreqCode in map) {
      resetFrequencyMonths = map[resetFreqCode]!;
    } else {
      review('recalc_settings', 'Συχνότητα αναπροσαρμογής δόσης', 'Επιλέχθηκε αναπροσαρμοζόμενη δόση χωρίς συχνότητα αναπροσαρμογής· δηλώστε τη (μηνιαία/τριμηνιαία/εξαμηνιαία/ετήσια).');
    }
  }

  // Balloon amount (balloon mode only). Required when that mode is selected.
  const balloonMoney = readMoney(rs.balloonAmountCents, currency);
  const balloonAmountCents = balloonMoney === null ? null : balloonMoney.cents;
  if (scheduleMode === 'balloon' && balloonAmountCents === null) {
    review('recalc_settings', 'Ποσό εφάπαξ καταβολής (balloon)', 'Επιλέχθηκε δόση με υπόλοιπο (balloon) χωρίς ποσό εφάπαξ καταβολής· δηλώστε το ποσό που καταβάλλεται εφάπαξ στη λήξη.');
  }

  const recalculationSettings: PreparedRecalculationSettings | null =
    scheduleMode !== null
      ? { scheduleMode, roundingMode, feesAndPremiumsPerPeriodCents: feesCents, resetFrequencyMonths, balloonAmountCents }
      : null;

  /* --- case info object (only when all critical fields present) --------- */
  const caseInfo: CaseInfo | null =
    debtorName !== null &&
    contractNumber !== null &&
    institution !== null &&
    loanTerms !== null
      ? {
          caseId: options?.caseId ?? 'draft-case',
          debtorName,
          contractNumber,
          institution,
          servicer,
          contractDate: loanTerms.startDate,
          restructuringDate: null,
          principal: moneyFromCents(loanTerms.principalCents, currency),
          currency,
          startDate: loanTerms.startDate,
          endDate: loanTerms.endDate,
          termMonths: loanTerms.termMonths,
          notes: null,
        }
      : null;

  /* --- status aggregation ----------------------------------------------- */
  let status: DraftStatus;
  if (missingData.length > 0) status = 'missing_data';
  else if (warnings.some((w) => w.level === 'requires_review' || w.level === 'warning')) {
    status = 'requires_review';
  } else status = 'ready';

  // Extra charges (insurance, legal, etc.): read each row's date and
  // amount; skip rows missing either (never assume a value).
  const extraCharges: PreparedExtraCharge[] = [];
  for (const row of draft.extraChargesDraft.rows) {
    const dateStr = readString(row.chargeDate);
    const money = readMoney(row.amountCents, currency);
    const amount = money === null ? null : money.cents;
    if (dateStr !== null && dateStr !== 'unknown' && amount !== null) {
      extraCharges.push({
        dateISO: dateStr,
        amountCents: amount,
        description: readString(row.description),
      });
    } else if (dateStr !== null || amount !== null) {
      // Partially filled row → flag, don't silently drop.
      review('actual_payments', 'Πρόσθετη χρέωση', 'Πρόσθετη χρέωση με ελλιπή στοιχεία (ημερομηνία ή ποσό)· δεν συμπεριλήφθηκε στον υπολογισμό.');
    }
  }

  const accrueChargesStr = readString(draft.extraChargesDraft.accrueInterestOnCharges);
  const accrueInterestOnExtraCharges = accrueChargesStr !== 'no';

  return {
    status,
    caseInfo,
    loanTerms,
    rateConfig,
    bankRows,
    actualPayments,
    recalculationSettings,
    extraCharges,
    accrueInterestOnExtraCharges,
    missingData,
    warnings,
    floatingRateProjection,
  };
}
