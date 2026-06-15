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
import type { RateConfig, RateRegime, Law128Status } from '../domain/rateTypes';
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
  readonly scheduleMode: 'equal_principal' | 'equal_installment';
  readonly roundingMode: string | null;
  readonly feesAndPremiumsPerPeriodCents: number | null;
}

export interface DraftToDomainResult {
  readonly status: DraftStatus;
  readonly caseInfo: CaseInfo | null;
  readonly loanTerms: PreparedLoanTerms | null;
  readonly rateConfig: RateConfig | null;
  readonly bankRows: readonly BankScheduleRow[];
  readonly actualPayments: readonly ActualPayment[];
  readonly recalculationSettings: PreparedRecalculationSettings | null;
  readonly missingData: readonly DraftIssue[];
  readonly warnings: readonly DraftIssue[];
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
      regime = {
        kind: 'floating',
        indexType: 'other',
        indexLabel: null,
        spreadPercent,
        referenceDateRule: null,
        resetFrequencyMonths: null,
        negativeEuriborPolicy: 'unknown',
        rateHistory: [],
      };
      review('rate_config', 'Δείκτης επιτοκίου', 'Κυμαινόμενο καθεστώς: ο δείκτης και η πολιτική αρνητικού δείκτη δεν έχουν προσδιοριστεί· απαιτείται έλεγχος.');
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
    // added_separately requires a numeric rate; absent here → review + unknown
    law128 = { kind: 'unknown' };
    review('rate_config', 'Καθεστώς εισφοράς Ν.128/75', 'Χωριστή εισφορά χωρίς ποσοστό· απαιτείται έλεγχος.');
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

  const rateConfig: RateConfig | null =
    regime !== null && law128 !== null ? { regime, law128, dayCount: dayCountConvention } : null;

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

  let scheduleMode: 'equal_principal' | 'equal_installment' | null = null;
  if (scheduleModeCode === null || scheduleModeCode === 'unknown') {
    miss('recalc_settings', 'Τύπος επανυπολογισμού', 'Ελλείπει ο τύπος επανυπολογισμού.');
  } else if (scheduleModeCode === 'equal_principal' || scheduleModeCode === 'equal_installment') {
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

  const recalculationSettings: PreparedRecalculationSettings | null =
    scheduleMode !== null
      ? { scheduleMode, roundingMode, feesAndPremiumsPerPeriodCents: feesCents }
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

  return {
    status,
    caseInfo,
    loanTerms,
    rateConfig,
    bankRows,
    actualPayments,
    recalculationSettings,
    missingData,
    warnings,
  };
}
