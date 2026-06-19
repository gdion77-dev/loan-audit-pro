/**
 * Loan Audit PRO — src/engines/balloonScheduleEngine.ts
 * ------------------------------------------------------------------
 * Balloon (residual-payment) amortization schedule.
 *
 * Structure (confirmed): the first (term − 1) installments are level
 * annuity payments computed so the balance amortizes DOWN TO the
 * balloon amount (not to zero) by maturity; the FINAL installment then
 * pays the last regular amount PLUS the balloon residual, closing the
 * balance to exactly zero. Interest each period accrues on the CURRENT
 * balance, which starts at the FULL principal (the balloon part bears
 * interest until it is paid at the end).
 *
 * DESIGN — no locked financial formula is duplicated here:
 *   • period interest comes only from calculateAccruedInterest,
 *   • day count comes only from calculateDayCount,
 *   • the applied rate comes only from resolveRateForDate,
 *   • each row is built only via buildSingleRecalcRow.
 * The only thing added is the annuity-with-balloon identity used to set
 * the level installment, which is standard finance, not an
 * interest/day-count rule.
 */

import {
  isValidISODate,
  type ISODate,
  type DayCountConvention,
} from '../domain/dateTypes';
import type { RateConfig } from '../domain/rateTypes';
import type { CurrencyCode } from '../domain/money';
import type { RecalcRow } from '../domain/scheduleTypes';
import { createAuditEntry, type AuditEntry } from '../domain/auditTypes';
import { info, requiresReview } from '../domain/auditFactories';
import { resolveRateForDate } from './rateEngine';
import { calculateDayCount } from './dayCountEngine';
import { calculateAccruedInterest, type RoundingMode } from './interestAccrualEngine';
import { buildSingleRecalcRow } from './recalcRowBuilder';

export const BALLOON_SCHEDULE_AUDIT_CODES = {
  BL_PRINCIPAL_MISSING: 'BL_PRINCIPAL_MISSING',
  BL_PRINCIPAL_EXPLICIT_ZERO: 'BL_PRINCIPAL_EXPLICIT_ZERO',
  BL_TERM_MISSING: 'BL_TERM_MISSING',
  BL_TERM_INVALID: 'BL_TERM_INVALID',
  BL_DATES_INVALID: 'BL_DATES_INVALID',
  BL_BALLOON_INVALID: 'BL_BALLOON_INVALID',
  BL_RATE_NOT_RESOLVED: 'BL_RATE_NOT_RESOLVED',
  BL_NEGATIVE_AMORTIZATION_REQUIRES_REVIEW: 'BL_NEGATIVE_AMORTIZATION_REQUIRES_REVIEW',
  BL_FINAL_ROW_ADJUSTED: 'BL_FINAL_ROW_ADJUSTED',
  BL_BALLOON_APPLIED: 'BL_BALLOON_APPLIED',
  BL_SCHEDULE_ABORTED_AT_ROW: 'BL_SCHEDULE_ABORTED_AT_ROW',
  BL_EARLY_PAYOFF_REQUIRES_REVIEW: 'BL_EARLY_PAYOFF_REQUIRES_REVIEW',
} as const;

const BL = BALLOON_SCHEDULE_AUDIT_CODES;

export type BalloonScheduleStatus = 'success' | 'requires_review' | 'missing_data';

export interface BalloonScheduleInput {
  readonly principalCents: number | null;
  readonly termPeriods: number | null;
  readonly firstPeriodStartDate: ISODate;
  readonly firstDueDate: ISODate;
  readonly paymentFrequency: 'monthly';
  readonly rateConfig: RateConfig;
  readonly dayCountConvention: DayCountConvention;
  /** Residual amount paid as a lump sum with the final installment. */
  readonly balloonAmountCents: number | null;
  readonly feesAndPremiumsPerPeriodCents?: number | null;
  readonly roundingMode?: RoundingMode;
  readonly currency?: CurrencyCode;
}

