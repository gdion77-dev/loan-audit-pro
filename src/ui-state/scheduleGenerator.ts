/**
 * Loan Audit PRO — src/ui-state/scheduleGenerator.ts
 * ------------------------------------------------------------------
 * Generates technical bank-schedule draft rows from the already-entered
 * loan terms, by delegating to the LOCKED schedule engines
 * (buildEqualInstallmentSchedule / buildEqualPrincipalSchedule). It
 * duplicates NO amortization formula: it validates required inputs via
 * the adapter, builds the same engine input the pipeline uses, runs the
 * locked engine, and maps the resulting RecalcRow[] into
 * BankScheduleDraftRow[].
 *
 * Neutral wording only: generated rows are «Τεχνικά παραγόμενο βάσει
 * δηλωμένων όρων» — a technical, terms-based projection, not any kind
 * of bank-issued statement. Unknown
 * amounts stay unknown (never coerced to zero).
 */
import { adaptDraftToDomain } from './draftToDomainAdapter';
import type { LoanAuditDraftState, BankScheduleDraftRow } from './loanAuditDraftState';
import { fieldValue, fieldUnknown } from './fieldState';
import type { CurrencyCode } from '../domain/money';
import type { RecalcRow } from '../domain/scheduleTypes';
import type { RoundingMode } from '../engines/interestAccrualEngine';
import { buildEqualInstallmentSchedule } from '../engines/equalInstallmentScheduleEngine';
import { buildEqualPrincipalSchedule } from '../engines/equalPrincipalScheduleEngine';

export const GENERATED_ROW_NOTE = 'Τεχνικά παραγόμενο βάσει δηλωμένων όρων';

export type ScheduleGenerationStatus =
  | 'generated'
  | 'blocked'
  | 'unsupported'
  | 'engine_incomplete'
  | 'rate_implausible';

export interface ScheduleGenerationResult {
  readonly status: ScheduleGenerationStatus;
  readonly rows: readonly BankScheduleDraftRow[];
  /** Greek, user-facing message describing the outcome. */
  readonly message: string;
  /** Labels of missing critical inputs when status === 'blocked'. */
  readonly missing: readonly string[];
  /** The locked engine's own status, when an engine was run. null otherwise. */
  readonly engineStatus: string | null;
  /** Neutral audit/warning messages surfaced from the locked engine. */
  readonly engineMessages: readonly string[];
}

const ROUNDING_CODES: readonly RoundingMode[] = ['half_up', 'floor', 'ceil'];
function toRoundingMode(code: string | null): RoundingMode | null {
  return code !== null && (ROUNDING_CODES as readonly string[]).includes(code)
    ? (code as RoundingMode)
    : null;
}

/**
 * Adds one calendar month to an ISO date (YYYY-MM-DD), clamping the day
 * to the last valid day of the target month (e.g. Jan 31 → Feb 28/29).
 * Mirrors the engine's own month stepping so generated due dates align
 * with how the engine advances subsequent periods. This is calendar
 * arithmetic for scheduling, not a financial formula.
 */
function addOneMonthClamped(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const targetY = m === 12 ? y + 1 : y;
  const targetM = m === 12 ? 1 : m + 1;
  const daysInTarget = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();
  const clampedD = Math.min(d, daysInTarget);
  return `${targetY}-${String(targetM).padStart(2, '0')}-${String(clampedD).padStart(2, '0')}`;
}

/** Maps a Money|null cents value into a FieldState (null stays unknown). */
function moneyField(cents: number | null) {
  return cents === null ? fieldUnknown<number>('derived') : fieldValue<number>(cents, 'derived');
}

function toDraftRow(row: RecalcRow): BankScheduleDraftRow {
  // RecalcRow money fields are non-null on a successful engine row, but we
  // defensively treat any absent value as unknown — never as zero.
  const installment = row.installment?.cents ?? null;
  const principal = row.principal?.cents ?? null;
  const interest = row.interest?.cents ?? null;
  const balance = row.closingBalance?.cents ?? null;
  return {
    rowId: fieldValue<string>(row.rowId, 'derived'),
    dueDate: fieldValue<string>(row.dueDate, 'derived'),
    installmentCents: moneyField(installment),
    principalCents: moneyField(principal),
    interestCents: moneyField(interest),
    balanceCents: moneyField(balance),
    note: fieldValue<string>(GENERATED_ROW_NOTE, 'derived'),
  };
}

/**
 * Generates schedule draft rows from the current draft. Validates that
 * the critical inputs exist; if not, returns `blocked` with the missing
 * labels and generates nothing. Supports equal_installment and
 * equal_principal; any other mode returns `unsupported`.
 */
