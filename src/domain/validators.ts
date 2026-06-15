/**
 * Loan Audit PRO — src/domain/validators.ts
 * ------------------------------------------------------------------
 * Step 1-B: validation utilities. Validators ONLY inspect data and
 * produce AuditEntry[] — they never mutate, never infer missing
 * values, never convert null to zero, and perform NO loan
 * calculations (no interest, no amortization).
 *
 * Scope guard: independent of Ν.3869/2010 and ΑΠ 6/2026.
 */

import type { CaseInfo } from './loanTypes';
import type { RateConfig } from './rateTypes';
import type { BankScheduleRow } from './scheduleTypes';
import type { ActualPayment } from './paymentTypes';
import { isValidISODate, compareISODate, type ISODate } from './dateTypes';
import { isMissing, isExplicitZero } from './money';
import { findForbiddenTerms } from './reportTypes';
import type { AuditEntry } from './auditTypes';
import {
  VALIDATION_AUDIT_CODES as C,
  info,
  assumption,
  warning,
  requiresReview,
} from './auditFactories';

const isBlank = (s: string | null | undefined): boolean =>
  s === null || s === undefined || s.trim() === '';

/* ------------------------------------------------------------------ */
/* 1. CaseInfo                                                         */
/* ------------------------------------------------------------------ */

