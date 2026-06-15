/**
 * Loan Audit PRO — src/engines/scheduleComparisonEngine.ts
 * ------------------------------------------------------------------
 * Step 6-A: Schedule Comparison Engine ONLY.
 *
 * Compares the bank/fund schedule (evidence, possibly incomplete)
 * with our recalculated schedule (output of the locked engines) and
 * produces row-level and summary-level ECONOMIC DIFFERENCES.
 *
 * SIGN CONVENTION (locked since Step 2-A documentation — unchanged):
 *   economicDifference = bankOrFundAmount − recalculatedAmount
 *   > 0  bank/fund amount higher than the recalculation
 *   < 0  recalculation higher than the bank/fund amount
 *   = 0  agreement
 * The difference is a neutral technical financial magnitude; no
 * legal characterization is attached anywhere in this engine.
 *
 * NULL DISCIPLINE: a missing (null) bank or recalculated value is
 * NEVER converted to zero; the corresponding difference is null and
 * the gap is recorded (BANK_VALUE_MISSING / RECALC_VALUE_MISSING).
 * Rows with missing values are excluded from the affected totals and
 * counted in excludedRowCount — totals are never faked.
 *
 * Scope guards: independent of Ν.3869/2010 and ΑΠ 6/2026; NO
 * schedule generation, NO interest computation, NO payment
 * reconciliation, NO UI/PDF/Excel. Pure comparison of two given row
 * sets.
 */

import type { ISODate } from '../domain/dateTypes';
import type { CurrencyCode, NullableMoney } from '../domain/money';
import { moneyFromCents } from '../domain/money';
import type { BankScheduleRow, RecalcRow } from '../domain/scheduleTypes';
import type { ComparisonRow, FindingLevel } from '../domain/comparisonTypes';
import { createAuditEntry, type AuditEntry } from '../domain/auditTypes';
import { info, requiresReview, warning } from '../domain/auditFactories';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this engine                                 */
/* ------------------------------------------------------------------ */

export const SCHEDULE_COMPARISON_AUDIT_CODES = {
  COMPARISON_BANK_ROWS_EMPTY: 'COMPARISON_BANK_ROWS_EMPTY',
  COMPARISON_RECALC_ROWS_EMPTY: 'COMPARISON_RECALC_ROWS_EMPTY',
  BANK_VALUE_MISSING: 'BANK_VALUE_MISSING',
  RECALC_VALUE_MISSING: 'RECALC_VALUE_MISSING',
  UNMATCHED_BANK_ROW: 'UNMATCHED_BANK_ROW',
  UNMATCHED_RECALC_ROW: 'UNMATCHED_RECALC_ROW',
  AMBIGUOUS_DATE_MATCH: 'AMBIGUOUS_DATE_MATCH',
  DATE_TOLERANCE_MATCH: 'DATE_TOLERANCE_MATCH',
  INDEX_MATCHING_USED: 'INDEX_MATCHING_USED',
  MATERIAL_DIFFERENCE: 'MATERIAL_DIFFERENCE',
} as const;

const SC = SCHEDULE_COMPARISON_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ScheduleComparisonStatus = 'success' | 'requires_review' | 'missing_data';

export type MatchingMode = 'by_due_date' | 'by_index';

export interface ScheduleComparisonInput {
  readonly bankRows: readonly BankScheduleRow[];
  readonly recalcRows: readonly RecalcRow[];
  /** Default 'by_due_date'. */
  readonly matchingMode?: MatchingMode;
  /** Only used in by_due_date mode. Default 0 (exact dates only). */
  readonly dateToleranceDays?: number;
  /** Default 1 cent: |difference| above it is a material deviation. */
  readonly materialityThresholdCents?: number;
  readonly currency?: CurrencyCode;
}

