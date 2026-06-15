/**
 * Tests: findings engine (Step 6-B).
 * Covers the 23 required scenarios. The locked comparison engine
 * produces real inputs (no mocks).
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
  generateFindings,
  findForbiddenFindingTerms,
  FINDINGS_AUDIT_CODES as FC,
  type TechnicalFinding,
} from '../src/engines/findingsEngine';
import {
  compareSchedules,
  SCHEDULE_COMPARISON_AUDIT_CODES as SC,
  type ScheduleComparisonResult,
} from '../src/engines/scheduleComparisonEngine';
import { moneyFromCents, type NullableMoney } from '../src/domain/money';
import { toISODate } from '../src/domain/dateTypes';
import { warning } from '../src/domain/auditFactories';
import type { BankScheduleRow, RecalcRow } from '../src/domain/scheduleTypes';

const D = toISODate;
const M = (cents: number) => moneyFromCents(cents);

function bankRow(args: {
  rowId: string;
  dueDate: string;
  installment?: number | null;
  principal?: number | null;
  interest?: number | null;
  balance?: number | null;
}): BankScheduleRow {
  const c = (v: number | null | undefined, def: number): NullableMoney =>
    v === null ? null : M(v ?? def);
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    installmentAmount: c(args.installment, 64_708),
    principalPortion: c(args.principal, 40_000),
    interestPortion: c(args.interest, 24_708),
    feesAndPremiums: M(0),
    balanceAfter: c(args.balance, 960_000),
    paymentStatus: 'unknown',
    rawText: null,
    sourcePage: null,
    sourceConfidence: 'manual_entry',
  };
}

function recalcRow(args: {
  rowId: string;
  dueDate: string;
  installment?: number;
  principal?: number;
  interest?: number;
  balance?: number;
}): RecalcRow {
  return {
    rowId: args.rowId,
    dueDate: D(args.dueDate),
    openingBalance: M(1_000_000),
    appliedAnnualRatePercent: 6,
    rateBreakdown: { indexPercent: null, spreadPercent: null, law128Percent: 0, totalPercent: 6 },
    dayCountDays: 30,
    interest: M(args.interest ?? 24_708),
    principal: M(args.principal ?? 40_000),
    installment: M(args.installment ?? 64_708),
    closingBalance: M(args.balance ?? 960_000),
    assumptions: [],
  };
}

const identical = () =>
  compareSchedules({
    bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
    recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
  });

const byTitle = (findings: readonly TechnicalFinding[], part: string) =>
  findings.filter((f) => f.title.includes(part));

/* ------------------------------------------------------------------ */
/* clean & signed findings                                             */
/* ------------------------------------------------------------------ */

describe('findingsEngine: clean & signed findings', () => {
  it('zero differences -> neutral info finding with the exact sentence (test 1)', () => {
    const r = generateFindings({ comparisonResult: identical() });
    assert.equal(r.status, 'success');
    const f = r.findings.find((x) => x.level === 'info' && x.source === 'comparison');
    assert.ok(f);
    assert.equal(
      f.description,
      'Δεν εντοπίστηκε οικονομική απόκλιση άνω του κατωφλίου σημαντικότητας στα συγκρινόμενα δεδομένα.',
    );
    assert.equal(f.reportSafe, true);
  });

  it('positive economic difference -> finding explains bank higher (tests 2, 23)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_240 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_708 })],
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = byTitle(r.findings, 'απόκλιση δόσης')[0];
    assert.ok(f);
    assert.equal(f.amountCents, 532); // bank − recalculated, locked sign
    assert.ok(f.description.includes('υψηλότερο από τον επανυπολογισμό'));
    assert.equal(f.level, 'deviation');
  });

  it('negative economic difference -> finding explains recalculation higher (test 3)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 64_708 })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31', installment: 64_891 })],
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = byTitle(r.findings, 'απόκλιση δόσης')[0];
    assert.ok(f);
    assert.equal(f.amountCents, -183);
    assert.ok(f.description.includes('επανυπολογισμός είναι υψηλότερος'));
  });
});

/* ------------------------------------------------------------------ */
/* grouped material differences                                        */
/* ------------------------------------------------------------------ */

