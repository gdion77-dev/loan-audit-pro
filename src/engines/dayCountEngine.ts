/**
 * Loan Audit PRO — src/engines/dayCountEngine.ts
 * ------------------------------------------------------------------
 * Step 3-A: Day Count Engine ONLY.
 *
 * Given a start date, an end date and a DayCountConvention, returns
 * the number of interest days, the year basis and the fraction of
 * year. Pure function: no mutation, no I/O, no hidden state.
 *
 * INCLUSION RULE (documented per spec, used by every convention):
 *   - the START date is EXCLUDED
 *   - the END date is INCLUDED
 *   e.g. 2024-01-01 -> 2024-01-31 counts 30 actual days under ACT.
 *   (For the 30/360 family this is inherent in the formula
 *   D2 − D1: the start day itself is not counted.)
 *
 * Scope guards:
 *   - Independent of Ν.3869/2010 and ΑΠ 6/2026 (no logic copied).
 *   - NO monetary interest amounts, NO installments, NO balances —
 *     only days, year basis and fraction of year. Interest will later
 *     be computed by the amortization engine on the OUTSTANDING
 *     PRINCIPAL BALANCE using these fractions.
 *   - 'unknown' convention is NEVER silently mapped to ACT_360:
 *     it returns requires_review with null numeric outputs.
 *   - Invalid date ranges are never silently swapped.
 *   - fractionOfYear keeps full precision; rounding is for reports.
 */

import {
  isValidISODate,
  type ISODate,
  type DayCountConvention,
} from '../domain/dateTypes';
import type { AuditEntry } from '../domain/auditTypes';
import {
  VALIDATION_AUDIT_CODES as C,
  requiresReview,
} from '../domain/auditFactories';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this engine                                 */
/* ------------------------------------------------------------------ */

export const DAY_COUNT_AUDIT_CODES = {
  /** Reused from Step 1-B. */
  DAYCOUNT_UNKNOWN: C.DAYCOUNT_UNKNOWN,
  /** Start or end date missing / not a valid calendar date. */
  DAYCOUNT_DATE_MISSING: 'DAYCOUNT_DATE_MISSING',
  /** End date earlier than start date — never silently swapped. */
  DATE_RANGE_INVALID: 'DATE_RANGE_INVALID',
} as const;

/* ------------------------------------------------------------------ */
/* Result type                                                         */
/* ------------------------------------------------------------------ */

export type DayCountStatus = 'success' | 'requires_review' | 'missing_data';

