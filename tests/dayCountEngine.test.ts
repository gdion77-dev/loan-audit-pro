/**
 * Tests: day count engine (Step 3-A).
 * Covers the 16 required scenarios plus golden values.
 *
 * Inclusion rule under test everywhere: START EXCLUDED, END INCLUDED.
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
  calculateDayCount,
  DAY_COUNT_AUDIT_CODES as DC,
} from '../src/engines/dayCountEngine';
import { toISODate } from '../src/domain/dateTypes';

const D = toISODate;

const closeFraction = (actual: number | null, expected: number, eps = 1e-12): void => {
  assert.ok(actual !== null, `expected ${expected}, got null`);
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} ≈ ${expected}`);
};

/* ------------------------------------------------------------------ */
/* ACT conventions                                                     */
/* ------------------------------------------------------------------ */

describe('dayCountEngine: ACT conventions', () => {
  it('ACT_360 same month: 2024-01-01 -> 2024-01-31 = 30 days (start excluded, end included) (test 1)', () => {
    const r = calculateDayCount(D('2024-01-01'), D('2024-01-31'), 'ACT_360');
    assert.equal(r.status, 'success');
    assert.equal(r.days, 30);
    assert.equal(r.yearBasis, 360);
    closeFraction(r.fractionOfYear, 30 / 360);
  });

  it('ACT_365 same month: 2024-01-01 -> 2024-01-31 = 30 days, basis 365 (test 2)', () => {
    const r = calculateDayCount(D('2024-01-01'), D('2024-01-31'), 'ACT_365');
    assert.equal(r.status, 'success');
    assert.equal(r.days, 30);
    assert.equal(r.yearBasis, 365);
    closeFraction(r.fractionOfYear, 30 / 365);
  });

  it('leap-year February under ACT_360: 2024-01-31 -> 2024-02-29 = 29 days (test 3)', () => {
    const r = calculateDayCount(D('2024-01-31'), D('2024-02-29'), 'ACT_360');
    assert.equal(r.days, 29);
    closeFraction(r.fractionOfYear, 29 / 360);
    // contrast: non-leap year gives 28 — February is not hardcoded
    const nonLeap = calculateDayCount(D('2023-01-31'), D('2023-02-28'), 'ACT_360');
    assert.equal(nonLeap.days, 28);
  });

  it('leap-year February under ACT_365: 2024-01-31 -> 2024-02-29 = 29 days, basis stays 365 (test 4)', () => {
    const r = calculateDayCount(D('2024-01-31'), D('2024-02-29'), 'ACT_365');
    assert.equal(r.days, 29);
    assert.equal(r.yearBasis, 365); // ACT/365 Fixed: basis unchanged in leap years
    closeFraction(r.fractionOfYear, 29 / 365);
  });

  it('full leap year crossing 29 Feb under ACT: 2024-01-01 -> 2025-01-01 = 366 days', () => {
    const r360 = calculateDayCount(D('2024-01-01'), D('2025-01-01'), 'ACT_360');
    const r365 = calculateDayCount(D('2024-01-01'), D('2025-01-01'), 'ACT_365');
    assert.equal(r360.days, 366);
    assert.equal(r365.days, 366);
  });

  it('full year ACT_360: 2023-01-01 -> 2024-01-01 = 365 days, fraction 365/360 > 1 (test 9)', () => {
    const r = calculateDayCount(D('2023-01-01'), D('2024-01-01'), 'ACT_360');
    assert.equal(r.days, 365);
    closeFraction(r.fractionOfYear, 365 / 360);
    assert.ok((r.fractionOfYear ?? 0) > 1); // characteristic of ACT/360
  });

  it('full year ACT_365: 2023-01-01 -> 2024-01-01 = 365 days, fraction exactly 1 (test 10)', () => {
    const r = calculateDayCount(D('2023-01-01'), D('2024-01-01'), 'ACT_365');
    assert.equal(r.days, 365);
    closeFraction(r.fractionOfYear, 1);
  });

  it('zero-length period (start = end) counts 0 days', () => {
    const r = calculateDayCount(D('2024-03-15'), D('2024-03-15'), 'ACT_360');
    assert.equal(r.status, 'success');
    assert.equal(r.days, 0);
    closeFraction(r.fractionOfYear, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 30/360 family                                                       */
/* ------------------------------------------------------------------ */

describe('dayCountEngine: 30/360 family', () => {
  it('30_360 normal month: 2024-01-15 -> 2024-02-15 = 30 days (test 5)', () => {
    const r = calculateDayCount(D('2024-01-15'), D('2024-02-15'), '30_360');
    assert.equal(r.status, 'success');
    assert.equal(r.days, 30);
    assert.equal(r.yearBasis, 360);
    closeFraction(r.fractionOfYear, 30 / 360);
  });

  it('30_360 start day 31 adjustment: 2024-01-31 -> 2024-02-28 (test 6)', () => {
    // D1: 31 -> 30, so days = 30*(2-1) + (28-30) = 28
    const r = calculateDayCount(D('2024-01-31'), D('2024-02-28'), '30_360');
    assert.equal(r.days, 28);
  });

  it('30_360 end day 31 adjustment only when adjusted start is 30 (test 7)', () => {
    // start 31 -> 30, end 31 -> 30 (condition met): Jan 31 -> Mar 31
    const both = calculateDayCount(D('2024-01-31'), D('2024-03-31'), '30_360');
    assert.equal(both.days, 360 * 0 + 30 * 2 + (30 - 30)); // 60

    // start 15 (not 30/31): end 31 stays 31: Jan 15 -> Mar 31
    const endOnly = calculateDayCount(D('2024-01-15'), D('2024-03-31'), '30_360');
    assert.equal(endOnly.days, 30 * 2 + (31 - 15)); // 76 — US rule keeps D2=31
  });

  it('30E_360 adjusts start AND end 31 unconditionally (test 8)', () => {
    // Jan 15 -> Mar 31: under 30E, end 31 -> 30 even though start is 15
    const r = calculateDayCount(D('2024-01-15'), D('2024-03-31'), '30E_360');
    assert.equal(r.days, 30 * 2 + (30 - 15)); // 75 (vs 76 under US 30_360)

    const both = calculateDayCount(D('2024-01-31'), D('2024-03-31'), '30E_360');
    assert.equal(both.days, 60);
  });

  it('30/360 family: full year is exactly 360 days, fraction exactly 1', () => {
    const us = calculateDayCount(D('2023-01-01'), D('2024-01-01'), '30_360');
    const eu = calculateDayCount(D('2023-01-01'), D('2024-01-01'), '30E_360');
    assert.equal(us.days, 360);
    assert.equal(eu.days, 360);
    closeFraction(us.fractionOfYear, 1);
    closeFraction(eu.fractionOfYear, 1);
  });
});

/* ------------------------------------------------------------------ */
/* unknown convention & invalid inputs                                 */
/* ------------------------------------------------------------------ */

describe('dayCountEngine: unknown convention and invalid inputs', () => {
  it('unknown convention returns requires_review + DAYCOUNT_UNKNOWN, no silent ACT_360 (test 11)', () => {
    const r = calculateDayCount(D('2024-01-01'), D('2024-01-31'), 'unknown');
    assert.equal(r.status, 'requires_review');
    assert.equal(r.days, null); // NOT 30 — no silent ACT_360
    assert.equal(r.yearBasis, null);
    assert.equal(r.fractionOfYear, null);
    const e = r.auditEntries.find((x) => x.code === DC.DAYCOUNT_UNKNOWN);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
  });

  it('missing start date returns missing_data (test 12)', () => {
    for (const bad of [null, undefined, '', '2024-13-01', '31/01/2024'] as const) {
      const r = calculateDayCount(bad, D('2024-01-31'), 'ACT_360');
      assert.equal(r.status, 'missing_data');
      assert.equal(r.days, null);
      assert.equal(r.startDate, null);
      assert.ok(r.auditEntries.some((x) => x.code === DC.DAYCOUNT_DATE_MISSING));
    }
  });

  it('missing end date returns missing_data (test 13)', () => {
    const r = calculateDayCount(D('2024-01-01'), null, 'ACT_360');
    assert.equal(r.status, 'missing_data');
    assert.equal(r.days, null);
    assert.equal(r.endDate, null);
  });

  it('end date before start date is rejected, never silently swapped (test 14)', () => {
    const r = calculateDayCount(D('2024-03-31'), D('2024-01-01'), 'ACT_360');
    assert.equal(r.status, 'requires_review');
    assert.equal(r.days, null); // a swapped result would have been 90
    assert.equal(r.fractionOfYear, null);
    const e = r.auditEntries.find((x) => x.code === DC.DATE_RANGE_INVALID);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
    // dates are echoed as given — not reordered:
    assert.equal(r.startDate, '2024-03-31');
    assert.equal(r.endDate, '2024-01-01');
  });
});

/* ------------------------------------------------------------------ */
/* precision & purity                                                  */
/* ------------------------------------------------------------------ */

describe('dayCountEngine: precision and purity', () => {
  it('fraction precision is preserved, no internal rounding (test 15)', () => {
    // 31 days / 360 = 0.08611111... — must not collapse to 0.09 or 0.0861
    const r = calculateDayCount(D('2024-03-31'), D('2024-05-01'), 'ACT_360');
    assert.equal(r.days, 31);
    closeFraction(r.fractionOfYear, 31 / 360, 1e-15);
    assert.notEqual(r.fractionOfYear, 0.09);
    assert.notEqual(r.fractionOfYear, 0.0861);

    // 145 / 365 = 0.39726027397...
    const r2 = calculateDayCount(D('2024-01-01'), D('2024-05-25'), 'ACT_365');
    assert.equal(r2.days, 145);
    closeFraction(r2.fractionOfYear, 145 / 365, 1e-15);
  });

  it('engine source contains no interest/money/amortization logic (test 16)', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, '../src/engines/dayCountEngine.ts'),
      'utf8',
    );
    // no Money imports, no balances, no installment computation:
    assert.equal(/from\s+'\.\.\/domain\/money'/.test(source), false);
    assert.equal(/\bMoney\b/.test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')), false);
    assert.equal(/installment|amortiz|openingBalance|closingBalance/i
      .test(source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '')), false);
  });
});
