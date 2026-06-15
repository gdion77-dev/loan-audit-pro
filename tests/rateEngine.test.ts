/**
 * Tests: rate engine (Step 2-A).
 * Covers the 14 required scenarios. Runner: node:test via tsx
 * (registry unavailable in this environment; structure is
 * vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveRateForDate } from '../src/engines/rateEngine';
import { VALIDATION_AUDIT_CODES as C } from '../src/domain/auditFactories';
import { toISODate } from '../src/domain/dateTypes';
import type { RateConfig, RatePeriod } from '../src/domain/rateTypes';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const D = toISODate;

const fixedConfig = (overrides: Partial<RateConfig> = {}): RateConfig => ({
  regime: { kind: 'fixed', annualRatePercent: 4.2 },
  law128: { kind: 'added_separately', ratePercent: 0.6 },
  dayCount: 'ACT_360',
  ...overrides,
});

const period = (overrides: Partial<RatePeriod> = {}): RatePeriod => ({
  from: D('2024-01-01'),
  to: D('2024-06-30'),
  indexValuePercent: 3.9,
  totalAppliedRatePercent: null,
  source: 'bank_statement',
  ...overrides,
});

const floatingConfig = (
  regimeOverrides: Partial<Extract<RateConfig['regime'], { kind: 'floating' }>> = {},
  configOverrides: Partial<Omit<RateConfig, 'regime'>> = {},
): RateConfig => ({
  regime: {
    kind: 'floating',
    indexType: 'EURIBOR_3M',
    indexLabel: null,
    spreadPercent: 2.5,
    referenceDateRule: null,
    resetFrequencyMonths: 3,
    negativeEuriborPolicy: 'as_is',
    rateHistory: [period()],
    ...regimeOverrides,
  },
  law128: { kind: 'added_separately', ratePercent: 0.6 },
  dayCount: 'ACT_360',
  ...configOverrides,
});

const close = (a: number | null, b: number, eps = 1e-9): void => {
  assert.ok(a !== null, 'expected a number, got null');
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);
};

/* ------------------------------------------------------------------ */
/* fixed rate                                                          */
/* ------------------------------------------------------------------ */

describe('rateEngine: fixed rate', () => {
  it('returns the fixed annual rate (test 1)', () => {
    const r = resolveRateForDate(
      fixedConfig({ law128: { kind: 'included_in_rate', ratePercent: null } }),
      D('2024-03-15'),
    );
    assert.equal(r.status, 'success');
    close(r.appliedAnnualRatePercent, 4.2);
    assert.equal(r.nominalIndexPercent, null);
    assert.equal(r.effectiveIndexPercent, null);
    assert.equal(r.spreadPercent, null);
    assert.equal(r.source, 'contract');
  });

  it('missing fixed annualRatePercent returns missing_data (test 2)', () => {
    const r = resolveRateForDate(
      fixedConfig({
        regime: { kind: 'fixed', annualRatePercent: undefined as unknown as number },
      }),
      D('2024-03-15'),
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.appliedAnnualRatePercent, null);
    assert.equal(r.source, 'missing');
    assert.ok(r.auditEntries.some((e) => e.code === C.RATE_FIXED_MISSING));
  });

  it('fixed + Law128 added_separately adds the levy on top', () => {
    const r = resolveRateForDate(fixedConfig(), D('2024-03-15'));
    assert.equal(r.status, 'success');
    close(r.totalBeforeLaw128Percent, 4.2);
    close(r.law128Percent, 0.6);
    close(r.totalAfterLaw128Percent, 4.8);
    close(r.appliedAnnualRatePercent, 4.8);
  });
});

/* ------------------------------------------------------------------ */
/* floating rate: period selection                                     */
/* ------------------------------------------------------------------ */

