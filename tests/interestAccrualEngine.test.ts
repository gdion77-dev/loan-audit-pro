/**
 * Tests: interest accrual engine (Step 3-B).
 * Covers the 15 required scenarios plus golden values.
 *
 * The locked rate and day-count engines are used as REAL upstream
 * producers (no mocks), so these tests also verify the integration
 * contract between the three engines.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateAccruedInterest,
  INTEREST_ACCRUAL_AUDIT_CODES as IC,
} from '../src/engines/interestAccrualEngine';
import { resolveRateForDate } from '../src/engines/rateEngine';
import {
  calculateDayCount,
  DAY_COUNT_AUDIT_CODES as DC,
} from '../src/engines/dayCountEngine';
import { VALIDATION_AUDIT_CODES as C } from '../src/domain/auditFactories';
import { toISODate, type DayCountConvention } from '../src/domain/dateTypes';
import type { RateConfig, Law128Status, NegativeEuriborPolicy } from '../src/domain/rateTypes';

const D = toISODate;

/* ------------------------------------------------------------------ */
/* upstream producers (real engines, no mocks)                         */
/* ------------------------------------------------------------------ */

function fixedRate(
  annualRatePercent: number,
  law128: Law128Status = { kind: 'included_in_rate', ratePercent: null },
) {
  const config: RateConfig = {
    regime: { kind: 'fixed', annualRatePercent },
    law128,
    dayCount: 'ACT_360',
  };
  return resolveRateForDate(config, D('2024-03-15'));
}

function floatingRate(args: {
  indexValuePercent: number | null;
  spreadPercent: number;
  negativeEuriborPolicy?: NegativeEuriborPolicy;
  law128?: Law128Status;
  emptyHistory?: boolean;
}) {
  const config: RateConfig = {
    regime: {
      kind: 'floating',
      indexType: 'EURIBOR_3M',
      indexLabel: null,
      spreadPercent: args.spreadPercent,
      referenceDateRule: null,
      resetFrequencyMonths: 3,
      negativeEuriborPolicy: args.negativeEuriborPolicy ?? 'as_is',
      rateHistory: args.emptyHistory
        ? []
        : [
            {
              from: D('2024-01-01'),
              to: D('2024-06-30'),
              indexValuePercent: args.indexValuePercent,
              totalAppliedRatePercent: null,
              source: 'bank_statement',
            },
          ],
    },
    law128: args.law128 ?? { kind: 'included_in_rate', ratePercent: null },
    dayCount: 'ACT_360',
  };
  return resolveRateForDate(config, D('2024-03-15'));
}

function days(start: string, end: string, convention: DayCountConvention) {
  return calculateDayCount(D(start), D(end), convention);
}

/* ------------------------------------------------------------------ */
/* golden basics                                                       */
/* ------------------------------------------------------------------ */

describe('interestAccrualEngine: golden basics', () => {
  it('G1: €10,000 at 6% for 30/360 = exactly €50.00 = 5000 cents (test 1)', () => {
    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: fixedRate(6),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'), // 30 days
    });
    assert.equal(r.status, 'success');
    assert.equal(r.dayCountDays, 30);
    assert.equal(r.interestCents, 5000);
    assert.ok(Math.abs((r.rawInterestAmount ?? 0) - 50) < 1e-9);
    assert.ok(Math.abs(r.roundingDifference ?? 1) < 1e-9);
  });

  it('G2: €10,000 at 6% for 31/365 ≈ €50.96 after half_up rounding (test 2)', () => {
    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: fixedRate(6),
      dayCount: days('2024-03-31', '2024-05-01', 'ACT_365'), // 31 days
    });
    assert.equal(r.status, 'success');
    assert.equal(r.dayCountDays, 31);
    // raw = 10000 * 0.06 * 31/365 = 50.9589041...
    assert.ok(Math.abs((r.rawInterestAmount ?? 0) - 50.958904109589) < 1e-9);
    assert.equal(r.interestCents, 5096); // €50.96
    // rounding difference = 50.96 - 50.9589041... ≈ +0.0010958
    assert.ok(Math.abs((r.roundingDifference ?? 0) - 0.001095890411) < 1e-9);
  });

  it('the base is the OUTSTANDING OPENING BALANCE, never an installment', () => {
    // Same rate/period, doubled balance -> exactly doubled interest.
    const small = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: fixedRate(6),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    const big = calculateAccruedInterest({
      openingBalanceCents: 2_000_000,
      rateResolution: fixedRate(6),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal((small.interestCents ?? 0) * 2, big.interestCents);
  });
});

/* ------------------------------------------------------------------ */
/* balance discipline                                                  */
/* ------------------------------------------------------------------ */

