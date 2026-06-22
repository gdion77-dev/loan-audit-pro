/**
 * Loan Audit PRO — src/engines/actualPaymentsAmortizationEngine.ts
 * ------------------------------------------------------------------
 * Builds a PARALLEL amortization track driven by the debtor's ACTUAL
 * payments, separate from the theoretical recalculated schedule
 * (equalInstallmentScheduleEngine.ts, LOCKED — not modified here).
 *
 * KEY MODELLING PRINCIPLE (confirmed with the user 2026-06-16):
 * Each due installment is, BY DEFAULT, assumed paid normally (its
 * exact amount, exactly on its due date) UNLESS the caller marks it
 * as having an explicit recorded exception (`hasRecordedException`).
 * The UI records ONLY the deviations (smaller amount, and/or late
 * date, and/or an explicit zero meaning "not paid"); everything else
 * is treated as a clean, on-time payment that reduces principal
 * normally and produces no arrears. This matches how an auditor
 * actually works: list the exceptions, assume the rest is regular.
 *
 * LEGAL / METHODOLOGY (all confirmed, including a researched round on
 * the default-interest base):
 *
 *   1. PAYMENT ALLOCATION ORDER — ΑΚ 423 (mandatory, fixed):
 *      (a) carried-over unpaid DEFAULT interest, (b) carried-over
 *      unpaid CONTRACTUAL interest (oldest first — ΑΚ 422),
 *      (c) this period's contractual interest, (d) overdue PRINCIPAL,
 *      (e) only the remainder reduces current principal. The debtor
 *      cannot redirect a payment to principal ahead of interest.
 *
 *   2. DEFAULT-INTEREST BASE — Άρθρο 345 ΑΚ + ΑΚ 296 (CRITICAL):
 *      Default (late) interest accrues ONLY on overdue unpaid
 *      PRINCIPAL (plus any interest that has been LAWFULLY
 *      capitalized). It NEVER accrues on unpaid regular interest or
 *      on unpaid default interest — doing so would be ανατοκισμός,
 *      forbidden without an explicit, lawful clause (ΑΚ 296). Unpaid
 *      interest is held as a separate claim and only enters the
 *      default-interest base if/when capitalized.
 *
 *   3. CONTINUING ACCRUAL:
 *      Overdue principal keeps accruing default interest every period
 *      it remains unpaid (not only for the single period of its own
 *      installment), day-counted across each period, until settled.
 *
 *   4. DEFAULT-INTEREST RATE:
 *      Contractual annual rate + a surcharge in percentage points.
 *      The surcharge is NEVER hard-coded (2.5 points is the ΠΔ/ΤΕ
 *      2393/96 regulatory CEILING, not a default). null = not
 *      declared → no default interest is computed; rows that have
 *      overdue principal are flagged requires_review.
 *
 *   5. SEMI-ANNUAL CAPITALIZATION (ανατοκισμός) — NOT automatic:
 *      Only when capitalizeLateInterestSemiAnnually=true (an explicit,
 *      lawful, case-specific contractual basis — Ν.2601/1998 άρθρο
 *      12) does accumulated unpaid interest fold into the
 *      default-interest base, once per elapsed 6-month block from the
 *      first due date. Without it, capitalization never happens
 *      (ΑΚ 296), and a warning is emitted whenever unpaid interest
 *      exists but is (correctly) excluded from the default base.
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026.
 *   - Modifies no locked engine. Reuses calculateDayCount (read-only)
 *     for date math; reimplements the documented interest formula
 *     (base × rate/100 × fractionOfYear, half-up cents) locally.
 *   - Null discipline: missing input is null, never coerced to zero;
 *     an explicit zero payment is data ("not paid").
 *   - Neutral wording only; no legal-conclusion language.
 */
import type { ISODate } from '../domain/dateTypes';
import type { CurrencyCode } from '../domain/money';
import type { AuditEntry } from '../domain/auditTypes';
import { info, requiresReview, warning } from '../domain/auditFactories';
import { calculateDayCount } from './dayCountEngine';
import type { DayCountConvention } from '../domain/dateTypes';

/* ------------------------------------------------------------------ */
/* Audit codes                                                         */
/* ------------------------------------------------------------------ */

