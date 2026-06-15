/**
 * Tests: rate regimes, Ν.128/75 statuses, negative Euribor policy,
 * day count conventions, ISO date validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  RATE_REGIME_KINDS,
  isRateRegimeKind,
  LAW128_KINDS,
  isLaw128Kind,
  NEGATIVE_EURIBOR_POLICIES,
  isNegativeEuriborPolicy,
  type RateRegime,
  type Law128Status,
  type RateConfig,
  type RatePeriod,
} from '../src/domain/rateTypes';
import {
  DAY_COUNT_CONVENTIONS,
  isDayCountConvention,
  isValidISODate,
  toISODate,
  compareISODate,
  DateError,
} from '../src/domain/dateTypes';
import { LOAN_TYPE_KINDS, isLoanTypeKind } from '../src/domain/loanTypes';

describe('rate regimes', () => {
  it('allows exactly fixed and floating', () => {
    assert.deepEqual([...RATE_REGIME_KINDS], ['fixed', 'floating']);
    assert.equal(isRateRegimeKind('fixed'), true);
    assert.equal(isRateRegimeKind('floating'), true);
    assert.equal(isRateRegimeKind('variable'), false);
  });

  it('floating regime carries index, spread, policy and history', () => {
    const period: RatePeriod = {
      from: toISODate('2024-01-01'),
      to: toISODate('2024-06-30'),
      indexValuePercent: -0.3, // negative Euribor is representable
      totalAppliedRatePercent: null, // unknown stays null
      source: 'bank_statement',
    };
    const regime: RateRegime = {
      kind: 'floating',
      indexType: 'EURIBOR_3M',
      indexLabel: null,
      spreadPercent: 2.5,
      referenceDateRule: '2 εργάσιμες πριν την έναρξη περιόδου',
      resetFrequencyMonths: 3,
      negativeEuriborPolicy: 'unknown',
      rateHistory: [period],
    };
    assert.equal(regime.rateHistory.length, 1);
    assert.equal(regime.rateHistory[0]?.indexValuePercent, -0.3);
    assert.equal(regime.rateHistory[0]?.totalAppliedRatePercent, null);
  });
});

describe('Ν.128/75 statuses', () => {
  it('allows exactly included_in_rate, added_separately, unknown', () => {
    assert.deepEqual(
      [...LAW128_KINDS],
      ['included_in_rate', 'added_separately', 'unknown'],
    );
    assert.equal(isLaw128Kind('unknown'), true);
    assert.equal(isLaw128Kind('not_applicable'), false);
  });

  it('added_separately carries an explicit rate percent', () => {
    const status: Law128Status = { kind: 'added_separately', ratePercent: 0.6 };
    assert.equal(status.ratePercent, 0.6);
  });

  it('unknown status is representable in a RateConfig', () => {
    const config: RateConfig = {
      regime: { kind: 'fixed', annualRatePercent: 4.2 },
      law128: { kind: 'unknown' },
      dayCount: 'unknown',
    };
    assert.equal(config.law128.kind, 'unknown');
  });
});

describe('negative Euribor policy statuses', () => {
  it('allows exactly as_is, floor_zero, unknown', () => {
    assert.deepEqual(
      [...NEGATIVE_EURIBOR_POLICIES],
      ['as_is', 'floor_zero', 'unknown'],
    );
    assert.equal(isNegativeEuriborPolicy('as_is'), true);
    assert.equal(isNegativeEuriborPolicy('floor_zero'), true);
    assert.equal(isNegativeEuriborPolicy('unknown'), true);
    assert.equal(isNegativeEuriborPolicy('cap'), false);
  });
});

describe('day count convention statuses', () => {
  it('allows exactly ACT_360, ACT_365, 30_360, 30E_360, unknown', () => {
    assert.deepEqual(
      [...DAY_COUNT_CONVENTIONS],
      ['ACT_360', 'ACT_365', '30_360', '30E_360', 'unknown'],
    );
    assert.equal(isDayCountConvention('ACT_360'), true);
    assert.equal(isDayCountConvention('unknown'), true);
    assert.equal(isDayCountConvention('ACT_366'), false);
  });
});

describe('loan type kinds', () => {
  it('allows exactly the five supported repayment types', () => {
    assert.deepEqual(
      [...LOAN_TYPE_KINDS],
      [
        'amortizing_equal_installment',
        'equal_principal',
        'interest_only',
        'balloon',
        'custom_bank_schedule',
      ],
    );
    assert.equal(isLoanTypeKind('balloon'), true);
    assert.equal(isLoanTypeKind('bullet'), false);
  });
});

describe('ISO dates', () => {
  it('validates real calendar dates', () => {
    assert.equal(isValidISODate('2026-02-28'), true);
    assert.equal(isValidISODate('2026-02-30'), false);
    assert.equal(isValidISODate('2026-13-01'), false);
    assert.equal(isValidISODate('12/06/2026'), false);
  });

  it('toISODate throws on invalid input', () => {
    assert.throws(() => toISODate('2026-02-30'), DateError);
  });

  it('compareISODate orders chronologically', () => {
    assert.equal(compareISODate(toISODate('2026-01-01'), toISODate('2026-06-12')), -1);
    assert.equal(compareISODate(toISODate('2026-06-12'), toISODate('2026-06-12')), 0);
  });
});
