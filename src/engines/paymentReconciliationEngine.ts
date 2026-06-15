/**
 * Loan Audit PRO — src/engines/paymentReconciliationEngine.ts
 * ------------------------------------------------------------------
 * Step 9-A: Payment Reconciliation Engine ONLY.
 *
 * Reconciles ACTUAL debtor payments against the bank/fund schedule
 * rows and/or the recalculated schedule rows, producing neutral
 * financial reconciliation rows and a summary. Pure transform over
 * PROVIDED rows: it never calls the schedule engines, never re-runs
 * the comparison engine and never generates report text.
 *
 * SIGN CONVENTION OF THIS ENGINE (deliberately DIFFERENT from the
 * schedule comparison engine and documented as such):
 *   differenceVsBank         = actualPaid − bankDue
 *   differenceVsRecalculated = actualPaid − recalculatedDue
 *   > 0  the actual payment is HIGHER than the target due amount
 *   < 0  the actual payment is LOWER than the target due amount
 * (The schedule comparison engine uses bank − recalculated; the two
 * conventions live in different result types and never mix.)
 *
 * NULL DISCIPLINE: a missing amount is NEVER treated as zero — the
 * corresponding difference is null, the gap is recorded
 * (PAYMENT_AMOUNT_MISSING / BANK_VALUE_MISSING /
 * RECALC_VALUE_MISSING) and the row is excluded from the affected
 * totals (excludedRowCount). An unmatched due row does NOT imply a
 * zero payment: actualPaid stays null with status unmatched_due.
 * Explicit 0 (a recorded zero payment) is valid data.
 *
 * Scope guards: independent of Ν.3869/2010 and ΑΠ 6/2026; no UI, no
 * PDF, no persistence; neutral financial wording only.
 */

import type { ISODate } from '../domain/dateTypes';
import type { CurrencyCode, NullableMoney } from '../domain/money';
import type { ActualPayment } from '../domain/paymentTypes';
import type { BankScheduleRow, RecalcRow } from '../domain/scheduleTypes';
import { createAuditEntry, type AuditEntry } from '../domain/auditTypes';
import {
  VALIDATION_AUDIT_CODES as C,
  info,
  warning,
  requiresReview,
} from '../domain/auditFactories';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this engine                                 */
/* ------------------------------------------------------------------ */

export const PAYMENT_RECONCILIATION_AUDIT_CODES = {
  RECON_PAYMENTS_EMPTY: 'RECON_PAYMENTS_EMPTY',
  RECON_TARGET_ROWS_MISSING: 'RECON_TARGET_ROWS_MISSING',
  /** Same code values as Step 1-B / Step 6-A for consistency. */
  PAYMENT_AMOUNT_MISSING: C.PAYMENT_AMOUNT_MISSING,
  BANK_VALUE_MISSING: 'BANK_VALUE_MISSING',
  RECALC_VALUE_MISSING: 'RECALC_VALUE_MISSING',
  UNMATCHED_PAYMENT: 'UNMATCHED_PAYMENT',
  UNMATCHED_DUE_ROW: 'UNMATCHED_DUE_ROW',
  AMBIGUOUS_PAYMENT_MATCH: 'AMBIGUOUS_PAYMENT_MATCH',
  MANUAL_MATCH_ROW_MISSING: 'MANUAL_MATCH_ROW_MISSING',
  DUPLICATE_DUE_DATE: 'DUPLICATE_DUE_DATE',
  PAYMENT_DIFFERENCE_MATERIAL: 'PAYMENT_DIFFERENCE_MATERIAL',
} as const;

const PR = PAYMENT_RECONCILIATION_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PaymentReconciliationStatus = 'success' | 'requires_review' | 'missing_data';

export type ReconciliationMatchingMode =
  | 'by_due_date'
  | 'by_payment_date_window'
  | 'manual_match_id';

export type ReconciliationTarget =
  | 'bank_schedule'
  | 'recalculated_schedule'
  | 'both';

export type ReconciliationRowStatus =
  | 'matched'
  | 'unmatched_payment'
  | 'unmatched_due'
  | 'missing_data'
  | 'requires_review';

export interface PaymentReconciliationInput {
  readonly actualPayments: readonly ActualPayment[];
  readonly bankRows?: readonly BankScheduleRow[];
  readonly recalcRows?: readonly RecalcRow[];
  /** Default 'by_due_date'. */
  readonly matchingMode?: ReconciliationMatchingMode;
  /** Default 0 (exact dates only). */
  readonly dateToleranceDays?: number;
  /** Default: inferred from the provided rows ('both' when both exist). */
  readonly target?: ReconciliationTarget;
  /** Default 1 cent. */
  readonly materialityThresholdCents?: number;
  readonly currency?: CurrencyCode;
}

