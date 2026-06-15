/**
 * Loan Audit PRO — src/engines/rateEngine.ts
 * ------------------------------------------------------------------
 * Step 2-A: Rate engine ONLY.
 *
 * Given a RateConfig and a target date, resolves the applied annual
 * rate (%) with a full breakdown (index, spread, Ν.128/75) and audit
 * entries. Pure function: no mutation, no I/O, no hidden state.
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026 (no logic copied).
 *   - NO interest is calculated here, NO day counting, NO
 *     amortization — only annual-rate resolution. Interest will later
 *     be computed (in the amortization engine) on the OUTSTANDING
 *     PRINCIPAL BALANCE, never only on a monthly principal installment.
 *   - No interpolation, no nearest-rate fallback, no invented values,
 *     no silent flooring of negative indices, no silent assumptions.
 *   - Precision: values are passed through and summed as-is; no
 *     internal rounding. Display rounding is the report's concern.
 */

import type { ISODate } from '../domain/dateTypes';
import type { RateConfig, RatePeriod } from '../domain/rateTypes';
import type { AuditEntry } from '../domain/auditTypes';
import {
  VALIDATION_AUDIT_CODES as C,
  info,
  assumption,
  warning,
  requiresReview,
} from '../domain/auditFactories';

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type RateResolutionStatus = 'success' | 'requires_review' | 'missing_data';

export type RateSource =
  | 'contract'
  | 'public_index'
  | 'bank_statement'
  | 'user_input'
  | 'assumption'
  | 'missing';