describe('rateEngine: floating period selection', () => {
  const history = [
    period({ from: D('2024-01-01'), to: D('2024-03-31'), indexValuePercent: 3.9 }),
    period({ from: D('2024-04-01'), to: D('2024-06-30'), indexValuePercent: 3.7, source: 'public_index' }),
  ];

  it('selects the correct RatePeriod by target date (test 3)', () => {
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: history }),
      D('2024-05-10'),
    );
    assert.equal(r.status, 'success');
    close(r.nominalIndexPercent, 3.7);
    assert.equal(r.source, 'public_index');
    close(r.totalBeforeLaw128Percent, 3.7 + 2.5);
    close(r.appliedAnnualRatePercent, 3.7 + 2.5 + 0.6);
  });

  it('boundary dates (from and to) are inclusive', () => {
    const a = resolveRateForDate(floatingConfig({ rateHistory: history }), D('2024-01-01'));
    const b = resolveRateForDate(floatingConfig({ rateHistory: history }), D('2024-03-31'));
    close(a.nominalIndexPercent, 3.9);
    close(b.nominalIndexPercent, 3.9);
  });

  it('missing period returns missing_data with RATE_HISTORY_MISSING (test 4)', () => {
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: history }),
      D('2025-01-15'),
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.appliedAnnualRatePercent, null);
    assert.equal(r.source, 'missing');
    const e = r.auditEntries.find((x) => x.code === C.RATE_HISTORY_MISSING);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
  });

  it('no interpolation and no nearest-rate fallback occurs (test 13)', () => {
    // Gap between the two periods: 2024-07-01..2024-12-31 not covered.
    const gapped = [
      period({ from: D('2024-01-01'), to: D('2024-06-30'), indexValuePercent: 3.9 }),
      period({ from: D('2025-01-01'), to: D('2025-06-30'), indexValuePercent: 2.9 }),
    ];
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: gapped }),
      D('2024-09-15'), // inside the gap, "near" both periods
    );
    assert.equal(r.status, 'missing_data');
    // Neither neighbour's value, nor any interpolated value, leaks out:
    assert.equal(r.nominalIndexPercent, null);
    assert.equal(r.effectiveIndexPercent, null);
    assert.equal(r.totalBeforeLaw128Percent, null);
    assert.equal(r.totalAfterLaw128Percent, null);
    assert.equal(r.appliedAnnualRatePercent, null);
  });

  it('empty rate history returns missing_data', () => {
    const r = resolveRateForDate(floatingConfig({ rateHistory: [] }), D('2024-02-01'));
    assert.equal(r.status, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === C.RATE_HISTORY_MISSING));
  });

  it('overlapping periods use the first and emit a warning', () => {
    const overlapping = [
      period({ from: D('2024-01-01'), to: D('2024-06-30'), indexValuePercent: 3.9 }),
      period({ from: D('2024-06-01'), to: D('2024-12-31'), indexValuePercent: 3.5 }),
    ];
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: overlapping }),
      D('2024-06-15'),
    );
    assert.equal(r.status, 'success');
    close(r.nominalIndexPercent, 3.9); // first registered period
    assert.ok(r.auditEntries.some((e) => e.code === C.CONTRACT_SCHEDULE_MISMATCH));
  });

  it('period with null index value returns missing_data (no inference from bank total)', () => {
    const r = resolveRateForDate(
      floatingConfig({
        rateHistory: [period({ indexValuePercent: null, totalAppliedRatePercent: 6.4 })],
      }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.appliedAnnualRatePercent, null);
    const e = r.auditEntries.find((x) => x.code === C.MISSING_INDEX_VALUE);
    assert.ok(e);
    // the bank-stated total is surfaced for manual review, never applied
    assert.equal((e.context as Record<string, unknown>)['bankStatedTotalPercent'], 6.4);
  });
});

/* ------------------------------------------------------------------ */
/* negative index policies                                             */
/* ------------------------------------------------------------------ */

describe('rateEngine: negative index policy', () => {
  const negHistory = [period({ indexValuePercent: -0.3 })];

  it('as_is keeps the negative index (test 5)', () => {
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: negHistory, negativeEuriborPolicy: 'as_is' }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'success');
    close(r.nominalIndexPercent, -0.3);
    close(r.effectiveIndexPercent, -0.3);
    close(r.totalBeforeLaw128Percent, -0.3 + 2.5);
    close(r.appliedAnnualRatePercent, -0.3 + 2.5 + 0.6);
  });

  it('floor_zero uses 0 as effective index (test 6)', () => {
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: negHistory, negativeEuriborPolicy: 'floor_zero' }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'success');
    close(r.nominalIndexPercent, -0.3); // nominal stays visible
    close(r.effectiveIndexPercent, 0);
    close(r.totalBeforeLaw128Percent, 2.5);
    close(r.appliedAnnualRatePercent, 3.1);
    // flooring is explicit, never silent
    assert.ok(r.auditEntries.some((e) => e.code === C.EXPLICIT_ASSUMPTION));
  });

  it('unknown policy with negative index returns requires_review, applied rate null (test 7)', () => {
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: negHistory, negativeEuriborPolicy: 'unknown' }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'requires_review');
    assert.equal(r.appliedAnnualRatePercent, null);
    assert.equal(r.effectiveIndexPercent, null); // no silent choice
    close(r.nominalIndexPercent, -0.3); // facts remain visible
    close(r.spreadPercent, 2.5);
    const e = r.auditEntries.find((x) => x.code === C.NEGATIVE_INDEX_POLICY_UNKNOWN);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
  });

  it('unknown policy with NON-negative index resolves normally (policy not triggered)', () => {
    const r = resolveRateForDate(
      floatingConfig({ negativeEuriborPolicy: 'unknown' }), // index 3.9
      D('2024-02-01'),
    );
    assert.equal(r.status, 'success');
    close(r.appliedAnnualRatePercent, 3.9 + 2.5 + 0.6);
    // still flagged as info for transparency
    assert.ok(
      r.auditEntries.some(
        (e) => e.code === C.NEGATIVE_INDEX_POLICY_UNKNOWN && e.severity === 'info',
      ),
    );
  });
});

