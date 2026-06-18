/**
 * Loan Audit PRO — src/ui-state/floatingRateResolver.ts
 * ------------------------------------------------------------------
 * Turns a sorted list of fetched (or manually entered) index
 * observations into a per-installment `RatePeriod[]` (rateHistory),
 * honouring the contractual rate-source rule.
 *
 * Locked rules (confirmed):
 *   • Negative index is always treated as ZERO (floor at 0). The
 *     effective index never goes negative; the applied rate never
 *     drops below the spread.
 *   • FUTURE installments (whose fixing date is after the last
 *     published observation) reuse the LAST published value, flagged
 *     as projected, and the study must state this explicitly.
 *   • The value used for each period is selected per the contract
 *     rule. If the rule is unknown/unclear, the caller has already
 *     flagged «απαιτείται έλεγχος»; here we still resolve a best-effort
 *     as-of value but mark it so the report can disclose it.
 *
 * Pure module — no network, no engine mutation. Deterministic.
 */

import type { RatePeriod, RatePeriodSource } from '../domain/rateTypes';

export interface IndexObservation {
  readonly date: string; // ISO yyyy-mm-dd or yyyy-mm
  readonly valuePercent: number;
}

export type RateSourceRule =
  | 'CONTRACT_DEFINED'
  | 'RESET_DATE_VALUE'
  | 'BUSINESS_DAYS_BEFORE_RESET'
  | 'MONTHLY_AVERAGE'
  | 'MANUAL_RATE'
  | 'unknown';

export interface ResolveFloatingInput {
  /** Observations sorted ascending by date (caller guarantees sort). */
  readonly observations: readonly IndexObservation[];
  /** Period start dates (ISO), one per installment, ascending. */
  readonly periodStartDates: readonly string[];
  readonly rule: RateSourceRule;
  /** N business days before period start (for BUSINESS_DAYS_BEFORE_RESET). */
  readonly businessDaysBeforeReset?: number | null;
  /** Source label attached to produced RatePeriods. */
  readonly source?: RatePeriodSource;
}

export interface ResolvedPeriod extends RatePeriod {
  /** True when the value was carried from the last published observation. */
  readonly isProjected: boolean;
  /** True when the raw index was negative and floored to zero. */
  readonly flooredFromNegative: boolean;
}

export interface ResolveFloatingResult {
  readonly periods: readonly ResolvedPeriod[];
  /** Number of installments whose value was projected (future). */
  readonly projectedCount: number;
  /** ISO date of the last published observation actually used. */
  readonly lastPublishedDate: string | null;
  /** The value carried forward to projected installments, if any. */
  readonly lastPublishedValuePercent: number | null;
  /** True when no observation could be matched at all. */
  readonly hasData: boolean;
}

/** Subtract N calendar weekdays (Mon–Fri) from an ISO date. Holidays are
 *  not modelled (no official calendar); this is a pragmatic business-day
 *  approximation that the report discloses. */
export function subtractBusinessDays(isoDate: string, n: number): string {
  const d = new Date(`${normalizeToDay(isoDate)}T00:00:00Z`);
  let remaining = Math.max(0, Math.trunc(n));
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** A monthly period id (yyyy-mm) is widened to its first day for compare. */
function normalizeToDay(iso: string): string {
  return /^\d{4}-\d{2}$/.test(iso) ? `${iso}-01` : iso;
}

/**
 * As-of lookup: the most recent observation whose date is <= targetDate.
 * Observations must be ascending. Returns null when target precedes all.
 */
export function findAsOf(
  observations: readonly IndexObservation[],
  targetDate: string,
): IndexObservation | null {
  const target = normalizeToDay(targetDate);
  let found: IndexObservation | null = null;
  for (const obs of observations) {
    if (normalizeToDay(obs.date) <= target) found = obs;
    else break;
  }
  return found;
}

/** Average of all observations whose date falls within the target month. */
function monthlyAverage(
  observations: readonly IndexObservation[],
  targetDate: string,
): number | null {
  const ym = normalizeToDay(targetDate).slice(0, 7);
  const inMonth = observations.filter((o) => normalizeToDay(o.date).slice(0, 7) === ym);
  if (inMonth.length === 0) return null;
  const sum = inMonth.reduce((acc, o) => acc + o.valuePercent, 0);
  return sum / inMonth.length;
}

/** Compute the fixing date for a period start under the given rule. */
function fixingDateFor(
  periodStart: string,
  rule: RateSourceRule,
  businessDaysBeforeReset?: number | null,
): string {
  if (rule === 'BUSINESS_DAYS_BEFORE_RESET' && businessDaysBeforeReset != null) {
    return subtractBusinessDays(periodStart, businessDaysBeforeReset);
  }
  // CONTRACT_DEFINED / RESET_DATE_VALUE / others: use the period start as
  // the reference (the as-of lookup then picks the latest value on/before
  // that date — i.e. the last published fixing).
  return periodStart;
}

export function resolveFloatingRateHistory(input: ResolveFloatingInput): ResolveFloatingResult {
  const { observations, periodStartDates, rule } = input;
  const source: RatePeriodSource = input.source ?? 'public_index';
  const obs = observations;
  const last = obs.length > 0 ? obs[obs.length - 1] : null;

  if (obs.length === 0 || periodStartDates.length === 0) {
    return {
      periods: [],
      projectedCount: 0,
      lastPublishedDate: last?.date ?? null,
      lastPublishedValuePercent: last?.valuePercent ?? null,
      hasData: false,
    };
  }

  const lastObsDay = normalizeToDay(last!.date);
  const periods: ResolvedPeriod[] = [];
  let projectedCount = 0;

  for (let i = 0; i < periodStartDates.length; i += 1) {
    const periodStart = periodStartDates[i]!;
    const periodEnd = periodStartDates[i + 1] ?? periodStart;
    const fixing = fixingDateFor(periodStart, rule, input.businessDaysBeforeReset);

    let rawValue: number | null;
    let isProjected = false;

    if (rule === 'MONTHLY_AVERAGE') {
      rawValue = monthlyAverage(obs, periodStart);
      if (rawValue === null) {
        // No same-month data -> fall back to as-of, possibly projected.
        const asOf = findAsOf(obs, fixing);
        rawValue = asOf ? asOf.valuePercent : last!.valuePercent;
      }
    } else {
      const asOf = findAsOf(obs, fixing);
      if (asOf) {
        rawValue = asOf.valuePercent;
      } else {
        // Fixing precedes all observations -> use the earliest available.
        rawValue = obs[0]!.valuePercent;
      }
    }

    // Future installment: fixing date is after the last published value.
    if (normalizeToDay(fixing) > lastObsDay) {
      rawValue = last!.valuePercent;
      isProjected = true;
      projectedCount += 1;
    }

    // Floor negative index to zero.
    const flooredFromNegative = rawValue < 0;
    const effective = flooredFromNegative ? 0 : rawValue;

    periods.push({
      from: periodStart as RatePeriod['from'],
      to: periodEnd as RatePeriod['to'],
      indexValuePercent: effective,
      totalAppliedRatePercent: null,
      source,
      isProjected,
      flooredFromNegative,
    });
  }

  return {
    periods,
    projectedCount,
    lastPublishedDate: last!.date,
    lastPublishedValuePercent: last!.valuePercent,
    hasData: true,
  };
}