export function generateScheduleRows(
  draft: LoanAuditDraftState,
  options?: { readonly currency?: CurrencyCode },
): ScheduleGenerationResult {
  const currency: CurrencyCode = options?.currency ?? 'EUR';
  const adapted = adaptDraftToDomain(draft, { currency });

  // --- validate required inputs (no silent defaults) ------------------
  // Granular detection reads the draft FieldStates directly; the adapter's
  // prepared objects are non-null only when all their fields are present.
  const missing: string[] = [];
  const lt = draft.loanTermsDraft;
  const rc = draft.rateConfigDraft;
  const rs = draft.recalculationSettingsDraft;
  const dc = draft.bankScheduleDraft.dayCountConvention;

  if (lt.principalCents.status !== 'value' && lt.principalCents.status !== 'explicit_zero') {
    missing.push('Κεφάλαιο');
  }
  if (lt.termMonths.status !== 'value') missing.push('Διάρκεια (μήνες)');
  if (lt.startDate.status !== 'value') missing.push('Ημερομηνία έναρξης');
  if (rc.regimeKind.status !== 'value') missing.push('Διαμόρφωση επιτοκίου');
  if (dc.status !== 'value') missing.push('Σύμβαση ημερομέτρησης');
  if (rs.scheduleMode.status !== 'value') missing.push('Τύπος δοσολογίου');

  const loanTerms = adapted.loanTerms;
  const rateConfig = adapted.rateConfig;
  const settings = adapted.recalculationSettings;

  if (
    missing.length > 0 ||
    loanTerms === null ||
    rateConfig === null ||
    rateConfig.dayCount === 'unknown' ||
    settings === null
  ) {
    return {
      status: 'blocked',
      rows: [],
      missing,
      message:
        'Η δημιουργία δοσολογίου δεν είναι δυνατή: λείπουν κρίσιμα στοιχεία (' +
        (missing.length > 0 ? missing.join(', ') : 'ελέγξτε τους δηλωμένους όρους') +
        ').',
      engineStatus: null,
      engineMessages: [],
    };
  }

  // --- rate plausibility guard (input sanity, not a formula) ----------
  // A fixed annual rate above 100% almost always means the percent was
  // entered as a raw number (e.g. 610 instead of 6.10). We block and
  // explain, rather than feeding an implausible rate to the engine.
  const annualRate =
    rateConfig.regime.kind === 'fixed' ? rateConfig.regime.annualRatePercent : null;
  if (annualRate !== null && annualRate > 100) {
    return {
      status: 'rate_implausible',
      rows: [],
      missing: [],
      message:
        'Το ετήσιο επιτόκιο φαίνεται υπερβολικά υψηλό. Για 6,10% καταχωρήστε 6.10 και όχι 610.',
      engineStatus: null,
      engineMessages: [],
    };
  }

  const scheduleMode = settings.scheduleMode;
  if (scheduleMode !== 'equal_installment' && scheduleMode !== 'equal_principal') {
    return {
      status: 'unsupported',
      rows: [],
      missing: [],
      message: 'Ο επιλεγμένος τύπος δοσολογίου δεν υποστηρίζεται ακόμη για αυτόματη δημιουργία.',
      engineStatus: null,
      engineMessages: [],
    };
  }

  const roundingMode = toRoundingMode(settings.roundingMode);
  // The first installment falls ONE period (one month) after the loan
  // start, not on the loan's end date. The engine derives every later due
  // date by adding a month to this one. Using the end date here would make
  // the first period span the whole loan term and vastly overstate the
  // first period's interest.
  const firstPeriodStartDate = loanTerms.startDate;
  const firstDueDate = addOneMonthClamped(loanTerms.startDate);

  const baseInput = {
    principalCents: loanTerms.principalCents,
    termPeriods: loanTerms.termMonths,
    firstPeriodStartDate,
    firstDueDate,
    paymentFrequency: 'monthly' as const,
    rateConfig,
    dayCountConvention: rateConfig.dayCount,
    feesAndPremiumsPerPeriodCents: settings.feesAndPremiumsPerPeriodCents,
    ...(roundingMode !== null ? { roundingMode } : {}),
    currency,
  };

  // --- delegate to the LOCKED engine (no formula in UI) ---------------
  const engineResult =
    scheduleMode === 'equal_installment'
      ? buildEqualInstallmentSchedule(baseInput)
      : buildEqualPrincipalSchedule(baseInput);

  // Surface the engine's own neutral audit/warning messages (read-only).
  const engineMessages = engineResult.auditEntries
    .filter((e) => e.severity === 'warning' || e.severity === 'requires_review')
    .map((e) => e.message);
  // Detect a negative-amortization / impossible-installment signal from the
  // engine's audit codes, without recomputing anything.
  const negativeAmortization = engineResult.auditEntries.some((e) =>
    /NEGATIVE_AMORT|INSTALLMENT_TOO_LOW|NON_AMORTIZING|IMPOSSIBLE/i.test(String(e.code)),
  );

  const rows = engineResult.rows.map(toDraftRow);

  if (rows.length === 0) {
    const detail =
      negativeAmortization
        ? 'Το δηλωμένο σενάριο δεν παράγει ασφαλές δοσολόγιο με τους διαθέσιμους όρους.'
        : 'Δεν παρήχθησαν γραμμές δοσολογίου. Ελέγξτε τα στοιχεία επιτοκίου, διάρκειας και τύπου δοσολογίου.';
    return {
      status: 'engine_incomplete',
      rows: [],
      missing: [],
      message: detail,
      engineStatus: engineResult.status,
      engineMessages,
    };
  }

  return {
    status: 'generated',
    rows,
    missing: [],
    message: `Δημιουργήθηκαν ${rows.length} γραμμές: Τεχνικά παραγόμενο δοσολόγιο βάσει δηλωμένων όρων.`,
    engineStatus: engineResult.status,
    engineMessages,
  };
}