export const ACTUAL_PAYMENTS_AMORTIZATION_AUDIT_CODES = {
  DEFAULT_INTEREST_ACCRUED: 'DEFAULT_INTEREST_ACCRUED',
  DEFAULT_INTEREST_SURCHARGE_MISSING: 'DEFAULT_INTEREST_SURCHARGE_MISSING',
  UNPAID_INTEREST_EXCLUDED_FROM_BASE: 'UNPAID_INTEREST_EXCLUDED_FROM_BASE',
  INTEREST_UNDERPAID_CARRIED_FORWARD: 'INTEREST_UNDERPAID_CARRIED_FORWARD',
  PAYMENT_ALLOCATED: 'PAYMENT_ALLOCATED',
  INSTALLMENT_OVERPAID: 'INSTALLMENT_OVERPAID',
  SEMIANNUAL_CAPITALIZATION_APPLIED: 'SEMIANNUAL_CAPITALIZATION_APPLIED',
} as const;

const AC = ACTUAL_PAYMENTS_AMORTIZATION_AUDIT_CODES;

/* ------------------------------------------------------------------ */
/* Input types                                                         */
/* ------------------------------------------------------------------ */

/** One contractually-due installment from the theoretical schedule. */
export interface DueInstallment {
  readonly rowId: string;
  readonly dueDate: ISODate;
  readonly installmentCents: number;
  /** Theoretical contractual interest for this period — read-only reference. */
  readonly interestCents: number;
  /** Theoretical contractual principal for this period — read-only reference. */
  readonly principalCents: number;
  /**
   * Whether the user recorded an explicit actual-payment exception
   * for this installment. false → assume a clean, on-time, full
   * payment (no arrears). true → use the recorded payment(s), which
   * may be smaller, late, or an explicit zero (not paid).
   */
  readonly hasRecordedException: boolean;
  /**
   * Extra non-amortising charges falling due in THIS period (e.g.
   * insurance premiums, legal costs). They increase the amount owed
   * for the period and, if unpaid, roll into overdue principal and
   * accrue default interest exactly like principal. Optional; absent
   * or 0 means no extra charge. Never assumed.
   */
  readonly extraChargesCents?: number;
}

/** One actual payment made by the debtor. */
export interface ActualPaymentInput {
  readonly paymentId: string;
  readonly paymentDate: ISODate;
  readonly amountCents: number;
  /** Which due installment this payment is allocated against. */
  readonly matchedRowId: string;
}

export interface ActualPaymentsAmortizationConfig {
  readonly openingPrincipalCents: number;
  readonly contractualAnnualRatePercent: number;
  readonly dayCountConvention: DayCountConvention;
  /**
   * Surcharge in percentage points added to the contractual rate to
   * obtain the default-interest rate. null = not declared → no
   * default interest is computed; rows with overdue principal are
   * flagged requires_review (never a silent 0 or ceiling value).
   */
  readonly lateInterestSurchargePercent: number | null;
  /** Default false — see methodology note 5 above. */
  readonly capitalizeLateInterestSemiAnnually?: boolean;
  readonly currency?: CurrencyCode;
}

/* ------------------------------------------------------------------ */
/* Result types                                                       */
/* ------------------------------------------------------------------ */

export type ActualAmortizationRowStatus =
  | 'settled_on_time'
  | 'settled_late'
  | 'partially_settled'
  | 'unsettled'
  | 'requires_review';

export interface ActualAmortizationRow {
  readonly rowId: string;
  readonly dueDate: ISODate;
  readonly installmentCents: number;
  readonly contractualInterestCents: number;
  /** Sum of actual payments allocated against this installment. */
  readonly paidCents: number;
  /** Extra non-amortising charges (insurance, legal, etc.) due this period. */
  readonly extraChargesCents: number;
  readonly lastPaymentDate: ISODate | null;
  /** Default interest accrued during THIS period on outstanding overdue principal. */
  readonly defaultInterestAccruedCents: number | null;
  /** Days the overdue principal accrued default interest in this period. */
  readonly defaultInterestDays: number | null;
  /** Portion of payment(s) allocated to interest (default + contractual), per ΑΚ 423. */
  readonly appliedToInterestCents: number;
  /** Portion of payment(s) allocated to principal. */
  readonly appliedToPrincipalCents: number;
  /** Outstanding overdue PRINCIPAL carried into the next period (default-interest base). */
  readonly overduePrincipalCents: number;
  /** Outstanding unpaid INTEREST (contractual + default) carried forward — NOT in the default base. */
  readonly unpaidInterestCarryForwardCents: number;
  readonly status: ActualAmortizationRowStatus;
  /** Real (actual-payment-driven) closing PRINCIPAL balance after this row. */
  readonly actualClosingBalanceCents: number;
}