export interface ScheduleComparisonSummary {
  readonly totalBankInstallmentsCents: number | null;
  readonly totalRecalculatedInstallmentsCents: number | null;
  readonly totalEconomicDifferenceCents: number | null;
  readonly totalBankInterestCents: number | null;
  readonly totalRecalculatedInterestCents: number | null;
  readonly totalInterestDifferenceCents: number | null;
  readonly totalBankPrincipalCents: number | null;
  readonly totalRecalculatedPrincipalCents: number | null;
  readonly totalPrincipalDifferenceCents: number | null;
  readonly comparedRowCount: number;
  /** Rows excluded from one or more totals due to missing values. */
  readonly excludedRowCount: number;
  readonly unmatchedBankRowCount: number;
  readonly unmatchedRecalcRowCount: number;
  readonly rowsRequiringReviewCount: number;
}

export interface ScheduleComparisonResult {
  readonly status: ScheduleComparisonStatus;
  readonly rows: readonly ComparisonRow[];
  readonly summary: ScheduleComparisonSummary | null;
  readonly unmatchedBankRows: readonly BankScheduleRow[];
  readonly unmatchedRecalcRows: readonly RecalcRow[];
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** Defensive cents reader: runtime data may violate the static types. */
function centsOf(value: NullableMoney | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isSafeInteger(value.cents) ? value.cents : null;
}

function absDaysBetween(a: ISODate, b: ISODate): number {
  const toMs = (d: ISODate): number =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.abs(Math.round((toMs(a) - toMs(b)) / 86_400_000));
}

interface MatchedPair {
  readonly bank: BankScheduleRow;
  readonly recalc: RecalcRow;
  readonly toleranceUsed: boolean;
}

/** Merge identical entries; context lists affected rows. */
function aggregate(
  raw: ReadonlyArray<{ rowRef: string; entry: AuditEntry }>,
): AuditEntry[] {
  const byKey = new Map<string, { entry: AuditEntry; rowRefs: string[] }>();
  const order: string[] = [];
  for (const { rowRef, entry } of raw) {
    const key = `${entry.severity}|${entry.code}|${entry.message}`;
    const existing = byKey.get(key);
    if (existing) existing.rowRefs.push(rowRef);
    else {
      byKey.set(key, { entry, rowRefs: [rowRef] });
      order.push(key);
    }
  }
  return order.map((key) => {
    const { entry, rowRefs } = byKey.get(key)!;
    return createAuditEntry({
      severity: entry.severity,
      code: entry.code,
      message: entry.message,
      context: { ...(entry.context ?? {}), rowRefs, occurrences: rowRefs.length },
    });
  });
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function compareSchedules(
  input: ScheduleComparisonInput,
): ScheduleComparisonResult {
  const mode: MatchingMode = input.matchingMode ?? 'by_due_date';
  const tolerance = input.dateToleranceDays ?? 0;
  const threshold = input.materialityThresholdCents ?? 1;
  const currency: CurrencyCode = input.currency ?? 'EUR';

  const rawEntries: { rowRef: string; entry: AuditEntry }[] = [];
  const push = (rowRef: string, entry: AuditEntry): void => {
    rawEntries.push({ rowRef, entry });
  };

  // --- empty inputs: nothing to compare -------------------------------
  if (input.bankRows.length === 0 || input.recalcRows.length === 0) {
    if (input.bankRows.length === 0) {
      push('-', requiresReview(SC.COMPARISON_BANK_ROWS_EMPTY, 'Ελλιπή δεδομένα: δεν υπάρχουν γραμμές δοσολογίου τράπεζας / fund προς σύγκριση.'));
    }
    if (input.recalcRows.length === 0) {
      push('-', requiresReview(SC.COMPARISON_RECALC_ROWS_EMPTY, 'Ελλιπή δεδομένα: δεν υπάρχουν γραμμές επανυπολογισμού προς σύγκριση.'));
    }
    return {
      status: 'missing_data',
      rows: [],
      summary: null,
      unmatchedBankRows: input.bankRows,
      unmatchedRecalcRows: input.recalcRows,
      auditEntries: aggregate(rawEntries),
    };
  }

  // --- matching --------------------------------------------------------
  const pairs: MatchedPair[] = [];
  const unmatchedBankRows: BankScheduleRow[] = [];
  const unmatchedRecalcRows: RecalcRow[] = [];
  let ambiguous = false;

  if (mode === 'by_index') {
    push('-', info(SC.INDEX_MATCHING_USED, 'Πληροφορία: η αντιστοίχιση γραμμών έγινε κατά σειρά (index), όχι κατά ημερομηνία.'));
    const n = Math.min(input.bankRows.length, input.recalcRows.length);
    for (let i = 0; i < n; i++) {
      pairs.push({ bank: input.bankRows[i]!, recalc: input.recalcRows[i]!, toleranceUsed: false });
    }
    for (let i = n; i < input.bankRows.length; i++) unmatchedBankRows.push(input.bankRows[i]!);
    for (let i = n; i < input.recalcRows.length; i++) unmatchedRecalcRows.push(input.recalcRows[i]!);
  } else {
    const usedRecalc = new Set<string>();
    const byDate = new Map<string, RecalcRow[]>();
    for (const r of input.recalcRows) {
      const list = byDate.get(r.dueDate) ?? [];
      list.push(r);
      byDate.set(r.dueDate, list);
    }

    for (const bank of input.bankRows) {
      // exact date first
      const exact = (byDate.get(bank.dueDate) ?? []).filter((r) => !usedRecalc.has(r.rowId));
      if (exact.length === 1) {
        usedRecalc.add(exact[0]!.rowId);
        pairs.push({ bank, recalc: exact[0]!, toleranceUsed: false });
        continue;
      }
      if (exact.length > 1) {
        ambiguous = true;
        push(bank.rowId, requiresReview(SC.AMBIGUOUS_DATE_MATCH, `Απαιτείται έλεγχος: πολλαπλές γραμμές επανυπολογισμού με την ίδια ημερομηνία (${bank.dueDate})· η αντιστοίχιση δεν είναι μονοσήμαντη.`, { dueDate: bank.dueDate, candidates: exact.length }));
        unmatchedBankRows.push(bank);
        continue;
      }
      // tolerance window
      if (tolerance > 0) {
        const candidates = input.recalcRows.filter(
          (r) => !usedRecalc.has(r.rowId) && absDaysBetween(bank.dueDate, r.dueDate) <= tolerance,
        );
        if (candidates.length === 1) {
          usedRecalc.add(candidates[0]!.rowId);
          pairs.push({ bank, recalc: candidates[0]!, toleranceUsed: true });
          push(bank.rowId, info(SC.DATE_TOLERANCE_MATCH, `Πληροφορία: αντιστοίχιση με ανοχή ημερομηνίας (±${tolerance} ημέρες): ${bank.dueDate} ↔ ${candidates[0]!.dueDate}.`, { bankDueDate: bank.dueDate, recalcDueDate: candidates[0]!.dueDate }));
          continue;
        }
        if (candidates.length > 1) {
          ambiguous = true;
          push(bank.rowId, requiresReview(SC.AMBIGUOUS_DATE_MATCH, `Απαιτείται έλεγχος: ${candidates.length} υποψήφιες γραμμές επανυπολογισμού εντός ανοχής ±${tolerance} ημερών για την ${bank.dueDate}· η αντιστοίχιση δεν είναι μονοσήμαντη.`, { dueDate: bank.dueDate, candidates: candidates.length }));
          unmatchedBankRows.push(bank);
          continue;
        }
      }
      unmatchedBankRows.push(bank);
    }
    for (const r of input.recalcRows) {
      if (!usedRecalc.has(r.rowId)) unmatchedRecalcRows.push(r);
    }
  }

  for (const b of unmatchedBankRows) {
    push(b.rowId, warning(SC.UNMATCHED_BANK_ROW, 'Ελλιπή δεδομένα αντιστοίχισης: γραμμή δοσολογίου τράπεζας / fund χωρίς αντίστοιχη γραμμή επανυπολογισμού.', { dueDate: b.dueDate }));
  }
  for (const r of unmatchedRecalcRows) {
    push(r.rowId, warning(SC.UNMATCHED_RECALC_ROW, 'Ελλιπή δεδομένα αντιστοίχισης: γραμμή επανυπολογισμού χωρίς αντίστοιχη γραμμή δοσολογίου τράπεζας / fund.', { dueDate: r.dueDate }));
  }

  // --- row comparison ----------------------------------------------------
  const diff = (bank: number | null, recalc: number | null): number | null =>
    bank === null || recalc === null ? null : bank - recalc;

  const rows: ComparisonRow[] = [];
  let materialCount = 0;
  let missingValueRows = 0;

  pairs.forEach((pair, idx) => {
    const { bank, recalc } = pair;
    const rowRef = `${bank.rowId}↔${recalc.rowId}`;

    const bankInstallment = centsOf(bank.installmentAmount);
    const bankPrincipal = centsOf(bank.principalPortion);
    const bankInterest = centsOf(bank.interestPortion);
    const bankBalance = centsOf(bank.balanceAfter);

    const recalcInstallment = centsOf(recalc.installment as NullableMoney);
    const recalcPrincipal = centsOf(recalc.principal as NullableMoney);
    const recalcInterest = centsOf(recalc.interest as NullableMoney);
    const recalcBalance = centsOf(recalc.closingBalance as NullableMoney);

    const missingBank: string[] = [];
    if (bankInstallment === null) missingBank.push('δόση');
    if (bankPrincipal === null) missingBank.push('χρεολύσιο');
    if (bankInterest === null) missingBank.push('τόκοι');
    if (bankBalance === null) missingBank.push('υπόλοιπο');
    if (missingBank.length > 0) {
      push(rowRef, warning(SC.BANK_VALUE_MISSING, `Ελλιπή δεδομένα τράπεζας / fund: μη διαθέσιμα πεδία (${missingBank.join(', ')})· οι αντίστοιχες διαφορές δεν υπολογίζονται και η γραμμή εξαιρείται από τα σχετικά σύνολα.`, { dueDate: bank.dueDate }));
    }
    const missingRecalc: string[] = [];
    if (recalcInstallment === null) missingRecalc.push('δόση');
    if (recalcPrincipal === null) missingRecalc.push('χρεολύσιο');
    if (recalcInterest === null) missingRecalc.push('τόκοι');
    if (recalcBalance === null) missingRecalc.push('υπόλοιπο');
    if (missingRecalc.length > 0) {
      push(rowRef, warning(SC.RECALC_VALUE_MISSING, `Ελλιπή δεδομένα επανυπολογισμού: μη διαθέσιμα πεδία (${missingRecalc.join(', ')})· οι αντίστοιχες διαφορές δεν υπολογίζονται.`, { dueDate: recalc.dueDate }));
    }

    const installmentDifferenceCents = diff(bankInstallment, recalcInstallment);
    const principalDifferenceCents = diff(bankPrincipal, recalcPrincipal);
    const interestDifferenceCents = diff(bankInterest, recalcInterest);
    const balanceDifferenceCents = diff(bankBalance, recalcBalance);

    // MVP row-level economic difference = installment difference
    const economicDifferenceCents = installmentDifferenceCents;

    const hasMissing = missingBank.length > 0 || missingRecalc.length > 0;
    let findingLevel: FindingLevel;
    let notes: string | null = null;

    if (hasMissing) {
      findingLevel = 'missing_data';
      missingValueRows += 1;
      notes = 'Ελλιπή δεδομένα: μερική σύγκριση.';
    } else if (economicDifferenceCents !== null && Math.abs(economicDifferenceCents) > threshold) {
      findingLevel = 'deviation';
      materialCount += 1;
      notes = 'Οικονομική απόκλιση άνω του κατωφλίου σημαντικότητας· απαιτείται έλεγχος.';
    } else if (
      [installmentDifferenceCents, principalDifferenceCents, interestDifferenceCents, balanceDifferenceCents]
        .some((d) => d !== null && d !== 0)
    ) {
      findingLevel = 'rounding';
      notes = 'Οικονομική διαφορά εντός κατωφλίου σημαντικότητας (στρογγυλοποίηση).';
    } else {
      findingLevel = 'none';
    }

    rows.push({
      period: idx + 1,
      dueDate: bank.dueDate,
      bankInstallment: bank.installmentAmount,
      bankPrincipal: bank.principalPortion,
      bankInterest: bank.interestPortion,
      bankBalance: bank.balanceAfter,
      recalculatedInstallment: recalcInstallment === null ? null : recalc.installment,
      recalculatedPrincipal: recalcPrincipal === null ? null : recalc.principal,
      recalculatedInterest: recalcInterest === null ? null : recalc.interest,
      recalculatedBalance: recalcBalance === null ? null : recalc.closingBalance,
      actualPaid: null,
      economicDifference:
        economicDifferenceCents === null ? null : moneyFromCents(economicDifferenceCents, currency),
      findingLevel,
      notes,
    });
  });

  if (materialCount > 0) {
    push('-', requiresReview(SC.MATERIAL_DIFFERENCE, `Απαιτείται έλεγχος: ${materialCount} περίοδοι με οικονομική απόκλιση άνω του κατωφλίου σημαντικότητας (${threshold} λεπτά).`, { materialRowCount: materialCount, thresholdCents: threshold }));
  }

  // --- summary: never fake missing values ------------------------------
  const sumWhereBoth = (
    bankOf: (r: ComparisonRow) => number | null,
    recalcOf: (r: ComparisonRow) => number | null,
  ): { bank: number | null; recalc: number | null; diff: number | null } => {
    const usable = rows.filter((r) => bankOf(r) !== null && recalcOf(r) !== null);
    if (usable.length === 0) return { bank: null, recalc: null, diff: null };
    const bank = usable.reduce((s, r) => s + (bankOf(r) as number), 0);
    const recalc = usable.reduce((s, r) => s + (recalcOf(r) as number), 0);
    return { bank, recalc, diff: bank - recalc };
  };

  const inst = sumWhereBoth(
    (r) => centsOf(r.bankInstallment),
    (r) => centsOf(r.recalculatedInstallment),
  );
  const intr = sumWhereBoth(
    (r) => centsOf(r.bankInterest),
    (r) => centsOf(r.recalculatedInterest),
  );
  const prin = sumWhereBoth(
    (r) => centsOf(r.bankPrincipal),
    (r) => centsOf(r.recalculatedPrincipal),
  );

  const summary: ScheduleComparisonSummary = {
    totalBankInstallmentsCents: inst.bank,
    totalRecalculatedInstallmentsCents: inst.recalc,
    totalEconomicDifferenceCents: inst.diff,
    totalBankInterestCents: intr.bank,
    totalRecalculatedInterestCents: intr.recalc,
    totalInterestDifferenceCents: intr.diff,
    totalBankPrincipalCents: prin.bank,
    totalRecalculatedPrincipalCents: prin.recalc,
    totalPrincipalDifferenceCents: prin.diff,
    comparedRowCount: rows.length,
    excludedRowCount: missingValueRows,
    unmatchedBankRowCount: unmatchedBankRows.length,
    unmatchedRecalcRowCount: unmatchedRecalcRows.length,
    rowsRequiringReviewCount: materialCount,
  };

  // --- status ------------------------------------------------------------
  const needsReview =
    unmatchedBankRows.length > 0 ||
    unmatchedRecalcRows.length > 0 ||
    ambiguous ||
    missingValueRows > 0 ||
    materialCount > 0;

  return {
    status: needsReview ? 'requires_review' : 'success',
    rows,
    summary,
    unmatchedBankRows,
    unmatchedRecalcRows,
    auditEntries: aggregate(rawEntries),
  };
}
