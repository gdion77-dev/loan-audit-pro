/**
 * Loan Audit PRO — tests/fixtures/rateFixtures.ts
 * ------------------------------------------------------------------
 * Step 2-B: golden verification fixtures for the rate engine.
 * Fixture builders only — no calculations, no engine logic.
 */

import { toISODate, type ISODate } from '../../src/domain/dateTypes';
import type {
  RateConfig,
  RatePeriod,
  Law128Status,
  NegativeEuriborPolicy,
} from '../../src/domain/rateTypes';

export const TARGET_DATE: ISODate = toISODate('2024-03-15');

export function goldenPeriod(
  indexValuePercent: number | null,
  overrides: Partial<RatePeriod> = {},
): RatePeriod {
  return {
    from: toISODate('2024-01-01'),
    to: toISODate('2024-06-30'),
    indexValuePercent,
    totalAppliedRatePercent: null,
    source: 'bank_statement',
    ...overrides,
  };
}

export function goldenFixedConfig(
  annualRatePercent: number,
  law128: Law128Status,
): RateConfig {
  return {
    regime: { kind: 'fixed', annualRatePercent },
    law128,
    dayCount: 'ACT_360',
  };
}

export function goldenFloatingConfig(args: {
  indexValuePercent: number | null;
  spreadPercent: number;
  law128: Law128Status;
  negativeEuriborPolicy?: NegativeEuriborPolicy;
  rateHistory?: readonly RatePeriod[];
}): RateConfig {
  return {
    regime: {
      kind: 'floating',
      indexType: 'EURIBOR_3M',
      indexLabel: null,
      spreadPercent: args.spreadPercent,
      referenceDateRule: null,
      resetFrequencyMonths: 3,
      negativeEuriborPolicy: args.negativeEuriborPolicy ?? 'as_is',
      rateHistory: args.rateHistory ?? [goldenPeriod(args.indexValuePercent)],
    },
    law128: args.law128,
    dayCount: 'ACT_360',
  };
}