describe('findingsEngine: grouped material differences', () => {
  const cmp = compareSchedules({
    bankRows: [
      bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 65_000, interest: 25_500, principal: 39_500, balance: 961_000 }),
      bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: 65_100, interest: 25_400, principal: 39_700, balance: 960_500 }),
    ],
    recalcRows: [
      recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
      recalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
    ],
  });
  const r = generateFindings({ comparisonResult: cmp });

  it('material installment differences grouped into ONE finding (test 4)', () => {
    const fs = byTitle(r.findings, 'απόκλιση δόσης');
    assert.equal(fs.length, 1);
    assert.equal(fs[0]!.count, 2);
    assert.equal(fs[0]!.amountCents, (65_000 - 64_708) + (65_100 - 64_708));
    assert.deepEqual([...fs[0]!.affectedPeriods], ['2024-01-31', '2024-02-29']);
  });

  it('material interest differences grouped (test 5)', () => {
    const fs = byTitle(r.findings, 'απόκλιση τόκων');
    assert.equal(fs.length, 1);
    assert.equal(fs[0]!.amountCents, (25_500 - 24_708) + (25_400 - 24_708));
  });

  it('material principal differences grouped (test 6)', () => {
    const fs = byTitle(r.findings, 'απόκλιση χρεολυσίου');
    assert.equal(fs.length, 1);
    assert.equal(fs[0]!.amountCents, (39_500 - 40_000) + (39_700 - 40_000)); // negative
    assert.ok(fs[0]!.description.includes('επανυπολογισμός είναι υψηλότερος'));
  });

  it('material balance differences grouped (test 7)', () => {
    const fs = byTitle(r.findings, 'απόκλιση υπολοίπου κεφαλαίου');
    assert.equal(fs.length, 1);
    assert.equal(fs[0]!.amountCents, (961_000 - 960_000) + (960_500 - 960_000));
  });
});

/* ------------------------------------------------------------------ */
/* missing data & review propagation                                   */
/* ------------------------------------------------------------------ */

describe('findingsEngine: missing data & review propagation', () => {
  it('missing_data comparison -> missing_data, no fake amounts (test 8)', () => {
    const cmp = compareSchedules({ bankRows: [], recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })] });
    const r = generateFindings({ comparisonResult: cmp });
    assert.equal(r.status, 'missing_data');
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0]!.amountCents, null);
    assert.equal(r.findings[0]!.level, 'missing_data');
    assert.ok(r.auditEntries.some((e) => e.code === FC.FINDINGS_NOT_FINALIZABLE));
  });

  it('requires_review comparison still produces available findings (test 9)', () => {
    const cmp = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 66_000 }), // material
        bankRow({ rowId: 'b2', dueDate: '2024-06-30' }), // unmatched
      ],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const r = generateFindings({ comparisonResult: cmp });
    assert.equal(r.status, 'requires_review');
    assert.ok(byTitle(r.findings, 'απόκλιση δόσης').length === 1);
    assert.ok(byTitle(r.findings, 'Μη αντιστοιχισμένες γραμμές τράπεζας').length === 1);
  });

  it('unmatched bank rows create a finding with row context (test 10)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' }), bankRow({ rowId: 'b2', dueDate: '2024-06-30' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = byTitle(r.findings, 'Μη αντιστοιχισμένες γραμμές τράπεζας')[0];
    assert.ok(f);
    assert.equal(f.source, 'audit');
    assert.deepEqual([...f.affectedRowIds], ['b2']);
  });

  it('unmatched recalc rows create a finding (test 11)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-29' })],
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = byTitle(r.findings, 'Μη αντιστοιχισμένες γραμμές επανυπολογισμού')[0];
    assert.ok(f);
    assert.deepEqual([...f.affectedRowIds], ['r2']);
  });

  it('ambiguous date match creates requires_review finding (test 12)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-02-02' })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), recalcRow({ rowId: 'r2', dueDate: '2024-02-04' })],
      dateToleranceDays: 5,
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = byTitle(r.findings, 'Μη μονοσήμαντη αντιστοίχιση')[0];
    assert.ok(f);
    assert.equal(f.level, 'requires_review');
    assert.equal(r.status, 'requires_review');
  });

  it('missing bank values create missing_data finding (test 13)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', interest: null })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = byTitle(r.findings, 'Ελλιπή δεδομένα τράπεζας')[0];
    assert.ok(f);
    assert.equal(f.level, 'missing_data');
    assert.equal(f.amountCents, null);
  });

  it('missing recalc values create missing_data finding (test 14)', () => {
    const broken = { ...recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }), interest: null as never } as RecalcRow;
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31' })],
      recalcRows: [broken],
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = byTitle(r.findings, 'Ελλιπή δεδομένα επανυπολογισμού')[0];
    assert.ok(f);
    assert.equal(f.level, 'missing_data');
  });
});

/* ------------------------------------------------------------------ */
/* summary finding                                                     */
/* ------------------------------------------------------------------ */