/* ------------------------------------------------------------------ */
/* spread                                                              */
/* ------------------------------------------------------------------ */

describe('rateEngine: spread', () => {
  it('missing spread returns missing_data with RATE_SPREAD_MISSING (test 8)', () => {
    const r = resolveRateForDate(
      floatingConfig({ spreadPercent: undefined as unknown as number }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.appliedAnnualRatePercent, null);
    assert.equal(r.spreadPercent, null);
    close(r.nominalIndexPercent, 3.9); // known fact stays visible
    const e = r.auditEntries.find((x) => x.code === C.RATE_SPREAD_MISSING);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
  });
});

/* ------------------------------------------------------------------ */
/* Ν.128/75                                                            */
/* ------------------------------------------------------------------ */

describe('rateEngine: Ν.128/75', () => {
  it('included_in_rate adds no extra levy (test 9)', () => {
    const r = resolveRateForDate(
      floatingConfig({}, { law128: { kind: 'included_in_rate', ratePercent: 0.6 } }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'success');
    close(r.law128Percent, 0); // 0 for addition purposes
    close(r.totalBeforeLaw128Percent, 3.9 + 2.5);
    close(r.totalAfterLaw128Percent, 3.9 + 2.5); // unchanged
    // audit info documents that the levy is included
    assert.ok(
      r.auditEntries.some(
        (e) => e.severity === 'info' && e.message.includes('128/75'),
      ),
    );
  });

  it('added_separately adds the configured levy (test 10)', () => {
    const r = resolveRateForDate(
      floatingConfig({}, { law128: { kind: 'added_separately', ratePercent: 0.12 } }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'success');
    close(r.law128Percent, 0.12);
    close(r.totalAfterLaw128Percent, 3.9 + 2.5 + 0.12);
    close(r.appliedAnnualRatePercent, 3.9 + 2.5 + 0.12);
  });

  it('unknown returns requires_review with LAW128_UNKNOWN and a numeric preview (test 12)', () => {
    const r = resolveRateForDate(
      floatingConfig({}, { law128: { kind: 'unknown' } }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'requires_review'); // never success
    // numeric PREVIEW exists: index + spread, WITHOUT the levy
    close(r.appliedAnnualRatePercent, 3.9 + 2.5);
    close(r.totalBeforeLaw128Percent, 3.9 + 2.5);
    assert.equal(r.law128Percent, null); // unknown is null, never 0
    assert.equal(r.totalAfterLaw128Percent, null); // nothing finalized
    const e = r.auditEntries.find((x) => x.code === C.LAW128_UNKNOWN);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
  });

  it('unknown with NO numeric availability stays missing_data, not requires_review', () => {
    // floating, law128 unknown, but no rate period covers the date:
    // no numeric preview can be produced -> missing_data wins
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: [] }, { law128: { kind: 'unknown' } }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.appliedAnnualRatePercent, null);
  });

  it('fixed rate with unknown Law128 gives numeric preview, requires_review', () => {
    const r = resolveRateForDate(
      fixedConfig({ law128: { kind: 'unknown' } }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'requires_review');
    close(r.appliedAnnualRatePercent, 4.2); // preview = base, no levy
    close(r.totalBeforeLaw128Percent, 4.2);
    assert.equal(r.law128Percent, null);
    assert.equal(r.totalAfterLaw128Percent, null);
  });

  it('fixed rate adds the levy ONLY when explicitly added_separately (test 3)', () => {
    // included_in_rate: no addition even though a ratePercent is recorded
    const included = resolveRateForDate(
      fixedConfig({ law128: { kind: 'included_in_rate', ratePercent: 0.6 } }),
      D('2024-02-01'),
    );
    assert.equal(included.status, 'success');
    close(included.appliedAnnualRatePercent, 4.2); // NOT 4.8
    close(included.law128Percent, 0);

    // added_separately: explicit addition
    const added = resolveRateForDate(fixedConfig(), D('2024-02-01'));
    close(added.appliedAnnualRatePercent, 4.8);
  });
});

/* ------------------------------------------------------------------ */
/* day count                                                           */
/* ------------------------------------------------------------------ */

describe('rateEngine: day count convention', () => {
  it('unknown day count creates an assumption but does not block resolution (test 12)', () => {
    const r = resolveRateForDate(
      floatingConfig({}, { dayCount: 'unknown' }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'success'); // not blocked
    close(r.appliedAnnualRatePercent, 3.9 + 2.5 + 0.6);
    const e = r.auditEntries.find((x) => x.code === C.DAYCOUNT_UNKNOWN);
    assert.ok(e);
    assert.equal(e.severity, 'assumption');
  });

  it('known day count produces no day-count entry', () => {
    const r = resolveRateForDate(floatingConfig(), D('2024-02-01'));
    assert.equal(r.auditEntries.some((e) => e.code === C.DAYCOUNT_UNKNOWN), false);
  });
});

/* ------------------------------------------------------------------ */
/* precision                                                           */
/* ------------------------------------------------------------------ */

describe('rateEngine: precision', () => {
  it('preserves at least 6 decimal places through the breakdown (test 14)', () => {
    const r = resolveRateForDate(
      floatingConfig(
        {
          spreadPercent: 2.123456,
          rateHistory: [period({ indexValuePercent: 1.000001 })],
        },
        { law128: { kind: 'added_separately', ratePercent: 0.654321 } },
      ),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'success');
    close(r.totalBeforeLaw128Percent, 3.123457, 1e-9);
    close(r.totalAfterLaw128Percent, 3.777778, 1e-9);
    close(r.appliedAnnualRatePercent, 3.777778, 1e-9);
    // no premature rounding to 2 decimals anywhere:
    assert.notEqual(r.appliedAnnualRatePercent, 3.78);
  });

  it('negative as_is arithmetic keeps full precision', () => {
    const r = resolveRateForDate(
      floatingConfig({
        rateHistory: [period({ indexValuePercent: -0.532001 })],
        spreadPercent: 2.847002,
      }),
      D('2024-02-01'),
    );
    close(r.totalBeforeLaw128Percent, 2.315001, 1e-9);
    close(r.appliedAnnualRatePercent, 2.915001, 1e-9);
  });
});

/* ------------------------------------------------------------------ */
/* null discipline                                                     */
/* ------------------------------------------------------------------ */

describe('rateEngine: null values are never converted to zero (test 16)', () => {
  it('missing period: every numeric output stays null, not 0', () => {
    const r = resolveRateForDate(floatingConfig({ rateHistory: [] }), D('2024-02-01'));
    for (const v of [
      r.appliedAnnualRatePercent,
      r.nominalIndexPercent,
      r.effectiveIndexPercent,
      r.spreadPercent,
      r.law128Percent,
      r.totalBeforeLaw128Percent,
      r.totalAfterLaw128Percent,
    ]) {
      assert.equal(v, null);
      assert.notEqual(v, 0);
    }
  });

  it('null index value stays null and is not summed as 0 with the spread', () => {
    const r = resolveRateForDate(
      floatingConfig({ rateHistory: [period({ indexValuePercent: null })] }),
      D('2024-02-01'),
    );
    assert.equal(r.status, 'missing_data');
    assert.equal(r.nominalIndexPercent, null);
    // if null had been coerced to 0, these would equal the spread (2.5):
    assert.equal(r.totalBeforeLaw128Percent, null);
    assert.equal(r.appliedAnnualRatePercent, null);
  });

  it('unknown Law128: law128Percent stays null in the preview, not 0', () => {
    const r = resolveRateForDate(
      floatingConfig({}, { law128: { kind: 'unknown' } }),
      D('2024-02-01'),
    );
    assert.equal(r.law128Percent, null);
    assert.equal(r.totalAfterLaw128Percent, null);
    // distinct from included_in_rate, where 0 is an explicit value:
    const included = resolveRateForDate(
      floatingConfig({}, { law128: { kind: 'included_in_rate', ratePercent: null } }),
      D('2024-02-01'),
    );
    assert.equal(included.law128Percent, 0);
  });

  it('unknown negative-index policy: effective index stays null, not floored to 0', () => {
    const r = resolveRateForDate(
      floatingConfig({
        rateHistory: [period({ indexValuePercent: -0.3 })],
        negativeEuriborPolicy: 'unknown',
      }),
      D('2024-02-01'),
    );
    assert.equal(r.effectiveIndexPercent, null);
    assert.equal(r.appliedAnnualRatePercent, null); // no preview without policy
    assert.equal(r.totalBeforeLaw128Percent, null);
  });
});