export interface ActualPaymentsAmortizationResult {
  readonly status: 'success' | 'requires_review' | 'missing_data';
  readonly rows: readonly ActualAmortizationRow[];
  readonly totalLateInterestCents: number | null;
  /** Unpaid interest still outstanding after the last row. */
  readonly finalUnpaidInterestCents: number;
  /** Overdue principal still outstanding after the last row. */
  readonly finalOverduePrincipalCents: number;
  readonly finalActualBalanceCents: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function roundHalfUpCents(rawCents: number): number {
  return Math.sign(rawCents) * Math.round(Math.abs(rawCents));
}

/** Interest on a base for the days between two dates (start excluded, end included). */
function accrueInterestOnBase(
  baseCents: number,
  fromExclusive: ISODate,
  toInclusive: ISODate,
  ratePercent: number,
  dayCountConvention: DayCountConvention,
): { cents: number; days: number | null; auditEntries: AuditEntry[] } {
  if (baseCents <= 0) return { cents: 0, days: 0, auditEntries: [] };
  const dc = calculateDayCount(fromExclusive, toInclusive, dayCountConvention);
  if (dc.status !== 'success' || dc.fractionOfYear === null) {
    return { cents: 0, days: dc.days, auditEntries: [...dc.auditEntries] };
  }
  const raw = (baseCents / 100) * (ratePercent / 100) * dc.fractionOfYear * 100;
  return { cents: roundHalfUpCents(raw), days: dc.days, auditEntries: [...dc.auditEntries] };
}

/** Whether `boundary` (a 6-month multiple from anchor) falls within (prevDue, dueDate]. */
function crossedSemiAnnualBoundary(
  anchor: ISODate,
  prevDue: ISODate | null,
  dueDate: ISODate,
): boolean {
  const [ay, am, ad] = anchor.split('-').map(Number) as [number, number, number];
  let y = ay;
  let mo = am;
  for (let step = 0; step < 240; step++) {
    mo += 6;
    while (mo > 12) {
      mo -= 12;
      y += 1;
    }
    const boundary = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(ad).padStart(2, '0')}`;
    if (boundary > dueDate) return false;
    if ((prevDue === null || boundary > prevDue) && boundary <= dueDate) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Builds the actual-payment-driven amortization track with bucketed
 * arrears (overdue principal vs unpaid interest), continuing default
 * interest on overdue principal only, and ΑΚ 423 allocation. Pure
 * function. Rows follow the order of `dueInstallments` (caller must
 * pass them chronologically).
 */
export function buildActualPaymentsAmortization(
  dueInstallments: readonly DueInstallment[],
  actualPayments: readonly ActualPaymentInput[],
  config: ActualPaymentsAmortizationConfig,
): ActualPaymentsAmortizationResult {
  const auditEntries: AuditEntry[] = [];
  const currency = config.currency ?? 'EUR';

  if (dueInstallments.length === 0) {
    return {
      status: 'missing_data',
      rows: [],
      totalLateInterestCents: null,
      finalUnpaidInterestCents: 0,
      finalOverduePrincipalCents: 0,
      finalActualBalanceCents: null,
      auditEntries,
    };
  }

  const surcharge = config.lateInterestSurchargePercent;
  const defaultRatePercent =
    surcharge !== null ? config.contractualAnnualRatePercent + surcharge : null;
  if (surcharge === null) {
    auditEntries.push(
      requiresReview(
        AC.DEFAULT_INTEREST_SURCHARGE_MISSING,
        'Δεν έχει δηλωθεί προσαύξηση τόκου υπερημερίας· δεν υπολογίζεται τόκος υπερημερίας (παραμένει null, δεν τεκμαίρεται μηδέν ή το ανώτατο νόμιμο όριο).',
      ),
    );
  }

  const capitalize = config.capitalizeLateInterestSemiAnnually === true;
  const anchorDate = dueInstallments[0]!.dueDate;

  let runningPrincipalCents = config.openingPrincipalCents;
  // Arrears buckets carried across periods. Interest is split into
  // default (τόκος υπερημερίας) and contractual (συμβατικός τόκος)
  // sub-buckets so ΑΚ 423 can be applied in the precise order:
  // default interest → contractual interest → principal. Neither
  // interest bucket ever enters the default-interest base (ΑΚ 296).
  let overduePrincipalCents = 0;
  let carriedDefaultInterestCents = 0; // unpaid default interest carried over
  let carriedContractualInterestCents = 0; // unpaid contractual interest carried over
  let totalDefaultInterestCents = surcharge !== null ? 0 : null;
  let anyRequiresReview = surcharge === null;
  let prevDueDate: ISODate | null = null;

  const rows: ActualAmortizationRow[] = [];

  for (const due of dueInstallments) {
    // --- 0. Optional semi-annual capitalization at a crossed boundary ---
    const carriedInterestTotal = carriedDefaultInterestCents + carriedContractualInterestCents;
    if (
      capitalize &&
      carriedInterestTotal > 0 &&
      crossedSemiAnnualBoundary(anchorDate, prevDueDate, due.dueDate)
    ) {
      overduePrincipalCents += carriedInterestTotal;
      auditEntries.push(
        info(
          AC.SEMIANNUAL_CAPITALIZATION_APPLIED,
          `Εξαμηνιαία κεφαλαιοποίηση: ανεξόφλητος τόκος ${carriedInterestTotal / 100} ${currency} προστέθηκε στη βάση τόκου υπερημερίας (ληξιπρόθεσμο κεφάλαιο), βάσει ρητής συμβατικής πρόβλεψης (άρθ. 12 Ν.2601/1998).`,
        ),
      );
      carriedDefaultInterestCents = 0;
      carriedContractualInterestCents = 0;
    }

    // --- 1. Continuing default interest on outstanding overdue principal ---
    // Accrues from the previous due date (exclusive) to this due date
    // (inclusive), on principal that was already overdue coming in.
    let periodCarriedDefaultInterestCents = 0;
    if (defaultRatePercent !== null && overduePrincipalCents > 0 && prevDueDate !== null) {
      const accrual = accrueInterestOnBase(
        overduePrincipalCents,
        prevDueDate,
        due.dueDate,
        defaultRatePercent,
        config.dayCountConvention,
      );
      periodCarriedDefaultInterestCents = accrual.cents;
      if (accrual.cents > 0) {
        carriedDefaultInterestCents += accrual.cents;
        if (totalDefaultInterestCents !== null) totalDefaultInterestCents += accrual.cents;
        auditEntries.push(...accrual.auditEntries);
        auditEntries.push(
          info(
            AC.DEFAULT_INTEREST_ACCRUED,
            `Δόση ${due.rowId}: τόκος υπερημερίας ${accrual.cents / 100} ${currency} για ${accrual.days ?? '—'} ημέρες επί ληξιπρόθεσμου κεφαλαίου ${overduePrincipalCents / 100} ${currency} (επιτόκιο ${defaultRatePercent}%).`,
          ),
        );
      }
    }

    // --- 2. Determine this installment's actual payment behaviour ---
    // Default (no recorded exception): treat as a clean, on-time, full
    // payment — covers this period's contractual interest and its full
    // theoretical principal, reduces principal normally, no arrears.
    const payments = actualPayments
      .filter((p) => p.matchedRowId === due.rowId)
      .slice()
      .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

    let paidCents: number;
    let lastPaymentDate: ISODate | null;
    if (!due.hasRecordedException) {
      // Clean period: assume the debtor paid the full obligation,
      // including any extra charge that fell due this period.
      paidCents = due.installmentCents + (due.extraChargesCents ?? 0);
      lastPaymentDate = due.dueDate;
    } else {
      paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
      lastPaymentDate = payments.length > 0 ? payments[payments.length - 1]!.paymentDate : null;
    }

    // --- 3. Default interest for THIS period's own late settlement ---
    // If the installment is settled late, its own overdue amount also
    // accrues default interest from its due date to the payment date.
    let ownDefaultInterestCents = 0;
    let ownDefaultDays: number | null = null;
    const paidLate = lastPaymentDate !== null && lastPaymentDate > due.dueDate;
    // Own-period late interest applies only when an actual (non-zero)
    // settlement happened after the due date. A zero payment dated at
    // month-end is merely a "not paid" marker, not a late settlement —
    // its overdue principal accrues CONTINUING default interest in the
    // following periods instead (step 1), never here.
    if (defaultRatePercent !== null && paidLate && paidCents > 0 && lastPaymentDate !== null) {
      // Base: this installment's own principal portion, overdue from
      // its due date to the (late) payment date. Interest is excluded
      // from the base (ΑΚ 296).
      const baseForOwn = due.principalCents;
      const accrual = accrueInterestOnBase(
        baseForOwn,
        due.dueDate,
        lastPaymentDate,
        defaultRatePercent,
        config.dayCountConvention,
      );
      ownDefaultInterestCents = accrual.cents;
      ownDefaultDays = accrual.days;
      if (accrual.cents > 0) {
        if (totalDefaultInterestCents !== null) totalDefaultInterestCents += accrual.cents;
        auditEntries.push(...accrual.auditEntries);
        auditEntries.push(
          info(
            AC.DEFAULT_INTEREST_ACCRUED,
            `Δόση ${due.rowId}: τόκος υπερημερίας ${accrual.cents / 100} ${currency} για ${accrual.days ?? '—'} ημέρες (εκπρόθεσμη εξόφληση δόσης) επί κεφαλαίου ${baseForOwn / 100} ${currency}.`,
          ),
        );
      }
    }

    // --- 4. ΑΚ 423 allocation in the precise 6-level order ---
    // The payment is applied, strictly in order, to:
    //   (1) fees/charges        — not yet modelled (always 0 here)
    //   (2) default interest    — carried + this period's own
    //   (3) overdue contractual interest (carried from earlier periods)
    //   (4) current contractual interest (this period's)
    //   (5) overdue principal   (carried from earlier periods)
    //   (6) current principal   (this period's scheduled principal)
    // Principal is reduced ONLY by what is actually allocated to
    // principal (levels 5–6), never by the gross amount paid.
    const contractualInterestDue = due.interestCents;
    let remaining = paidCents;

    // (2) default interest (carried + own)
    const defaultInterestObligation =
      carriedDefaultInterestCents + ownDefaultInterestCents;
    const toDefaultInterest = Math.min(remaining, defaultInterestObligation);
    remaining -= toDefaultInterest;
    const defaultInterestStillUnpaid = defaultInterestObligation - toDefaultInterest;

    // (3) overdue (carried) contractual interest
    const toOverdueContractual = Math.min(remaining, carriedContractualInterestCents);
    remaining -= toOverdueContractual;
    const overdueContractualStillUnpaid = carriedContractualInterestCents - toOverdueContractual;

    // (4) current contractual interest
    const toCurrentContractual = Math.min(remaining, contractualInterestDue);
    remaining -= toCurrentContractual;
    const currentContractualStillUnpaid = contractualInterestDue - toCurrentContractual;

    // (5) overdue (carried) principal
    const toOverduePrincipal = Math.min(remaining, overduePrincipalCents);
    remaining -= toOverduePrincipal;
    const overduePrincipalStillUnpaid = overduePrincipalCents - toOverduePrincipal;

    // (6) current principal
    const toCurrentPrincipal = Math.min(remaining, due.principalCents);
    remaining -= toCurrentPrincipal;
    const currentPrincipalStillUnpaid = due.principalCents - toCurrentPrincipal;

    // (6b) current extra charges (insurance, legal, etc.). Per the user's
    // contractual treatment these behave like principal: if unpaid they
    // roll into overdue principal and accrue default interest the same
    // way. They are settled AFTER this period's scheduled principal.
    const extraChargesDue = due.extraChargesCents ?? 0;
    const toExtraCharges = Math.min(remaining, extraChargesDue);
    remaining -= toExtraCharges;
    const extraChargesStillUnpaid = extraChargesDue - toExtraCharges;

    const overpaymentCents = remaining; // paid beyond all obligations

    // Aggregates for reporting (interest vs principal split). Extra
    // charges are grouped with principal, matching their treatment.
    const toInterest = toDefaultInterest + toOverdueContractual + toCurrentContractual;
    const toPrincipal = toOverduePrincipal + toCurrentPrincipal + toExtraCharges;

    // Principal balance falls ONLY by what was allocated to scheduled
    // principal (levels 5–6) — NOT by extra charges, which are not part
    // of the loan principal balance even though they share its arrears
    // treatment.
    const principalReducedCents = toOverduePrincipal + toCurrentPrincipal;
    runningPrincipalCents -= principalReducedCents;

    // Carry forward the still-unpaid sub-buckets. Unpaid extra charges
    // join overdue principal (same default-interest base).
    carriedDefaultInterestCents = defaultInterestStillUnpaid;
    carriedContractualInterestCents = overdueContractualStillUnpaid + currentContractualStillUnpaid;
    overduePrincipalCents =
      overduePrincipalStillUnpaid + currentPrincipalStillUnpaid + extraChargesStillUnpaid;

    if (extraChargesDue > 0) {
      auditEntries.push(
        info(
          AC.PAYMENT_ALLOCATED,
          `Δόση ${due.rowId}: πρόσθετη χρέωση περιόδου ${extraChargesDue / 100} ${currency} (π.χ. ασφάλιστρα/έξοδα)· εξοφλήθηκε ${toExtraCharges / 100} ${currency}, μεταφέρεται ως ληξιπρόθεσμο ${extraChargesStillUnpaid / 100} ${currency} με τόκο υπερημερίας όπως το κεφάλαιο.`,
        ),
      );
    }

    const interestStillUnpaid =
      defaultInterestStillUnpaid + overdueContractualStillUnpaid + currentContractualStillUnpaid;
    const principalStillOverdue = overduePrincipalCents;

    // --- 5. Audit + warnings ---
    if (interestStillUnpaid > 0) {
      auditEntries.push(
        info(
          AC.INTEREST_UNDERPAID_CARRIED_FORWARD,
          `Δόση ${due.rowId}: ανεξόφλητος τόκος ${interestStillUnpaid / 100} ${currency} μεταφέρεται ως ξεχωριστή απαίτηση (ΑΚ 423/296) — δεν προστίθεται στο κεφάλαιο ούτε στη βάση τόκου υπερημερίας.`,
        ),
      );
      if (!capitalize) {
        auditEntries.push(
          warning(
            AC.UNPAID_INTEREST_EXCLUDED_FROM_BASE,
            'Οι ανεξόφλητοι τόκοι δεν προστέθηκαν στη βάση τόκου υπερημερίας, επειδή δεν έχει ενεργοποιηθεί τεκμηριωμένος κανόνας ανατοκισμού (ΑΚ 296).',
          ),
        );
      }
    }
    auditEntries.push(
      info(
        AC.PAYMENT_ALLOCATED,
        `Δόση ${due.rowId}: καταβολή ${paidCents / 100} ${currency} — σε τόκους ${toInterest / 100} ${currency}, σε κεφάλαιο ${toPrincipal / 100} ${currency} (ΑΚ 423).`,
      ),
    );
    if (overpaymentCents > 0) {
      auditEntries.push(
        info(
          AC.INSTALLMENT_OVERPAID,
          `Δόση ${due.rowId}: υπερκάλυψη ${overpaymentCents / 100} ${currency} έναντι των συνολικών οφειλών της περιόδου.`,
        ),
      );
    }
    if (principalStillOverdue > 0 && defaultRatePercent === null) {
      anyRequiresReview = true;
    }

    // --- 6. Status ---
    let status: ActualAmortizationRowStatus;
    const settledThisPeriod = interestStillUnpaid === 0 && principalStillOverdue === 0;
    if (settledThisPeriod) {
      status = paidLate ? 'settled_late' : 'settled_on_time';
    } else if (due.hasRecordedException && paidCents === 0) {
      status = 'unsettled';
    } else {
      status = 'partially_settled';
    }
    if (principalStillOverdue > 0 && defaultRatePercent === null) {
      status = 'requires_review';
    }

    const periodDefaultInterest =
      defaultRatePercent === null
        ? null
        : periodCarriedDefaultInterestCents + ownDefaultInterestCents;

    rows.push({
      rowId: due.rowId,
      dueDate: due.dueDate,
      installmentCents: due.installmentCents,
      contractualInterestCents: due.interestCents,
      extraChargesCents: due.extraChargesCents ?? 0,
      paidCents,
      lastPaymentDate,
      defaultInterestAccruedCents: periodDefaultInterest,
      defaultInterestDays: ownDefaultDays,
      appliedToInterestCents: toInterest,
      appliedToPrincipalCents: toPrincipal,
      overduePrincipalCents,
      unpaidInterestCarryForwardCents: carriedDefaultInterestCents + carriedContractualInterestCents,
      status,
      actualClosingBalanceCents: runningPrincipalCents,
    });

    prevDueDate = due.dueDate;
  }

  const finalRow = rows[rows.length - 1];
  return {
    status: anyRequiresReview ? 'requires_review' : 'success',
    rows,
    totalLateInterestCents: totalDefaultInterestCents,
    finalUnpaidInterestCents: carriedDefaultInterestCents + carriedContractualInterestCents,
    finalOverduePrincipalCents: overduePrincipalCents,
    finalActualBalanceCents: finalRow ? finalRow.actualClosingBalanceCents : config.openingPrincipalCents,
    auditEntries,
  };
}