describe('findingsEngine: summary finding', () => {
  it('summary finding includes coverage counts (test 15)', () => {
    const cmp = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31' }),
        bankRow({ rowId: 'b2', dueDate: '2024-06-30' }), // unmatched
      ],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    const r = generateFindings({ comparisonResult: cmp });
    const f = r.findings.find((x) => x.source === 'summary');
    assert.ok(f);
    assert.ok(f.description.includes('1 συγκρινόμενες περίοδοι'));
    assert.ok(f.description.includes('1 μη αντιστοιχισμένες γραμμές τράπεζας'));
    assert.equal(f.count, 1);
  });

  it('null totals described as not finalizable, never zero (test 16)', () => {
    const cmp = compareSchedules({
      bankRows: [bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: null })],
      recalcRows: [recalcRow({ rowId: 'r1', dueDate: '2024-01-31' })],
    });
    assert.equal(cmp.summary?.totalEconomicDifferenceCents, null); // sanity
    const r = generateFindings({ comparisonResult: cmp });
    const f = r.findings.find((x) => x.source === 'summary');
    assert.ok(f);
    assert.equal(f.amountCents, null);
    assert.ok(f.description.includes('δεν οριστικοποιείται λόγω ελλιπών δεδομένων'));
    assert.equal(f.description.includes('0,00 €'), false); // no fake zero total
  });
});

/* ------------------------------------------------------------------ */
/* wording safety                                                      */
/* ------------------------------------------------------------------ */

describe('findingsEngine: wording safety', () => {
  it('all generated wording passes the forbidden-terms guard (test 17)', () => {
    const cmp = compareSchedules({
      bankRows: [
        bankRow({ rowId: 'b1', dueDate: '2024-01-31', installment: 70_000, interest: 30_000, principal: 35_000, balance: 970_000 }),
        bankRow({ rowId: 'b2', dueDate: '2024-02-29', installment: null }),
        bankRow({ rowId: 'b3', dueDate: '2024-06-30' }),
      ],
      recalcRows: [
        recalcRow({ rowId: 'r1', dueDate: '2024-01-31' }),
        recalcRow({ rowId: 'r2', dueDate: '2024-02-29' }),
      ],
    });
    const r = generateFindings({ comparisonResult: cmp });
    for (const f of r.findings) {
      assert.deepEqual([...findForbiddenFindingTerms(f.title)], [], f.title);
      assert.deepEqual([...findForbiddenFindingTerms(f.description)], [], f.description);
      assert.equal(f.reportSafe, true);
    }
  });

  it('injected forbidden wording -> reportSafe false + audit warning (test 18)', () => {
    const base = identical();
    // inject a poisoned comparison audit entry, as could arrive from
    // upstream free text:
    const poisoned: ScheduleComparisonResult = {
      ...base,
      status: 'requires_review',
      auditEntries: [
        ...base.auditEntries,
        warning(
          SC.UNMATCHED_BANK_ROW,
          'Το ποσό είναι προς επιστροφή ως αχρεωστήτως καταβληθέν και η τράπεζα οφείλει αποζημίωση.',
          { rowRefs: ['b9'], occurrences: 1 },
        ),
      ],
    };
    const r = generateFindings({ comparisonResult: poisoned });
    const f = r.findings.find((x) => x.source === 'audit' && !x.reportSafe);
    assert.ok(f, 'expected a non-report-safe finding');
    const e = r.auditEntries.find((x) => x.code === FC.FINDING_NOT_REPORT_SAFE);
    assert.ok(e);
    assert.ok(((e.context as Record<string, unknown>)['terms'] as string[]).includes('προς επιστροφή'));
    assert.equal(r.status, 'requires_review');
  });

  it('the extra forbidden list is detected (δικαιούται, αγωγή, ...)', () => {
    assert.ok(findForbiddenFindingTerms('Ο οφειλέτης δικαιούται επιστροφή.').includes('δικαιούται'));
    assert.ok(findForbiddenFindingTerms('Συνιστάται ΑΓΩΓΗ.').includes('αγωγή'));
    assert.deepEqual([...findForbiddenFindingTerms('Οικονομική απόκλιση· απαιτείται έλεγχος.')], []);
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('findingsEngine: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../src/engines/findingsEngine.ts'), 'utf8');
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no schedule generation / amortization logic (test 19)', () => {
    assert.equal(/buildEqual|buildSingleRecalcRow|allocateSinglePayment|addOneMonth|Math\.pow/.test(codeOnly), false);
    // the comparison engine is imported for types/codes only, never re-run:
    assert.equal(/compareSchedules\s*\(/.test(codeOnly), false);
  });

  it('no interest / rate / day-count formula logic (test 20)', () => {
    assert.equal(/resolveRateForDate|calculateDayCount|calculateAccruedInterest|fractionOfYear|yearBasis|toPrecision/.test(codeOnly), false);
  });

  it('no UI/PDF/Excel/reconciliation logic (test 21)', () => {
    assert.equal(/\bpdf\b|\bexcel\b|\bxlsx\b|document\.|window\.|React|matchedScheduleRowId|ActualPayment/i.test(codeOnly), false);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording/formula (test 22)', () => {
    assert.equal(/6\s*\/\s*2026/.test(codeOnly), false);
    assert.equal(/3869/.test(codeOnly), false);
  });
});