describe('interestAccrualEngine: opening balance discipline', () => {
  it('missing (null) balance returns missing_data + BALANCE_MISSING (test 3)', () => {
    const r = calculateAccruedInterest({
      openingBalanceCents: null,
      rateResolution: fixedRate(6),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.interestCents, null);
    assert.equal(r.rawInterestAmount, null);
    assert.ok(r.auditEntries.some((e) => e.code === IC.BALANCE_MISSING));
  });

  it('explicit zero balance returns success with 0 interest — zero is data (test 4)', () => {
    const r = calculateAccruedInterest({
      openingBalanceCents: 0,
      rateResolution: fixedRate(6),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal(r.status, 'success');
    assert.equal(r.interestCents, 0);
    assert.equal(r.rawInterestAmount, 0);
    assert.equal(r.auditEntries.some((e) => e.code === IC.BALANCE_MISSING), false);
  });

  it('non-integer cents balance is rejected as invalid', () => {
    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000.5,
      rateResolution: fixedRate(6),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal(r.status, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === IC.BALANCE_INVALID));
  });
});

/* ------------------------------------------------------------------ */
/* upstream status handling                                            */
/* ------------------------------------------------------------------ */

describe('interestAccrualEngine: rate status handling', () => {
  it('rate missing_data blocks interest and carries rate audit entries (test 5)', () => {
    const rate = floatingRate({ indexValuePercent: 3.9, spreadPercent: 2, emptyHistory: true });
    assert.equal(rate.status, 'missing_data'); // sanity
    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: rate,
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.interestCents, null);
    // carried forward from the rate engine:
    assert.ok(r.auditEntries.some((e) => e.code === C.RATE_HISTORY_MISSING));
  });

  it('rate requires_review WITH numeric preview -> preview interest, requires_review, marked (test 6)', () => {
    // Ν.128/75 unknown: rate engine yields preview 3.9 + 2.0 = 5.9
    const rate = floatingRate({
      indexValuePercent: 3.9,
      spreadPercent: 2,
      law128: { kind: 'unknown' },
    });
    assert.equal(rate.status, 'requires_review');
    assert.ok(rate.appliedAnnualRatePercent !== null);

    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: rate,
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'), // 30/360
    });
    assert.equal(r.status, 'requires_review');
    // preview interest = 10000 * 0.059 * 30/360 = 49.1666... -> 4917
    assert.equal(r.interestCents, 4917);
    // clearly marked as preview:
    assert.ok(r.auditEntries.some((e) => e.code === IC.INTEREST_PREVIEW_REQUIRES_REVIEW));
    // upstream LAW128_UNKNOWN carried forward:
    assert.ok(r.auditEntries.some((e) => e.code === C.LAW128_UNKNOWN));
  });

  it('rate requires_review with NULL applied rate -> no interest computed (test 7)', () => {
    // negative index with unknown floor policy: rate is null
    const rate = floatingRate({
      indexValuePercent: -0.5,
      spreadPercent: 3,
      negativeEuriborPolicy: 'unknown',
    });
    assert.equal(rate.status, 'requires_review');
    assert.equal(rate.appliedAnnualRatePercent, null);

    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: rate,
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.interestCents, null);
    assert.equal(r.rawInterestAmount, null);
    assert.ok(r.auditEntries.some((e) => e.code === C.NEGATIVE_INDEX_POLICY_UNKNOWN));
  });
});

describe('interestAccrualEngine: day count status handling', () => {
  it('dayCount missing_data blocks interest and carries its audit entries (test 8)', () => {
    const dc = calculateDayCount(null, D('2024-01-31'), 'ACT_360');
    assert.equal(dc.status, 'missing_data'); // sanity
    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: fixedRate(6),
      dayCount: dc,
    });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.interestCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === DC.DAYCOUNT_DATE_MISSING));
  });

  it('dayCount requires_review with null fraction -> no interest (test 9)', () => {
    const dc = calculateDayCount(D('2024-01-01'), D('2024-01-31'), 'unknown');
    assert.equal(dc.status, 'requires_review');
    assert.equal(dc.fractionOfYear, null);

    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: fixedRate(6),
      dayCount: dc,
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.interestCents, null);
    assert.ok(r.auditEntries.some((e) => e.code === DC.DAYCOUNT_UNKNOWN));
  });
});

/* ------------------------------------------------------------------ */
/* negative rates                                                      */
/* ------------------------------------------------------------------ */

describe('interestAccrualEngine: negative rates', () => {
  it('negative applied rate produces negative interest, not silently floored (test 10)', () => {
    // index -3.5 as_is + spread 2.0 => applied -1.5 (success)
    const rate = floatingRate({ indexValuePercent: -3.5, spreadPercent: 2 });
    assert.equal(rate.status, 'success');
    assert.ok((rate.appliedAnnualRatePercent ?? 0) < 0);

    const r = calculateAccruedInterest({
      openingBalanceCents: 1_000_000,
      rateResolution: rate,
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'), // 30/360
    });
    assert.equal(r.status, 'success');
    // raw = 10000 * (-0.015) * (30/360) = -12.50 -> -1250 cents
    assert.equal(r.interestCents, -1250);
    assert.notEqual(r.interestCents, 0); // no silent floor
    const e = r.auditEntries.find((x) => x.code === IC.NEGATIVE_INTEREST_PRODUCED);
    assert.ok(e);
    assert.equal(e.severity, 'info');
  });
});