export interface PaymentReconciliationRow {
  readonly rowId: string;
  readonly paymentId: string | null;
  readonly dueDate: ISODate | null;
  readonly paymentDate: ISODate | null;
  readonly actualPaidCents: number | null;
  readonly bankDueCents: number | null;
  readonly recalculatedDueCents: number | null;
  /** actualPaid − bankDue (see header for the sign convention). */
  readonly differenceVsBankCents: number | null;
  /** actualPaid − recalculatedDue. */
  readonly differenceVsRecalculatedCents: number | null;
  readonly status: ReconciliationRowStatus;
  readonly notes: readonly string[];
}

export interface PaymentReconciliationSummary {
  readonly totalActualPaidCents: number | null;
  readonly totalBankDueCents: number | null;
  readonly totalRecalculatedDueCents: number | null;
  readonly totalDifferenceVsBankCents: number | null;
  readonly totalDifferenceVsRecalculatedCents: number | null;
  readonly matchedPaymentCount: number;
  readonly unmatchedPaymentCount: number;
  readonly unmatchedDueCount: number;
  readonly rowsRequiringReviewCount: number;
  readonly excludedRowCount: number;
}

export interface PaymentReconciliationResult {
  readonly status: PaymentReconciliationStatus;
  readonly rows: readonly PaymentReconciliationRow[];
  readonly summary: PaymentReconciliationSummary | null;
  readonly unmatchedPayments: readonly ActualPayment[];
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

function daysBetween(a: ISODate, b: ISODate): number {
  const toMs = (d: ISODate): number =>
    Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.abs(Math.round((toMs(a) - toMs(b)) / 86_400_000));
}

/** A due "slot": bank row and/or recalc row sharing a due date. */
interface DueEntry {
  readonly dueDate: ISODate;
  readonly bank: BankScheduleRow | null;
  readonly recalc: RecalcRow | null;
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

export function reconcileActualPayments(
  input: PaymentReconciliationInput,
): PaymentReconciliationResult {
  const mode: ReconciliationMatchingMode = input.matchingMode ?? 'by_due_date';
  const tolerance = input.dateToleranceDays ?? 0;
  const threshold = input.materialityThresholdCents ?? 1;
  const bankRows = input.bankRows ?? [];
  const recalcRows = input.recalcRows ?? [];
  const target: ReconciliationTarget =
    input.target ??
    (bankRows.length > 0 && recalcRows.length > 0
      ? 'both'
      : bankRows.length > 0
        ? 'bank_schedule'
        : 'recalculated_schedule');

  const rawEntries: { rowRef: string; entry: AuditEntry }[] = [];
  const push = (rowRef: string, entry: AuditEntry): void => {
    rawEntries.push({ rowRef, entry });
  };

  const useBank = target === 'bank_schedule' || target === 'both';
  const useRecalc = target === 'recalculated_schedule' || target === 'both';

  /* --- empty inputs ----------------------------------------------------- */
  if (input.actualPayments.length === 0) {
    push('-', requiresReview(PR.RECON_PAYMENTS_EMPTY, 'Ελλείποντα δεδομένα: δεν δόθηκαν πραγματικές καταβολές προς συμφωνία καταβολών.'));
  }
  if ((useBank && bankRows.length === 0) || (useRecalc && recalcRows.length === 0)) {
    push('-', requiresReview(PR.RECON_TARGET_ROWS_MISSING, 'Ελλείποντα δεδομένα: δεν δόθηκαν γραμμές δοσολογίου για τον επιλεγμένο στόχο συμφωνίας καταβολών.'));
  }
  if (
    input.actualPayments.length === 0 ||
    (useBank && bankRows.length === 0) ||
    (useRecalc && recalcRows.length === 0)
  ) {
    return {
      status: 'missing_data',
      rows: [],
      summary: null,
      unmatchedPayments: input.actualPayments,
      unmatchedBankRows: bankRows,
      unmatchedRecalcRows: recalcRows,
      auditEntries: aggregate(rawEntries),
    };
  }

  /* --- due entries: merge bank + recalc by due date ----------------------- */
  const dueByDate = new Map<string, { bank: BankScheduleRow | null; recalc: RecalcRow | null }>();
  if (useBank) {
    for (const b of bankRows) {
      const slot = dueByDate.get(b.dueDate) ?? { bank: null, recalc: null };
      if (slot.bank !== null) {
        push(b.rowId, warning(PR.DUPLICATE_DUE_DATE, `Πολλαπλές γραμμές τράπεζας / fund με ημερομηνία ${b.dueDate}· χρησιμοποιείται η πρώτη και απαιτείται έλεγχος των υπολοίπων.`, { dueDate: b.dueDate }));
        continue;
      }
      slot.bank = b;
      dueByDate.set(b.dueDate, slot);
    }
  }
  if (useRecalc) {
    for (const r of recalcRows) {
      const slot = dueByDate.get(r.dueDate) ?? { bank: null, recalc: null };
      if (slot.recalc !== null) {
        push(r.rowId, warning(PR.DUPLICATE_DUE_DATE, `Πολλαπλές γραμμές επανυπολογισμού με ημερομηνία ${r.dueDate}· χρησιμοποιείται η πρώτη και απαιτείται έλεγχος των υπολοίπων.`, { dueDate: r.dueDate }));
        continue;
      }
      slot.recalc = r;
      dueByDate.set(r.dueDate, slot);
    }
  }
  const dueEntries: DueEntry[] = [...dueByDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([dueDate, slot]) => ({ dueDate: dueDate as ISODate, bank: slot.bank, recalc: slot.recalc }));

  const dueRef = (d: DueEntry): string => d.bank?.rowId ?? d.recalc?.rowId ?? d.dueDate;

  /* --- matching ------------------------------------------------------------ */
  const usedDue = new Set<string>(); // by dueDate
  const matches: { payment: ActualPayment; due: DueEntry }[] = [];
  const unmatchedPayments: ActualPayment[] = [];
  let ambiguous = false;
  let manualMissing = false;

  for (const payment of input.actualPayments) {
    if (mode === 'manual_match_id') {
      const targetId = payment.matchedScheduleRowId;
      if (targetId === null) {
        unmatchedPayments.push(payment);
        continue;
      }
      const due = dueEntries.find(
        (d) => !usedDue.has(d.dueDate) && (d.bank?.rowId === targetId || d.recalc?.rowId === targetId),
      );
      if (due === undefined) {
        manualMissing = true;
        push(payment.paymentId, requiresReview(PR.MANUAL_MATCH_ROW_MISSING, `Απαιτείται έλεγχος: η καταβολή ${payment.paymentId} παραπέμπει σε γραμμή δοσολογίου (${targetId}) που δεν υπάρχει στα δεδομένα συμφωνίας καταβολών.`, { paymentId: payment.paymentId, matchedScheduleRowId: targetId }));
        unmatchedPayments.push(payment);
        continue;
      }
      usedDue.add(due.dueDate);
      matches.push({ payment, due });
      continue;
    }

    const candidates = dueEntries.filter((d) => {
      if (usedDue.has(d.dueDate)) return false;
      const distance = daysBetween(payment.date, d.dueDate);
      return mode === 'by_due_date'
        ? distance === 0 || (tolerance > 0 && distance <= tolerance)
        : distance <= tolerance;
    });

    if (candidates.length === 0) {
      unmatchedPayments.push(payment);
      continue;
    }

    let chosen: DueEntry;
    if (mode === 'by_payment_date_window') {
      // nearest due date; equal-distance ties are ambiguous
      const sorted = [...candidates].sort(
        (a, b) => daysBetween(payment.date, a.dueDate) - daysBetween(payment.date, b.dueDate),
      );
      const best = daysBetween(payment.date, sorted[0]!.dueDate);
      const ties = sorted.filter((d) => daysBetween(payment.date, d.dueDate) === best);
      if (ties.length > 1) {
        ambiguous = true;
        push(payment.paymentId, requiresReview(PR.AMBIGUOUS_PAYMENT_MATCH, `Απαιτείται έλεγχος: ${ties.length} ισαπέχουσες ημερομηνίες δόσης για την καταβολή ${payment.paymentId} (${payment.date})· η αντιστοίχιση δεν είναι μονοσήμαντη.`, { paymentId: payment.paymentId, candidates: ties.length }));
        unmatchedPayments.push(payment);
        continue;
      }
      chosen = sorted[0]!;
    } else {
      // by_due_date: exact first, then unique tolerance candidate
      const exact = candidates.filter((d) => daysBetween(payment.date, d.dueDate) === 0);
      const pool = exact.length > 0 ? exact : candidates;
      if (pool.length > 1) {
        ambiguous = true;
        push(payment.paymentId, requiresReview(PR.AMBIGUOUS_PAYMENT_MATCH, `Απαιτείται έλεγχος: ${pool.length} υποψήφιες ημερομηνίες δόσης για την καταβολή ${payment.paymentId} (${payment.date})· η αντιστοίχιση δεν είναι μονοσήμαντη.`, { paymentId: payment.paymentId, candidates: pool.length }));
        unmatchedPayments.push(payment);
        continue;
      }
      chosen = pool[0]!;
    }

    usedDue.add(chosen.dueDate);
    matches.push({ payment, due: chosen });
  }

  /* --- rows ------------------------------------------------------------------ */
  const rows: PaymentReconciliationRow[] = [];
  let seq = 0;
  const nextId = (): string => `PR-${String(++seq).padStart(3, '0')}`;

  let materialCount = 0;
  let excludedCount = 0;

  for (const { payment, due } of matches) {
    const notes: string[] = [];
    const actualPaid = centsOf(payment.amount as NullableMoney);
    const bankDue = useBank ? centsOf(due.bank?.installmentAmount) : null;
    const recalcDue = useRecalc ? centsOf(due.recalc?.installment as NullableMoney | undefined) : null;
    const rowId = nextId();
    const rowRef = `${payment.paymentId}↔${dueRef(due)}`;

    let rowStatus: ReconciliationRowStatus = 'matched';
    let excluded = false;

    if (actualPaid === null) {
      push(rowRef, requiresReview(PR.PAYMENT_AMOUNT_MISSING, 'Ελλείποντα δεδομένα: μη διαθέσιμο ποσό πραγματικής καταβολής· οι διαφορές δεν υπολογίζονται και δεν αντικαθίστανται από μηδέν.', { paymentId: payment.paymentId }));
      notes.push('Ελλείποντα δεδομένα ποσού καταβολής.');
      rowStatus = 'missing_data';
      excluded = true;
    }
    if (useBank && bankDue === null) {
      push(rowRef, warning(PR.BANK_VALUE_MISSING, 'Ελλείποντα δεδομένα τράπεζας / fund: μη διαθέσιμο ποσό δόσης· η διαφορά πραγματικής καταβολής έναντι τράπεζας δεν υπολογίζεται.', { dueDate: due.dueDate }));
      notes.push('Ελλείποντα δεδομένα δόσης τράπεζας / fund.');
      excluded = true;
      if (rowStatus === 'matched') rowStatus = 'missing_data';
    }
    if (useRecalc && recalcDue === null) {
      push(rowRef, warning(PR.RECALC_VALUE_MISSING, 'Ελλείποντα δεδομένα επανυπολογισμού: μη διαθέσιμο ποσό δόσης· η διαφορά πραγματικής καταβολής έναντι επανυπολογισμού δεν υπολογίζεται.', { dueDate: due.dueDate }));
      notes.push('Ελλείποντα δεδομένα δόσης επανυπολογισμού.');
      excluded = true;
      if (rowStatus === 'matched') rowStatus = 'missing_data';
    }

    // sign convention of THIS engine: actual paid − target due
    const diffBank = actualPaid !== null && bankDue !== null ? actualPaid - bankDue : null;
    const diffRecalc = actualPaid !== null && recalcDue !== null ? actualPaid - recalcDue : null;

    const material =
      (diffBank !== null && Math.abs(diffBank) > threshold) ||
      (diffRecalc !== null && Math.abs(diffRecalc) > threshold);
    if (material) {
      materialCount += 1;
      notes.push('Διαφορά πραγματικής καταβολής άνω του κατωφλίου σημαντικότητας· απαιτείται έλεγχος.');
    } else if ((diffBank !== null && diffBank !== 0) || (diffRecalc !== null && diffRecalc !== 0)) {
      notes.push('Διαφορά πραγματικής καταβολής εντός κατωφλίου σημαντικότητας (στρογγυλοποίηση).');
    } else if (rowStatus === 'matched') {
      notes.push('Συμφωνία καταβολών.');
    }

    if (excluded) excludedCount += 1;

    rows.push({
      rowId,
      paymentId: payment.paymentId,
      dueDate: due.dueDate,
      paymentDate: payment.date,
      actualPaidCents: actualPaid,
      bankDueCents: bankDue,
      recalculatedDueCents: recalcDue,
      differenceVsBankCents: diffBank,
      differenceVsRecalculatedCents: diffRecalc,
      status: rowStatus,
      notes,
    });
  }

  if (materialCount > 0) {
    push('-', requiresReview(PR.PAYMENT_DIFFERENCE_MATERIAL, `Απαιτείται έλεγχος: ${materialCount} καταβολές με διαφορά πραγματικής καταβολής άνω του κατωφλίου σημαντικότητας (${threshold} λεπτά).`, { materialRowCount: materialCount, thresholdCents: threshold }));
  }

  /* --- unmatched payments as rows ----------------------------------------- */
  for (const payment of unmatchedPayments) {
    push(payment.paymentId, warning(PR.UNMATCHED_PAYMENT, 'Ελλείποντα δεδομένα αντιστοίχισης: πραγματική καταβολή χωρίς αντίστοιχη γραμμή δοσολογίου.', { paymentId: payment.paymentId, date: payment.date }));
    rows.push({
      rowId: nextId(),
      paymentId: payment.paymentId,
      dueDate: null,
      paymentDate: payment.date,
      actualPaidCents: centsOf(payment.amount as NullableMoney),
      bankDueCents: null,
      recalculatedDueCents: null,
      differenceVsBankCents: null,
      differenceVsRecalculatedCents: null,
      status: 'unmatched_payment',
      notes: ['Μη αντιστοιχισμένη πραγματική καταβολή· απαιτείται έλεγχος.'],
    });
  }

  /* --- unmatched due rows: an unpaid slot is NOT a zero payment ------------ */
  const unmatchedBankRows: BankScheduleRow[] = [];
  const unmatchedRecalcRows: RecalcRow[] = [];
  let unmatchedDueCount = 0;
  for (const due of dueEntries) {
    if (usedDue.has(due.dueDate)) continue;
    unmatchedDueCount += 1;
    if (due.bank) unmatchedBankRows.push(due.bank);
    if (due.recalc) unmatchedRecalcRows.push(due.recalc);
    push(dueRef(due), warning(PR.UNMATCHED_DUE_ROW, 'Γραμμή δοσολογίου χωρίς αντιστοιχισμένη πραγματική καταβολή· δεν τεκμαίρεται μηδενική καταβολή χωρίς ρητό στοιχείο.', { dueDate: due.dueDate }));
    rows.push({
      rowId: nextId(),
      paymentId: null,
      dueDate: due.dueDate,
      paymentDate: null,
      actualPaidCents: null, // never an assumed zero
      bankDueCents: useBank ? centsOf(due.bank?.installmentAmount) : null,
      recalculatedDueCents: useRecalc ? centsOf(due.recalc?.installment as NullableMoney | undefined) : null,
      differenceVsBankCents: null,
      differenceVsRecalculatedCents: null,
      status: 'unmatched_due',
      notes: ['Δόση χωρίς αντιστοιχισμένη καταβολή· απαιτείται έλεγχος.'],
    });
  }

  /* --- summary: totals only where both sides exist -------------------------- */
  const sumOf = (pick: (r: PaymentReconciliationRow) => number | null): number | null => {
    const usable = rows.filter((r) => pick(r) !== null);
    return usable.length === 0 ? null : usable.reduce((s, r) => s + (pick(r) as number), 0);
  };

  const summary: PaymentReconciliationSummary = {
    totalActualPaidCents: sumOf((r) => r.actualPaidCents),
    totalBankDueCents: useBank ? sumOf((r) => (r.status === 'matched' || r.status === 'missing_data' ? r.bankDueCents : null)) : null,
    totalRecalculatedDueCents: useRecalc ? sumOf((r) => (r.status === 'matched' || r.status === 'missing_data' ? r.recalculatedDueCents : null)) : null,
    totalDifferenceVsBankCents: sumOf((r) => r.differenceVsBankCents),
    totalDifferenceVsRecalculatedCents: sumOf((r) => r.differenceVsRecalculatedCents),
    matchedPaymentCount: matches.length,
    unmatchedPaymentCount: unmatchedPayments.length,
    unmatchedDueCount,
    rowsRequiringReviewCount: materialCount,
    excludedRowCount: excludedCount,
  };

  /* --- status ------------------------------------------------------------------ */
  const needsReview =
    unmatchedPayments.length > 0 ||
    unmatchedDueCount > 0 ||
    ambiguous ||
    manualMissing ||
    excludedCount > 0 ||
    materialCount > 0;

  return {
    status: needsReview ? 'requires_review' : 'success',
    rows,
    summary,
    unmatchedPayments,
    unmatchedBankRows,
    unmatchedRecalcRows,
    auditEntries: aggregate(rawEntries),
  };
}