export interface BalloonScheduleResult {
  readonly status: BalloonScheduleStatus;
  readonly rows: readonly RecalcRow[];
  /** The level installment used for the non-final periods. */
  readonly levelInstallmentCents: number | null;
  /** The balloon residual added to the final installment. */
  readonly balloonAmountCents: number | null;
  readonly totalPrincipalCents: number | null;
  readonly totalInterestCents: number | null;
  readonly totalFeesCents: number | null;
  readonly totalInstallmentsCents: number | null;
  readonly finalClosingBalanceCents: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

function addOneMonthClamped(date: ISODate): ISODate {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const targetY = m === 12 ? y + 1 : y;
  const targetM = m === 12 ? 1 : m + 1;
  const daysInTarget = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();
  const clampedD = Math.min(d, daysInTarget);
  return `${targetY}-${String(targetM).padStart(2, '0')}-${String(clampedD).padStart(2, '0')}` as ISODate;
}

function aggregateAuditEntries(
  perRow: ReadonlyArray<{ rowId: string; entries: readonly AuditEntry[] }>,
): AuditEntry[] {
  const byKey = new Map<string, { entry: AuditEntry; rowIds: string[] }>();
  const order: string[] = [];
  for (const { rowId, entries } of perRow) {
    for (const e of entries) {
      const key = `${e.severity}|${e.code}|${e.message}`;
      const existing = byKey.get(key);
      if (existing) existing.rowIds.push(rowId);
      else {
        byKey.set(key, { entry: e, rowIds: [rowId] });
        order.push(key);
      }
    }
  }
  return order.map((key) => {
    const { entry, rowIds } = byKey.get(key)!;
    return createAuditEntry({
      severity: entry.severity,
      code: entry.code,
      message: entry.message,
      context: { ...(entry.context ?? {}), rowIds, occurrences: rowIds.length },
    });
  });
}

/**
 * Level installment for an annuity that amortizes from `balanceCents`
 * down to `balloonCents` over `n` periods at monthly rate `r`:
 *   pay = (PV − B·(1+r)^−n) · r / (1 − (1+r)^−n)
 * With r = 0 it is the straight-line amortization of (PV − B).
 */
function balloonInstallmentCents(
  balanceCents: number,
  balloonCents: number,
  monthlyRate: number,
  periods: number,
): number {
  if (periods <= 0) return balanceCents;
  if (monthlyRate === 0) {
    return Math.round((balanceCents - balloonCents) / periods);
  }
  const disc = Math.pow(1 + monthlyRate, -periods);
  const raw = ((balanceCents - balloonCents * disc) * monthlyRate) / (1 - disc);
  return Math.round(raw);
}

export function buildBalloonSchedule(input: BalloonScheduleInput): BalloonScheduleResult {
  const scheduleEntries: AuditEntry[] = [];
  const currency: CurrencyCode = input.currency ?? 'EUR';

  const emptyResult = (
    status: BalloonScheduleStatus,
    rows: readonly RecalcRow[] = [],
    entries: readonly AuditEntry[] = scheduleEntries,
    level: number | null = null,
  ): BalloonScheduleResult => ({
    status,
    rows,
    levelInstallmentCents: level,
    balloonAmountCents: input.balloonAmountCents,
    totalPrincipalCents: null,
    totalInterestCents: null,
    totalFeesCents: null,
    totalInstallmentsCents: null,
    finalClosingBalanceCents: null,
    auditEntries: entries,
  });

  // --- validation -----------------------------------------------------
  if (input.principalCents === null) {
    scheduleEntries.push(requiresReview(BL.BL_PRINCIPAL_MISSING, 'Ελλιπή δεδομένα: μη διαθέσιμο κεφάλαιο. Το πρόγραμμα δεν παράγεται· το ελλείπον δεν αντικαθίσταται από μηδέν.'));
    return emptyResult('missing_data');
  }
  if (input.termPeriods === null) {
    scheduleEntries.push(requiresReview(BL.BL_TERM_MISSING, 'Ελλιπή δεδομένα: μη διαθέσιμη διάρκεια (πλήθος περιόδων). Το πρόγραμμα δεν παράγεται.'));
    return emptyResult('missing_data');
  }
  if (!Number.isSafeInteger(input.termPeriods) || input.termPeriods <= 0) {
    scheduleEntries.push(requiresReview(BL.BL_TERM_INVALID, `Ασυνέπεια δεδομένων: μη έγκυρη διάρκεια (${String(input.termPeriods)} περίοδοι).`));
    return emptyResult('requires_review');
  }
  if (!Number.isSafeInteger(input.principalCents) || input.principalCents < 0) {
    scheduleEntries.push(requiresReview(BL.BL_PRINCIPAL_MISSING, `Ασυνέπεια δεδομένων: μη έγκυρο κεφάλαιο (${String(input.principalCents)} λεπτά).`));
    return emptyResult('requires_review');
  }
  if (!isValidISODate(input.firstPeriodStartDate) || !isValidISODate(input.firstDueDate)) {
    scheduleEntries.push(requiresReview(BL.BL_DATES_INVALID, 'Ελλιπή δεδομένα: μη έγκυρη ημερομηνία έναρξης πρώτης περιόδου ή πρώτης δόσης.'));
    return emptyResult('missing_data');
  }
  const balloon = input.balloonAmountCents;
  if (balloon === null) {
    scheduleEntries.push(requiresReview(BL.BL_BALLOON_INVALID, 'Ελλιπή δεδομένα: μη δηλωμένο ποσό εφάπαξ καταβολής (balloon). Το πρόγραμμα δεν παράγεται.'));
    return emptyResult('missing_data');
  }
  if (!Number.isSafeInteger(balloon) || balloon < 0) {
    scheduleEntries.push(requiresReview(BL.BL_BALLOON_INVALID, `Ασυνέπεια δεδομένων: μη έγκυρο ποσό εφάπαξ καταβολής (${String(balloon)} λεπτά).`));
    return emptyResult('requires_review');
  }
  if (balloon >= input.principalCents && input.principalCents > 0) {
    scheduleEntries.push(requiresReview(BL.BL_BALLOON_INVALID, `Ασυνέπεια δεδομένων: το ποσό εφάπαξ καταβολής (${balloon} λεπτά) δεν μπορεί να ισούται ή να υπερβαίνει το κεφάλαιο (${input.principalCents} λεπτά).`));
    return emptyResult('requires_review');
  }

  if (input.principalCents === 0) {
    scheduleEntries.push(info(BL.BL_PRINCIPAL_EXPLICIT_ZERO, 'Πληροφορία: ρητά μηδενικό κεφάλαιο· παράγεται κενό πρόγραμμα με μηδενικά σύνολα.'));
    return {
      status: 'success',
      rows: [],
      levelInstallmentCents: 0,
      balloonAmountCents: balloon,
      totalPrincipalCents: 0,
      totalInterestCents: 0,
      totalFeesCents: 0,
      totalInstallmentsCents: 0,
      finalClosingBalanceCents: 0,
      auditEntries: scheduleEntries,
    };
  }

  const term = input.termPeriods;
  const fees = input.feesAndPremiumsPerPeriodCents ?? null;
  const feesForPayment = fees === null ? 0 : fees;

  // Level installment from the first period's rate (annuity-with-balloon).
  const firstRate = resolveRateForDate(input.rateConfig, input.firstDueDate);
  if (firstRate.status !== 'success' || firstRate.appliedAnnualRatePercent === null) {
    scheduleEntries.push(
      requiresReview(BL.BL_RATE_NOT_RESOLVED, `Απαιτείται έλεγχος: δεν επιλύεται εφαρμοζόμενο επιτόκιο για την πρώτη περίοδο (${input.firstDueDate})· η δόση δεν υπολογίζεται.`),
    );
    return emptyResult(firstRate.status === 'missing_data' ? 'missing_data' : 'requires_review');
  }
  const monthlyRate = (firstRate.appliedAnnualRatePercent as number) / 100 / 12;
  const levelInstallment = balloonInstallmentCents(input.principalCents, balloon, monthlyRate, term);

  scheduleEntries.push(
    info(
      BL.BL_BALLOON_APPLIED,
      `Πληροφορία: balloon δοσολόγιο — οι ${term - 1} πρώτες δόσεις είναι σταθερές (${levelInstallment} λεπτά) ώστε το υπόλοιπο να απομειωθεί στο ποσό εφάπαξ καταβολής (${balloon} λεπτά)· η τελευταία δόση περιλαμβάνει το ποσό αυτό. Οι τόκοι υπολογίζονται επί του τρέχοντος υπολοίπου.`,
      { levelInstallmentCents: levelInstallment, balloonCents: balloon, termPeriods: term },
    ),
  );

  const rows: RecalcRow[] = [];
  const perRowEntries: { rowId: string; entries: readonly AuditEntry[] }[] = [];
  let openingBalance = input.principalCents;
  let periodStart = input.firstPeriodStartDate;
  let dueDate = input.firstDueDate;
  let totalInterest = 0;
  let totalFees = 0;
  let totalInstallments = 0;
  let anyRequiresReview = false;

  for (let i = 0; i < term; i++) {
    const rowId = `BL-${String(i + 1).padStart(3, '0')}`;
    const isFinal = i === term - 1;
    const rate = resolveRateForDate(input.rateConfig, dueDate);

    const dayCount = calculateDayCount(periodStart, dueDate, input.dayCountConvention);
    const accrual = calculateAccruedInterest({
      openingBalanceCents: openingBalance,
      rateResolution: rate,
      dayCount,
      ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
      currency,
    });

    if (accrual.interestCents === null) {
      perRowEntries.push({ rowId, entries: accrual.auditEntries });
      scheduleEntries.push(
        requiresReview(BL.BL_SCHEDULE_ABORTED_AT_ROW, `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): μη υπολογίσιμος τόκος περιόδου. Οι προηγούμενες γραμμές διατηρούνται· τα σύνολα δεν οριστικοποιούνται.`, { rowId, period: i + 1, dueDate }),
      );
      return emptyResult(
        accrual.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        levelInstallment,
      );
    }

    // Non-final negative-amortization guard.
    if (!isFinal && levelInstallment < accrual.interestCents + feesForPayment) {
      perRowEntries.push({ rowId, entries: accrual.auditEntries });
      scheduleEntries.push(
        requiresReview(
          BL.BL_NEGATIVE_AMORTIZATION_REQUIRES_REVIEW,
          `Απαιτείται έλεγχος: στην περίοδο ${i + 1} (${dueDate}) η σταθερή δόση (${levelInstallment} λεπτά) υπολείπεται των τόκων και εξόδων περιόδου (${accrual.interestCents + feesForPayment} λεπτά). Ο μη καταβληθείς τόκος ΔΕΝ κεφαλαιοποιείται σιωπηρά· το πρόγραμμα διακόπτεται.`,
          { rowId, period: i + 1, dueDate, installmentCents: levelInstallment, interestPlusFeesCents: accrual.interestCents + feesForPayment },
        ),
      );
      return emptyResult(
        'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        levelInstallment,
      );
    }

    // Payment for the row: level for non-final; final pays the remaining
    // balance + interest + fees (which equals the last regular payment
    // plus the balloon residual), closing to exactly zero.
    let paymentForRow = levelInstallment;
    if (isFinal) {
      paymentForRow = openingBalance + accrual.interestCents + feesForPayment;
      scheduleEntries.push(
        info(
          BL.BL_FINAL_ROW_ADJUSTED,
          `Πληροφορία: η τελική δόση (${paymentForRow} λεπτά) περιλαμβάνει το ποσό εφάπαξ καταβολής (${balloon} λεπτά) ώστε το υπόλοιπο να κλείσει ακριβώς στο μηδέν.`,
          { rowId, finalPaymentCents: paymentForRow, balloonCents: balloon },
        ),
      );
    }

    const built = buildSingleRecalcRow({
      rowId,
      periodStartDate: periodStart,
      dueDate,
      openingBalanceCents: openingBalance,
      paymentAmountCents: paymentForRow,
      feesAndPremiumsCents: fees,
      rateConfig: input.rateConfig,
      dayCountConvention: input.dayCountConvention,
      ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
      currency,
    });

    perRowEntries.push({ rowId, entries: built.auditEntries });

    if (built.row === null) {
      scheduleEntries.push(
        requiresReview(BL.BL_SCHEDULE_ABORTED_AT_ROW, `Το πρόγραμμα διακόπηκε στην περίοδο ${i + 1} (${dueDate}): η γραμμή δεν μπόρεσε να παραχθεί με ασφάλεια.`, { rowId, period: i + 1, dueDate }),
      );
      return emptyResult(
        built.status === 'missing_data' ? 'missing_data' : 'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        levelInstallment,
      );
    }

    if (built.status === 'requires_review') anyRequiresReview = true;

    rows.push(built.row);
    totalInterest += built.row.interest.cents;
    totalFees += built.allocation?.feesAndPremiumsDueCents ?? 0;
    totalInstallments += built.row.installment.cents;

    // Early-payoff guard: balance must not reach zero before the final row.
    if (built.row.closingBalance.cents === 0 && !isFinal) {
      scheduleEntries.push(
        requiresReview(
          BL.BL_EARLY_PAYOFF_REQUIRES_REVIEW,
          `Απαιτείται έλεγχος: το υπόλοιπο μηδενίστηκε στην περίοδο ${i + 1} από ${term}, πριν από τη λήξη. Το πρόγραμμα διακόπτεται και τα σύνολα δεν οριστικοποιούνται.`,
          { rowId, period: i + 1, termPeriods: term },
        ),
      );
      return emptyResult(
        'requires_review',
        rows,
        [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
        levelInstallment,
      );
    }

    openingBalance = built.row.closingBalance.cents;
    periodStart = dueDate;
    dueDate = addOneMonthClamped(dueDate);
  }

  return {
    status: anyRequiresReview ? 'requires_review' : 'success',
    rows,
    levelInstallmentCents: levelInstallment,
    balloonAmountCents: balloon,
    totalPrincipalCents: input.principalCents - openingBalance,
    totalInterestCents: totalInterest,
    totalFeesCents: totalFees,
    totalInstallmentsCents: totalInstallments,
    finalClosingBalanceCents: openingBalance,
    auditEntries: [...aggregateAuditEntries(perRowEntries), ...scheduleEntries],
  };
}