export interface RateResolutionResult {
  readonly status: RateResolutionStatus;
  /**
   * The annual rate (%) produced by the resolution.
   *   status 'success'         -> confirmed value, usable downstream.
   *   status 'requires_review' -> NUMERIC PREVIEW where one can be
   *     produced (e.g. Ν.128/75 unknown: preview excludes the levy).
   *     A preview must NEVER be used for signed output without review;
   *     consumers must branch on status. Null when no defensible
   *     preview exists (e.g. unknown floor policy on a negative index
   *     with no review-preview policy configured).
   *   status 'missing_data'    -> always null.
   */
  readonly appliedAnnualRatePercent: number | null;
  /** Index value as found in the rate history (may be negative). */
  readonly nominalIndexPercent: number | null;
  /** Index value after applying the negative-index policy. */
  readonly effectiveIndexPercent: number | null;
  readonly spreadPercent: number | null;
  /** Ν.128/75 component added on top (0 when included in the rate). */
  readonly law128Percent: number | null;
  readonly totalBeforeLaw128Percent: number | null;
  readonly totalAfterLaw128Percent: number | null;
  readonly source: RateSource;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Internal helpers (pure, no rounding)                                */
/* ------------------------------------------------------------------ */

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Find rate periods applicable to the target date:
 * from <= targetDate <= to (ISO strings compare chronologically).
 * No interpolation, no nearest-period fallback.
 */
function findApplicablePeriods(
  history: readonly RatePeriod[],
  targetDate: ISODate,
): RatePeriod[] {
  return history.filter((p) => p.from <= targetDate && targetDate <= p.to);
}

interface Law128Resolution {
  readonly law128Percent: number | null;
  readonly resolved: boolean; // false => requires_review
  readonly entries: readonly AuditEntry[];
}

function resolveLaw128(law128: RateConfig['law128']): Law128Resolution {
  switch (law128.kind) {
    case 'included_in_rate':
      return {
        law128Percent: 0,
        resolved: true,
        entries: [
          info(
            C.EXPLICIT_ASSUMPTION,
            'Πληροφορία: η εισφορά Ν.128/75 περιλαμβάνεται ήδη στο συμβατικό επιτόκιο· δεν προστίθεται επιπλέον ποσοστό.',
            law128.ratePercent !== null
              ? { law128IncludedPercent: law128.ratePercent }
              : null,
          ),
        ],
      };
    case 'added_separately':
      return { law128Percent: law128.ratePercent, resolved: true, entries: [] };
    case 'unknown':
      return {
        law128Percent: null,
        resolved: false,
        entries: [
          requiresReview(
            C.LAW128_UNKNOWN,
            'Απαιτείται έλεγχος: άγνωστο καθεστώς εισφοράς Ν.128/75. Τυχόν αριθμητική προεπισκόπηση επιτοκίου ΔΕΝ περιλαμβάνει την εισφορά και δεν οριστικοποιείται χωρίς επιβεβαίωση.',
          ),
        ],
      };
  }
}

/** Day count is NOT used for any computation here — audit-only. */
function dayCountEntries(dayCount: RateConfig['dayCount']): AuditEntry[] {
  if (dayCount === 'unknown') {
    return [
      assumption(
        C.DAYCOUNT_UNKNOWN,
        'Ρητή υπόθεση: άγνωστη σύμβαση ημερομέτρησης. Δεν εμποδίζει την ανάλυση επιτοκίου· θα απαιτηθεί ρητή υπόθεση (ACT_360) κατά τον υπολογισμό τόκων σε επόμενο στάδιο.',
      ),
    ];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve the annual rate applicable on `targetDate` under `config`.
 *
 * Status semantics:
 *   success         -> complete breakdown; appliedAnnualRatePercent set
 *   requires_review -> data exists but a contractual term is unknown
 *                      (Ν.128/75, floor on negative index); partial
 *                      breakdown is exposed, applied rate stays null
 *   missing_data    -> a required input is absent (rate value, period,
 *                      index value, spread); applied rate is null
 */
export function resolveRateForDate(
  config: RateConfig,
  targetDate: ISODate,
): RateResolutionResult {
  const auditEntries: AuditEntry[] = [...dayCountEntries(config.dayCount)];

  if (config.regime.kind === 'fixed') {
    return resolveFixed(config, auditEntries);
  }
  return resolveFloating(config, targetDate, auditEntries);
}

/* ---------------------------- fixed ------------------------------- */

function resolveFixed(
  config: RateConfig,
  auditEntries: AuditEntry[],
): RateResolutionResult {
  const regime = config.regime;
  if (regime.kind !== 'fixed') throw new Error('resolveFixed: wrong regime');

  const base = regime.annualRatePercent as unknown;
  if (!isFiniteNumber(base)) {
    auditEntries.push(
      requiresReview(
        C.RATE_FIXED_MISSING,
        'Ελλιπή δεδομένα: σταθερό επιτόκιο χωρίς καταχωρημένη τιμή.',
      ),
    );
    return emptyResult('missing_data', 'missing', auditEntries);
  }

  const law = resolveLaw128(config.law128);
  auditEntries.push(...law.entries);

  // For a fixed rate the base IS the total before any separate levy.
  const totalBefore = base;

  if (!law.resolved) {
    // Ν.128/75 unknown: a numeric PREVIEW exists (the base rate without
    // the levy). Status stays requires_review — never success.
    // totalAfterLaw128Percent remains null: nothing is finalized.
    return {
      status: 'requires_review',
      appliedAnnualRatePercent: totalBefore, // preview, excludes levy
      nominalIndexPercent: null,
      effectiveIndexPercent: null,
      spreadPercent: null,
      law128Percent: null, // unknown stays null — never coerced to 0
      totalBeforeLaw128Percent: totalBefore,
      totalAfterLaw128Percent: null,
      source: 'contract',
      auditEntries,
    };
  }

  const law128Percent = law.law128Percent ?? 0;
  const totalAfter = totalBefore + law128Percent;

  return {
    status: 'success',
    appliedAnnualRatePercent: totalAfter,
    nominalIndexPercent: null,
    effectiveIndexPercent: null,
    spreadPercent: null,
    law128Percent,
    totalBeforeLaw128Percent: totalBefore,
    totalAfterLaw128Percent: totalAfter,
    source: 'contract',
    auditEntries,
  };
}

/* --------------------------- floating ----------------------------- */

function resolveFloating(
  config: RateConfig,
  targetDate: ISODate,
  auditEntries: AuditEntry[],
): RateResolutionResult {
  const regime = config.regime;
  if (regime.kind !== 'floating') throw new Error('resolveFloating: wrong regime');

  // --- applicable period ------------------------------------------------
  const matches = findApplicablePeriods(regime.rateHistory, targetDate);

  if (matches.length === 0) {
    auditEntries.push(
      requiresReview(
        C.RATE_HISTORY_MISSING,
        `Ελλιπή δεδομένα: δεν υπάρχει καταχωρημένη περίοδος επιτοκίου που να καλύπτει την ημερομηνία ${targetDate}. Δεν εφαρμόζεται παρεμβολή ούτε πλησιέστερη διαθέσιμη τιμή.`,
        { targetDate },
      ),
    );
    return emptyResult('missing_data', 'missing', auditEntries);
  }

  if (matches.length > 1) {
    auditEntries.push(
      warning(
        C.CONTRACT_SCHEDULE_MISMATCH,
        `Ασυνέπεια δεδομένων: ${matches.length} επικαλυπτόμενες περίοδοι επιτοκίου καλύπτουν την ημερομηνία ${targetDate}· χρησιμοποιείται η πρώτη καταχωρημένη. Απαιτείται έλεγχος του ιστορικού.`,
        { targetDate, overlappingPeriods: matches.length },
      ),
    );
  }

  const period = matches[0]!;
  const source: RateSource = period.source;

  // --- index value ------------------------------------------------------
  const nominalIndex = period.indexValuePercent;
  if (nominalIndex === null) {
    auditEntries.push(
      requiresReview(
        C.MISSING_INDEX_VALUE,
        `Ελλιπή δεδομένα: η περίοδος ${period.from} – ${period.to} δεν έχει καταχωρημένη τιμή δείκτη. Δεν εφαρμόζεται παρεμβολή.`,
        period.totalAppliedRatePercent !== null
          ? {
              periodFrom: period.from,
              periodTo: period.to,
              bankStatedTotalPercent: period.totalAppliedRatePercent,
              note: 'Υπάρχει δηλωθέν συνολικό επιτόκιο τράπεζας για χειροκίνητη αντιπαραβολή.',
            }
          : { periodFrom: period.from, periodTo: period.to },
      ),
    );
    return emptyResult('missing_data', source, auditEntries);
  }

  // --- spread -----------------------------------------------------------
  const spread = regime.spreadPercent as unknown;
  if (!isFiniteNumber(spread)) {
    auditEntries.push(
      requiresReview(
        C.RATE_SPREAD_MISSING,
        'Ελλιπή δεδομένα: δεν έχει καταχωρηθεί περιθώριο (spread) για το κυμαινόμενο επιτόκιο. Δεν συνάγεται τιμή.',
      ),
    );
    return {
      ...emptyResult('missing_data', source, auditEntries),
      nominalIndexPercent: nominalIndex,
    };
  }

  // --- negative-index policy ---------------------------------------------
  let effectiveIndex: number | null;
  let negativePolicyUnresolved = false;

  if (nominalIndex < 0) {
    switch (regime.negativeEuriborPolicy) {
      case 'as_is':
        effectiveIndex = nominalIndex;
        auditEntries.push(
          info(
            C.EXPLICIT_ASSUMPTION,
            `Πληροφορία: αρνητική τιμή δείκτη (${nominalIndex}%) εφαρμόζεται ως έχει, σύμφωνα με τη δηλωμένη πολιτική (as_is).`,
            { nominalIndexPercent: nominalIndex },
          ),
        );
        break;
      case 'floor_zero':
        effectiveIndex = 0;
        auditEntries.push(
          info(
            C.EXPLICIT_ASSUMPTION,
            `Πληροφορία: αρνητική τιμή δείκτη (${nominalIndex}%) μηδενίζεται βάσει δηλωμένου συμβατικού όρου floor (floor_zero).`,
            { nominalIndexPercent: nominalIndex, effectiveIndexPercent: 0 },
          ),
        );
        break;
      case 'unknown':
        effectiveIndex = null;
        negativePolicyUnresolved = true;
        auditEntries.push(
          requiresReview(
            C.NEGATIVE_INDEX_POLICY_UNKNOWN,
            `Απαιτείται έλεγχος: αρνητική τιμή δείκτη (${nominalIndex}%) με άγνωστο συμβατικό χειρισμό (όρος floor). Δεν εφαρμόζεται σιωπηρός μηδενισμός ούτε σιωπηρή χρήση της αρνητικής τιμής.`,
            { nominalIndexPercent: nominalIndex },
          ),
        );
        break;
    }
  } else {
    // Non-negative index: the policy has no effect on this period.
    effectiveIndex = nominalIndex;
    if (regime.negativeEuriborPolicy === 'unknown') {
      auditEntries.push(
        info(
          C.NEGATIVE_INDEX_POLICY_UNKNOWN,
          'Πληροφορία: ο συμβατικός χειρισμός αρνητικού δείκτη είναι άγνωστος, αλλά δεν επηρεάζει την παρούσα περίοδο (μη αρνητική τιμή δείκτη).',
          { nominalIndexPercent: nominalIndex },
        ),
      );
    }
  }

  // --- Ν.128/75 -----------------------------------------------------------
  const law = resolveLaw128(config.law128);
  auditEntries.push(...law.entries);

  // --- assemble (no rounding anywhere) ------------------------------------
  if (negativePolicyUnresolved) {
    return {
      status: 'requires_review',
      appliedAnnualRatePercent: null,
      nominalIndexPercent: nominalIndex,
      effectiveIndexPercent: null,
      spreadPercent: spread,
      law128Percent: law.resolved ? (law.law128Percent ?? 0) : null,
      totalBeforeLaw128Percent: null,
      totalAfterLaw128Percent: null,
      source,
      auditEntries,
    };
  }

  const totalBefore = (effectiveIndex as number) + spread;

  if (!law.resolved) {
    // Ν.128/75 unknown: numeric PREVIEW = index + spread (no levy).
    // Status stays requires_review — never success. No value invented:
    // law128Percent and totalAfter stay null (never coerced to 0).
    return {
      status: 'requires_review',
      appliedAnnualRatePercent: totalBefore, // preview, excludes levy
      nominalIndexPercent: nominalIndex,
      effectiveIndexPercent: effectiveIndex,
      spreadPercent: spread,
      law128Percent: null,
      totalBeforeLaw128Percent: totalBefore,
      totalAfterLaw128Percent: null,
      source,
      auditEntries,
    };
  }

  const law128Percent = law.law128Percent ?? 0;
  const totalAfter = totalBefore + law128Percent;

  return {
    status: 'success',
    appliedAnnualRatePercent: totalAfter,
    nominalIndexPercent: nominalIndex,
    effectiveIndexPercent: effectiveIndex,
    spreadPercent: spread,
    law128Percent,
    totalBeforeLaw128Percent: totalBefore,
    totalAfterLaw128Percent: totalAfter,
    source,
    auditEntries,
  };
}

/* ---------------------------- shared ------------------------------ */

function emptyResult(
  status: RateResolutionStatus,
  source: RateSource,
  auditEntries: readonly AuditEntry[],
): RateResolutionResult {
  return {
    status,
    appliedAnnualRatePercent: null,
    nominalIndexPercent: null,
    effectiveIndexPercent: null,
    spreadPercent: null,
    law128Percent: null,
    totalBeforeLaw128Percent: null,
    totalAfterLaw128Percent: null,
    source,
    auditEntries,
  };
}