export function validateCaseInfo(caseInfo: CaseInfo): AuditEntry[] {
  const entries: AuditEntry[] = [];

  if (isBlank(caseInfo.debtorName)) {
    entries.push(
      warning(C.CASE_DEBTOR_NAME_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί ονοματεπώνυμο/επωνυμία οφειλέτη.'),
    );
  }

  if (isBlank(caseInfo.contractNumber)) {
    entries.push(
      warning(C.CASE_CONTRACT_NUMBER_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί αριθμός σύμβασης.'),
    );
  }

  if (isBlank(caseInfo.institution) && isBlank(caseInfo.servicer)) {
    entries.push(
      warning(C.CASE_INSTITUTION_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί τράπεζα / fund / servicer.'),
    );
  }

  // Principal is typed non-null, but runtime data (JSON import, drafts)
  // may violate that — a missing principal blocks calculation.
  if ((caseInfo.principal as unknown) === null || (caseInfo.principal as unknown) === undefined) {
    entries.push(
      requiresReview(C.CASE_PRINCIPAL_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί αρχικό κεφάλαιο. Ο επανυπολογισμός δεν μπορεί να εκτελεστεί.'),
    );
  }

  if (isBlank(caseInfo.currency)) {
    entries.push(
      warning(C.CASE_CURRENCY_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί νόμισμα.'),
    );
  }

  const hasStart = !isBlank(caseInfo.startDate) && isValidISODate(caseInfo.startDate);
  if (!hasStart) {
    entries.push(
      requiresReview(C.CASE_START_DATE_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί έγκυρη ημερομηνία έναρξης.'),
    );
  }

  const hasEnd = !isBlank(caseInfo.endDate) && isValidISODate(caseInfo.endDate);
  const hasTerm =
    typeof caseInfo.termMonths === 'number' &&
    Number.isFinite(caseInfo.termMonths) &&
    caseInfo.termMonths > 0;
  if (!hasEnd && !hasTerm) {
    entries.push(
      requiresReview(C.CASE_TERM_OR_END_DATE_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί ούτε διάρκεια (μήνες) ούτε ημερομηνία λήξης.'),
    );
  }

  if (hasStart && hasEnd && compareISODate(caseInfo.startDate, caseInfo.endDate) === 1) {
    entries.push(
      warning(C.CASE_DATE_INVALID, 'Ασυνέπεια δεδομένων: η ημερομηνία έναρξης είναι μεταγενέστερη της ημερομηνίας λήξης. Απαιτείται έλεγχος.', {
        startDate: caseInfo.startDate,
        endDate: caseInfo.endDate,
      }),
    );
  }

  return entries;
}

/* ------------------------------------------------------------------ */
/* 2. RateConfig                                                       */
/* ------------------------------------------------------------------ */

export interface ValidateRateConfigOptions {
  /**
   * How a missing floating-rate history is graded:
   *   'warning'         -> data-gathering phase
   *   'requires_review' -> pre-calculation phase (default)
   */
  readonly missingRateHistorySeverity?: 'warning' | 'requires_review';
}

export function validateRateConfig(
  rateConfig: RateConfig,
  options: ValidateRateConfigOptions = {},
): AuditEntry[] {
  const entries: AuditEntry[] = [];
  const { regime, law128, dayCount } = rateConfig;

  if (regime.kind === 'fixed') {
    const rate = regime.annualRatePercent as unknown;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      entries.push(
        requiresReview(C.RATE_FIXED_MISSING, 'Ελλιπή δεδομένα: σταθερό επιτόκιο χωρίς καταχωρημένη τιμή. Ο επανυπολογισμός δεν μπορεί να εκτελεστεί.'),
      );
    }
  } else {
    const indexType = regime.indexType as unknown;
    if (isBlank(indexType as string | null)) {
      entries.push(
        requiresReview(C.RATE_FLOATING_INDEX_MISSING, 'Ελλιπή δεδομένα: κυμαινόμενο επιτόκιο χωρίς δείκτη αναφοράς.'),
      );
    }

    const spread = regime.spreadPercent as unknown;
    if (typeof spread !== 'number' || !Number.isFinite(spread)) {
      entries.push(
        warning(C.RATE_SPREAD_MISSING, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί περιθώριο (spread).'),
      );
    }

    if (regime.negativeEuriborPolicy === 'unknown') {
      entries.push(
        requiresReview(C.NEGATIVE_INDEX_POLICY_UNKNOWN, 'Απαιτείται έλεγχος: άγνωστος συμβατικός χειρισμός μηδενικού/αρνητικού δείκτη (όρος floor). Προβλέπεται υπολογισμός διπλού σεναρίου.'),
      );
    }

    if (regime.rateHistory.length === 0) {
      const severity = options.missingRateHistorySeverity ?? 'requires_review';
      const message =
        'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί ιστορικό τιμών δείκτη για κυμαινόμενο επιτόκιο.';
      entries.push(
        severity === 'warning'
          ? warning(C.RATE_HISTORY_MISSING, message)
          : requiresReview(C.RATE_HISTORY_MISSING, message),
      );
    }
  }

  if (law128.kind === 'unknown') {
    entries.push(
      requiresReview(C.LAW128_UNKNOWN, 'Απαιτείται έλεγχος: άγνωστο καθεστώς εισφοράς Ν.128/75 (περιλαμβάνεται ή προστίθεται χωριστά).'),
    );
  }

  if (dayCount === 'unknown') {
    entries.push(
      assumption(C.DAYCOUNT_UNKNOWN, 'Ρητή υπόθεση: άγνωστη σύμβαση ημερομέτρησης. Σε μεταγενέστερο υπολογισμό θα χρησιμοποιηθεί ACT_360 ως δηλωμένη υπόθεση. Απαιτείται έλεγχος της σύμβασης.'),
    );
  }

  return entries;
}

/* ------------------------------------------------------------------ */
/* 3. Bank schedule rows                                               */
/* ------------------------------------------------------------------ */

export function validateBankScheduleRows(rows: readonly BankScheduleRow[]): AuditEntry[] {
  const entries: AuditEntry[] = [];

  if (rows.length === 0) {
    entries.push(
      requiresReview(C.BANK_SCHEDULE_EMPTY, 'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί δοσολόγιο τράπεζας / fund.'),
    );
    return entries;
  }

  const seenRowIds = new Set<string>();
  let previousDate: ISODate | null = null;
  let chronologyFlagged = false;

  rows.forEach((row, i) => {
    const where = { rowId: row.rowId, index: i, dueDate: row.dueDate };

    if (seenRowIds.has(row.rowId)) {
      entries.push(
        warning(C.BANK_SCHEDULE_DUPLICATE_ROW_ID, `Ασυνέπεια δεδομένων: διπλό αναγνωριστικό γραμμής δοσολογίου (${row.rowId}).`, where),
      );
    }
    seenRowIds.add(row.rowId);

    const dateValid = !isBlank(row.dueDate) && isValidISODate(row.dueDate);
    if (!dateValid) {
      entries.push(
        warning(C.BANK_SCHEDULE_ROW_DUE_DATE_INVALID, `Ελλιπή δεδομένα: μη έγκυρη ή ελλείπουσα ημερομηνία δόσης στη γραμμή ${i + 1}.`, where),
      );
    } else {
      if (!chronologyFlagged && previousDate !== null && compareISODate(previousDate, row.dueDate) === 1) {
        entries.push(
          warning(C.BANK_SCHEDULE_DATES_NOT_CHRONOLOGICAL, `Ασυνέπεια δεδομένων: οι ημερομηνίες του δοσολογίου δεν είναι σε χρονολογική σειρά (γραμμή ${i + 1}).`, where),
        );
        chronologyFlagged = true; // one finding per schedule, not per row
      }
      previousDate = row.dueDate;
    }

    // null = missing (warning). Explicit zero is DATA, never missing.
    if (isMissing(row.installmentAmount)) {
      entries.push(
        warning(C.BANK_SCHEDULE_ROW_MISSING_AMOUNT, `Ελλιπή δεδομένα: ποσό δόσης μη διαθέσιμο στη γραμμή ${i + 1}.`, where),
      );
    }
    if (isMissing(row.principalPortion)) {
      entries.push(
        warning(C.BANK_SCHEDULE_ROW_MISSING_PRINCIPAL, `Ελλιπή δεδομένα: χρεολύσιο μη διαθέσιμο στη γραμμή ${i + 1}.`, where),
      );
    }
    if (isMissing(row.interestPortion)) {
      entries.push(
        warning(C.BANK_SCHEDULE_ROW_MISSING_INTEREST, `Ελλιπή δεδομένα: τόκοι μη διαθέσιμοι στη γραμμή ${i + 1}.`, where),
      );
    }
    if (isMissing(row.balanceAfter)) {
      entries.push(
        warning(C.BANK_SCHEDULE_ROW_MISSING_BALANCE, `Ελλιπή δεδομένα: υπόλοιπο κεφαλαίου μη διαθέσιμο στη γραμμή ${i + 1}.`, where),
      );
    }

    const allMonetaryMissing =
      isMissing(row.installmentAmount) &&
      isMissing(row.principalPortion) &&
      isMissing(row.interestPortion) &&
      isMissing(row.feesAndPremiums) &&
      isMissing(row.balanceAfter);
    if (allMonetaryMissing) {
      entries.push(
        requiresReview(C.BANK_SCHEDULE_ROW_ALL_NUMERIC_FIELDS_MISSING, `Απαιτείται έλεγχος: όλα τα χρηματικά πεδία της γραμμής ${i + 1} είναι μη διαθέσιμα.`, where),
      );
    }

    if (row.sourceConfidence === 'low') {
      entries.push(
        info(C.BANK_SCHEDULE_ROW_LOW_CONFIDENCE, `Πληροφορία: χαμηλή αξιοπιστία εξαγωγής δεδομένων στη γραμμή ${i + 1}· συνιστάται αντιπαραβολή με την πηγή.`, where),
      );
    }

    // Documented non-finding: explicit zero installment is preserved as
    // data (e.g. interest-only or moratorium period per the bank file).
    if (isExplicitZero(row.installmentAmount)) {
      // intentionally no entry — zero is not missing
    }
  });

  return entries;
}

/* ------------------------------------------------------------------ */
/* 4. Actual payments                                                  */
/* ------------------------------------------------------------------ */

export function validateActualPayments(payments: readonly ActualPayment[]): AuditEntry[] {
  const entries: AuditEntry[] = [];
  const seenIds = new Set<string>();

  payments.forEach((p, i) => {
    const where = { paymentId: p.paymentId, index: i, date: p.date };

    if (seenIds.has(p.paymentId)) {
      entries.push(
        warning(C.PAYMENT_DUPLICATE_ID, `Ασυνέπεια δεδομένων: διπλό αναγνωριστικό καταβολής (${p.paymentId}).`, where),
      );
    }
    seenIds.add(p.paymentId);

    if (isBlank(p.date) || !isValidISODate(p.date)) {
      entries.push(
        warning(C.PAYMENT_DATE_INVALID, `Ελλιπή δεδομένα: μη έγκυρη ή ελλείπουσα ημερομηνία καταβολής (${p.paymentId}).`, where),
      );
    }

    // amount is typed non-null; runtime drafts/imports may violate it.
    const amount = p.amount as unknown;
    if (amount === null || amount === undefined) {
      entries.push(
        warning(C.PAYMENT_AMOUNT_MISSING, `Ελλιπή δεδομένα: ποσό καταβολής μη διαθέσιμο (${p.paymentId}).`, where),
      );
    } else if (isExplicitZero(p.amount)) {
      // Explicit zero is valid data — recorded as info, never as missing.
      entries.push(
        info(C.PAYMENT_AMOUNT_EXPLICIT_ZERO, `Πληροφορία: καταβολή με ρητά μηδενικό ποσό (${p.paymentId})· διατηρείται ως καταχωρημένο δεδομένο.`, where),
      );
    }

    if (p.matchedScheduleRowId === null || p.matchConfidence === 'unmatched') {
      entries.push(
        info(C.PAYMENT_UNMATCHED, `Πληροφορία: η καταβολή ${p.paymentId} δεν έχει αντιστοιχιστεί σε δόση.`, where),
      );
    }
  });

  return entries;
}

/* ------------------------------------------------------------------ */
/* 5. Neutral report wording                                           */
/* ------------------------------------------------------------------ */

/**
 * Non-throwing companion to the Step 1-A createReportModel guard
 * (which throws ReportWordingError): inspects free text and returns
 * one warning per forbidden term found. Empty array = clean.
 */
export function validateNeutralReportText(text: string): AuditEntry[] {
  return findForbiddenTerms(text).map((term) =>
    warning(C.FORBIDDEN_REPORT_TERM, `Μη ουδέτερη διατύπωση: ο όρος «${term}» δεν επιτρέπεται σε τεχνική οικονομική μελέτη.`, { term }),
  );
}

/* ------------------------------------------------------------------ */
/* 6. Combined readiness validator                                     */
/* ------------------------------------------------------------------ */

export interface ReadyForCalculationInput {
  readonly caseInfo: CaseInfo;
  readonly rateConfig: RateConfig;
  readonly bankScheduleRows: readonly BankScheduleRow[];
  readonly actualPayments?: readonly ActualPayment[];
}

export interface ReadyForCalculationResult {
  readonly canCalculate: boolean;
  readonly canGenerateReport: boolean;
  readonly auditEntries: readonly AuditEntry[];
}

/**
 * Codes that BLOCK calculation: without principal, without a usable
 * rate regime, without start date / term, or without any schedule,
 * a recalculation cannot be produced.
 *
 * Deliberately NOT blocking: LAW128_UNKNOWN (dual-scenario,
 * requires_review), DAYCOUNT_UNKNOWN (explicit assumption),
 * NEGATIVE_INDEX_POLICY_UNKNOWN (dual-scenario), missing monetary
 * fields in individual bank rows (excluded from totals later, never
 * zero-filled).
 */
const CALCULATION_BLOCKING_CODES: ReadonlySet<string> = new Set([
  C.CASE_PRINCIPAL_MISSING,
  C.CASE_START_DATE_MISSING,
  C.CASE_TERM_OR_END_DATE_MISSING,
  C.RATE_FIXED_MISSING,
  C.RATE_FLOATING_INDEX_MISSING,
  C.BANK_SCHEDULE_EMPTY,
]);

export function validateReadyForCalculation(
  input: ReadyForCalculationInput,
): ReadyForCalculationResult {
  const auditEntries: AuditEntry[] = [
    ...validateCaseInfo(input.caseInfo),
    ...validateRateConfig(input.rateConfig),
    ...validateBankScheduleRows(input.bankScheduleRows),
    ...(input.actualPayments ? validateActualPayments(input.actualPayments) : []),
  ];

  const canCalculate = !auditEntries.some((e) =>
    CALCULATION_BLOCKING_CODES.has(e.code),
  );

  // A report (with stated limitations) can be generated whenever the
  // case is minimally identifiable and there is something to report on:
  // either a feasible recalculation, or bank data to summarize.
  const canGenerateReport =
    canCalculate || input.bankScheduleRows.length > 0;

  return { canCalculate, canGenerateReport, auditEntries };
}