export interface DayCountResult {
  readonly status: DayCountStatus;
  /** Echo of the validated inputs; null when missing/invalid. */
  readonly startDate: ISODate | null;
  readonly endDate: ISODate | null;
  readonly convention: DayCountConvention;
  /** Interest days under the convention (start excluded, end included). */
  readonly days: number | null;
  /** Denominator of the convention (360 or 365). */
  readonly yearBasis: number | null;
  /** days / yearBasis, full precision — never rounded here. */
  readonly fractionOfYear: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Internal date helpers (calendar arithmetic only — no money)         */
/* ------------------------------------------------------------------ */

interface Ymd {
  readonly y: number;
  readonly m: number; // 1-12
  readonly d: number; // 1-31
}

function parseYmd(date: ISODate): Ymd {
  // isValidISODate has already been checked by the caller.
  return {
    y: Number(date.slice(0, 4)),
    m: Number(date.slice(5, 7)),
    d: Number(date.slice(8, 10)),
  };
}

/**
 * Actual calendar days between the two dates (end − start), computed
 * via UTC epoch arithmetic. Leap years are handled naturally by the
 * calendar — February is never hardcoded. With start excluded and end
 * included, the difference itself IS the day count.
 */
function actualDaysBetween(start: Ymd, end: Ymd): number {
  const startMs = Date.UTC(start.y, start.m - 1, start.d);
  const endMs = Date.UTC(end.y, end.m - 1, end.d);
  return Math.round((endMs - startMs) / 86_400_000);
}

/** 30/360 family formula on (possibly adjusted) day components. */
function days30360(start: Ymd, end: Ymd, d1: number, d2: number): number {
  return 360 * (end.y - start.y) + 30 * (end.m - start.m) + (d2 - d1);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Calculate interest days and year fraction for one period.
 *
 * Status semantics:
 *   success         -> days / yearBasis / fractionOfYear are set
 *   requires_review -> convention unknown OR inverted date range;
 *                      numeric outputs are null (no silent defaults,
 *                      no silent swapping)
 *   missing_data    -> a date is missing or not a valid calendar date
 */
export function calculateDayCount(
  startDate: ISODate | string | null | undefined,
  endDate: ISODate | string | null | undefined,
  convention: DayCountConvention,
): DayCountResult {
  const auditEntries: AuditEntry[] = [];

  // --- date validity ------------------------------------------------
  const startValid =
    typeof startDate === 'string' && startDate !== '' && isValidISODate(startDate);
  const endValid =
    typeof endDate === 'string' && endDate !== '' && isValidISODate(endDate);

  if (!startValid || !endValid) {
    const missing: string[] = [];
    if (!startValid) missing.push('ημερομηνία έναρξης');
    if (!endValid) missing.push('ημερομηνία λήξης');
    auditEntries.push(
      requiresReview(
        DAY_COUNT_AUDIT_CODES.DAYCOUNT_DATE_MISSING,
        `Ελλιπή δεδομένα: μη έγκυρη ή ελλείπουσα ${missing.join(' και ')} περιόδου τοκισμού.`,
        { startDate: startValid ? startDate : null, endDate: endValid ? endDate : null },
      ),
    );
    return {
      status: 'missing_data',
      startDate: startValid ? (startDate as ISODate) : null,
      endDate: endValid ? (endDate as ISODate) : null,
      convention,
      days: null,
      yearBasis: null,
      fractionOfYear: null,
      auditEntries,
    };
  }

  const s = startDate as ISODate;
  const e = endDate as ISODate;

  // --- inverted range: never silently swapped ------------------------
  if (e < s) {
    auditEntries.push(
      requiresReview(
        DAY_COUNT_AUDIT_CODES.DATE_RANGE_INVALID,
        `Ασυνέπεια δεδομένων: η ημερομηνία λήξης (${e}) προηγείται της ημερομηνίας έναρξης (${s}). Οι ημερομηνίες δεν αντιστρέφονται σιωπηρά· απαιτείται έλεγχος.`,
        { startDate: s, endDate: e },
      ),
    );
    return {
      status: 'requires_review',
      startDate: s,
      endDate: e,
      convention,
      days: null,
      yearBasis: null,
      fractionOfYear: null,
      auditEntries,
    };
  }

  // --- unknown convention: no silent ACT_360 -------------------------
  if (convention === 'unknown') {
    auditEntries.push(
      requiresReview(
        DAY_COUNT_AUDIT_CODES.DAYCOUNT_UNKNOWN,
        'Απαιτείται έλεγχος: άγνωστη σύμβαση ημερομέτρησης. Δεν εφαρμόζεται σιωπηρή υπόθεση ACT_360 από τη μηχανή ημερομέτρησης· τυχόν υπόθεση πρέπει να δηλωθεί ρητά από το καλούν επίπεδο.',
        { startDate: s, endDate: e },
      ),
    );
    return {
      status: 'requires_review',
      startDate: s,
      endDate: e,
      convention,
      days: null,
      yearBasis: null,
      fractionOfYear: null,
      auditEntries,
    };
  }

  // --- counting -------------------------------------------------------
  const start = parseYmd(s);
  const end = parseYmd(e);

  let days: number;
  let yearBasis: number;

  switch (convention) {
    case 'ACT_360': {
      days = actualDaysBetween(start, end);
      yearBasis = 360;
      break;
    }
    case 'ACT_365': {
      // ACT/365 Fixed: basis stays 365 even across leap years; the
      // numerator naturally includes 29 February when crossed.
      days = actualDaysBetween(start, end);
      yearBasis = 365;
      break;
    }
    case '30_360': {
      // US 30/360: D1 31->30; D2 31->30 ONLY if adjusted D1 is 30.
      let d1 = start.d;
      let d2 = end.d;
      if (d1 === 31) d1 = 30;
      if (d2 === 31 && d1 === 30) d2 = 30;
      days = days30360(start, end, d1, d2);
      yearBasis = 360;
      break;
    }
    case '30E_360': {
      // European 30E/360: D1 31->30 and D2 31->30 unconditionally.
      const d1 = start.d === 31 ? 30 : start.d;
      const d2 = end.d === 31 ? 30 : end.d;
      days = days30360(start, end, d1, d2);
      yearBasis = 360;
      break;
    }
  }

  return {
    status: 'success',
    startDate: s,
    endDate: e,
    convention,
    days,
    yearBasis,
    fractionOfYear: days / yearBasis, // full precision, no rounding
    auditEntries,
  };
}