/* ------------------------------------------------------------------ */
/* rounding & precision                                                */
/* ------------------------------------------------------------------ */

describe('interestAccrualEngine: rounding & precision', () => {
  it('half_up rounds to the nearest cent, half away from zero (test 11)', () => {
    // €100 at 6.06% for 30/360 -> raw = 100*0.0606/12 = 0.505 -> 51 cents
    const r = calculateAccruedInterest({
      openingBalanceCents: 10_000,
      rateResolution: fixedRate(6.06),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal(r.interestCents, 51);
    assert.ok(Math.abs((r.rawInterestAmount ?? 0) - 0.505) < 1e-9);

    // floor / ceil behave as documented on the same raw value
    const floor = calculateAccruedInterest({
      openingBalanceCents: 10_000,
      rateResolution: fixedRate(6.06),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
      roundingMode: 'floor',
    });
    assert.equal(floor.interestCents, 50);
    const ceil = calculateAccruedInterest({
      openingBalanceCents: 10_000,
      rateResolution: fixedRate(6.06),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
      roundingMode: 'ceil',
    });
    assert.equal(ceil.interestCents, 51);
  });

  it('no premature rounding of rate or fraction (test 12)', () => {
    // 6.091636% (golden floating breakdown) for 31 days ACT_360 on €150,000:
    // raw = 150000 * 0.06091636 * 31/360 = 786.834...
    const rate = floatingRate({
      indexValuePercent: 3.971636,
      spreadPercent: 2.0,
      law128: { kind: 'added_separately', ratePercent: 0.12 },
    });
    assert.ok(Math.abs((rate.appliedAnnualRatePercent ?? 0) - 6.091636) < 1e-9);

    const r = calculateAccruedInterest({
      openingBalanceCents: 15_000_000,
      rateResolution: rate,
      dayCount: days('2024-03-31', '2024-05-01', 'ACT_360'), // 31 days
    });
    const expectedRaw = 150_000 * (6.091636 / 100) * (31 / 360);
    assert.ok(Math.abs((r.rawInterestAmount ?? 0) - expectedRaw) < 1e-9);
    assert.equal(r.interestCents, Math.round(expectedRaw * 100));
    // if the rate had been pre-rounded to 6.09%: raw would be 786.625 -> different cents
    const wrongIfRounded = Math.round(150_000 * 0.0609 * (31 / 360) * 100);
    assert.notEqual(r.interestCents, wrongIfRounded);
  });

  it('null values are never converted to zero (test 13)', () => {
    // all three null-producing paths must yield null, never 0:
    const cases = [
      calculateAccruedInterest({
        openingBalanceCents: null,
        rateResolution: fixedRate(6),
        dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
      }),
      calculateAccruedInterest({
        openingBalanceCents: 1_000_000,
        rateResolution: floatingRate({
          indexValuePercent: -0.5,
          spreadPercent: 3,
          negativeEuriborPolicy: 'unknown',
        }),
        dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
      }),
      calculateAccruedInterest({
        openingBalanceCents: 1_000_000,
        rateResolution: fixedRate(6),
        dayCount: calculateDayCount(D('2024-01-01'), D('2024-01-31'), 'unknown'),
      }),
    ];
    for (const r of cases) {
      assert.equal(r.interestCents, null);
      assert.equal(r.rawInterestAmount, null);
      assert.equal(r.roundingDifference, null);
      assert.notEqual(r.interestCents, 0);
    }
    // contrast: the only legitimate zero comes from an explicit zero balance
    const zero = calculateAccruedInterest({
      openingBalanceCents: 0,
      rateResolution: fixedRate(6),
      dayCount: days('2024-01-01', '2024-01-31', 'ACT_360'),
    });
    assert.equal(zero.interestCents, 0);
  });
});

/* ------------------------------------------------------------------ */
/* purity / scope guards                                               */
/* ------------------------------------------------------------------ */

describe('interestAccrualEngine: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/engines/interestAccrualEngine.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no amortization/installment/schedule generation exists or is imported (test 14)', () => {
    assert.equal(/amortiz/i.test(codeOnly), false);
    assert.equal(/installment/i.test(codeOnly), false);
    assert.equal(/schedule/i.test(codeOnly), false);
    assert.equal(/closingBalance|balanceAfter/i.test(codeOnly), false);
    // imports only from domain + the two locked engines:
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const imp of imports) {
      assert.ok(
        imp!.startsWith('../domain/') || imp === './rateEngine' || imp === './dayCountEngine',
        `unexpected import: ${imp}`,
      );
    }
  });

  it('no ΑΠ 6/2026 or Ν.3869 formula/wording exists in code (test 15)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
    // the formula base is the opening balance variable, and no
    // installment-based principal base exists anywhere in code:
    assert.ok(/openingBalanceDecimal\s*\*\s*\(ratePercent\s*\/\s*100\)\s*\*\s*fraction/.test(codeOnly));
  });
});
