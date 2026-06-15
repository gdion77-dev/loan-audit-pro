/**
 * Tests: domain validators (Step 1-B).
 * Covers the 12 required scenarios plus null≠0 discipline.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCaseInfo,
  validateRateConfig,
  validateBankScheduleRows,
  validateActualPayments,
  validateNeutralReportText,
  validateReadyForCalculation,
} from '../src/domain/validators';
import { VALIDATION_AUDIT_CODES as C } from '../src/domain/auditFactories';
import { moneyFromCents } from '../src/domain/money';
import { toISODate } from '../src/domain/dateTypes';
import type { CaseInfo } from '../src/domain/loanTypes';
import type { RateConfig } from '../src/domain/rateTypes';
import type { BankScheduleRow } from '../src/domain/scheduleTypes';
import type { ActualPayment } from '../src/domain/paymentTypes';
import type { AuditEntry } from '../src/domain/auditTypes';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const validCase: CaseInfo = {
  caseId: 'CASE-001',
  debtorName: 'Δοκιμαστικός Οφειλέτης',
  contractNumber: '123456789',
  institution: 'Τράπεζα Α',
  servicer: null,
  contractDate: toISODate('2018-03-15'),
  restructuringDate: null,
  principal: moneyFromCents(15_000_000),
  currency: 'EUR',
  startDate: toISODate('2018-04-01'),
  endDate: toISODate('2033-04-01'),
  termMonths: 180,
  notes: null,
};

const fixedRate: RateConfig = {
  regime: { kind: 'fixed', annualRatePercent: 4.2 },
  law128: { kind: 'added_separately', ratePercent: 0.6 },
  dayCount: 'ACT_360',
};

function bankRow(overrides: Partial<BankScheduleRow> & { rowId: string; dueDate: string }): BankScheduleRow {
  return {
    installmentAmount: moneyFromCents(64_708),
    principalPortion: moneyFromCents(40_000),
    interestPortion: moneyFromCents(24_708),
    feesAndPremiums: null,
    balanceAfter: moneyFromCents(14_960_000),
    paymentStatus: 'unknown',
    rawText: null,
    sourcePage: null,
    sourceConfidence: 'manual_entry',
    ...overrides,
    dueDate: toISODate(overrides.dueDate),
  };
}

const codes = (entries: readonly AuditEntry[]): string[] => entries.map((e) => e.code);
const bySeverity = (entries: readonly AuditEntry[], s: AuditEntry['severity']) =>
  entries.filter((e) => e.severity === s);

/* ------------------------------------------------------------------ */
/* 1-2. CaseInfo                                                       */
/* ------------------------------------------------------------------ */

describe('validateCaseInfo', () => {
  it('valid CaseInfo produces no blocking error (test 1)', () => {
    const entries = validateCaseInfo(validCase);
    assert.deepEqual(entries, []);
  });

  it('missing contract number produces a warning, not a block', () => {
    const entries = validateCaseInfo({ ...validCase, contractNumber: '' });
    assert.deepEqual(codes(entries), [C.CASE_CONTRACT_NUMBER_MISSING]);
    assert.equal(entries[0]?.severity, 'warning');
  });

  it('missing principal is flagged (test 2, blocking code)', () => {
    const broken = { ...validCase, principal: null as unknown as CaseInfo['principal'] };
    const entries = validateCaseInfo(broken);
    assert.ok(codes(entries).includes(C.CASE_PRINCIPAL_MISSING));
    assert.equal(
      entries.find((e) => e.code === C.CASE_PRINCIPAL_MISSING)?.severity,
      'requires_review',
    );
  });

  it('start date after end date produces CASE_DATE_INVALID warning', () => {
    const entries = validateCaseInfo({
      ...validCase,
      startDate: toISODate('2033-04-01'),
      endDate: toISODate('2018-04-01'),
    });
    assert.ok(codes(entries).includes(C.CASE_DATE_INVALID));
  });

  it('missing term AND end date is flagged', () => {
    const entries = validateCaseInfo({
      ...validCase,
      endDate: '' as unknown as CaseInfo['endDate'],
      termMonths: 0,
    });
    assert.ok(codes(entries).includes(C.CASE_TERM_OR_END_DATE_MISSING));
  });
});

/* ------------------------------------------------------------------ */
/* 3-4. RateConfig                                                     */
/* ------------------------------------------------------------------ */

describe('validateRateConfig', () => {
  it('valid fixed-rate config produces no entries', () => {
    assert.deepEqual(validateRateConfig(fixedRate), []);
  });

  it('Law128Status unknown creates requires_review (test 3)', () => {
    const entries = validateRateConfig({ ...fixedRate, law128: { kind: 'unknown' } });
    const e = entries.find((x) => x.code === C.LAW128_UNKNOWN);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
  });

  it('DayCountConvention unknown creates an assumption (test 4)', () => {
    const entries = validateRateConfig({ ...fixedRate, dayCount: 'unknown' });
    const e = entries.find((x) => x.code === C.DAYCOUNT_UNKNOWN);
    assert.ok(e);
    assert.equal(e.severity, 'assumption');
  });

  it('floating rate without history defaults to requires_review', () => {
    const cfg: RateConfig = {
      regime: {
        kind: 'floating',
        indexType: 'EURIBOR_3M',
        indexLabel: null,
        spreadPercent: 2.5,
        referenceDateRule: null,
        resetFrequencyMonths: 3,
        negativeEuriborPolicy: 'as_is',
        rateHistory: [],
      },
      law128: { kind: 'included_in_rate', ratePercent: null },
      dayCount: 'ACT_360',
    };
    const entries = validateRateConfig(cfg);
    assert.equal(
      entries.find((e) => e.code === C.RATE_HISTORY_MISSING)?.severity,
      'requires_review',
    );
    // data-gathering phase grading
    const relaxed = validateRateConfig(cfg, { missingRateHistorySeverity: 'warning' });
    assert.equal(
      relaxed.find((e) => e.code === C.RATE_HISTORY_MISSING)?.severity,
      'warning',
    );
  });

  it('unknown negative Euribor policy creates requires_review', () => {
    const cfg: RateConfig = {
      regime: {
        kind: 'floating',
        indexType: 'EURIBOR_3M',
        indexLabel: null,
        spreadPercent: 2.5,
        referenceDateRule: null,
        resetFrequencyMonths: 3,
        negativeEuriborPolicy: 'unknown',
        rateHistory: [
          {
            from: toISODate('2024-01-01'),
            to: toISODate('2024-06-30'),
            indexValuePercent: -0.3,
            totalAppliedRatePercent: null,
            source: 'bank_statement',
          },
        ],
      },
      law128: { kind: 'included_in_rate', ratePercent: null },
      dayCount: 'ACT_360',
    };
    const entries = validateRateConfig(cfg);
    assert.equal(
      entries.find((e) => e.code === C.NEGATIVE_INDEX_POLICY_UNKNOWN)?.severity,
      'requires_review',
    );
  });

  it('missing spread on floating rate is a warning', () => {
    const cfg = {
      regime: {
        kind: 'floating',
        indexType: 'EURIBOR_3M',
        indexLabel: null,
        spreadPercent: undefined as unknown as number,
        referenceDateRule: null,
        resetFrequencyMonths: 3,
        negativeEuriborPolicy: 'as_is',
        rateHistory: [],
      },
      law128: { kind: 'included_in_rate', ratePercent: null },
      dayCount: 'ACT_360',
    } as RateConfig;
    const entries = validateRateConfig(cfg);
    assert.equal(
      entries.find((e) => e.code === C.RATE_SPREAD_MISSING)?.severity,
      'warning',
    );
  });
});

/* ------------------------------------------------------------------ */
/* 5-8. Bank schedule rows                                             */
/* ------------------------------------------------------------------ */

describe('validateBankScheduleRows', () => {
  it('empty schedule produces BANK_SCHEDULE_EMPTY requires_review', () => {
    const entries = validateBankScheduleRows([]);
    assert.deepEqual(codes(entries), [C.BANK_SCHEDULE_EMPTY]);
    assert.equal(entries[0]?.severity, 'requires_review');
  });

  it('complete rows in order produce no entries', () => {
    const rows = [
      bankRow({ rowId: 'r1', dueDate: '2024-01-31' }),
      bankRow({ rowId: 'r2', dueDate: '2024-02-29' }),
    ];
    assert.deepEqual(validateBankScheduleRows(rows), []);
  });

  it('null installment amount generates a warning (test 5)', () => {
    const rows = [bankRow({ rowId: 'r1', dueDate: '2024-01-31', installmentAmount: null })];
    const entries = validateBankScheduleRows(rows);
    assert.equal(
      entries.find((e) => e.code === C.BANK_SCHEDULE_ROW_MISSING_AMOUNT)?.severity,
      'warning',
    );
  });

  it('explicit 0 installment is NOT treated as missing (test 6)', () => {
    const rows = [
      bankRow({ rowId: 'r1', dueDate: '2024-01-31', installmentAmount: moneyFromCents(0) }),
    ];
    const entries = validateBankScheduleRows(rows);
    assert.equal(
      entries.find((e) => e.code === C.BANK_SCHEDULE_ROW_MISSING_AMOUNT),
      undefined,
    );
  });

  it('all-null monetary row generates requires_review (test 7)', () => {
    const rows = [
      bankRow({
        rowId: 'r1',
        dueDate: '2024-01-31',
        installmentAmount: null,
        principalPortion: null,
        interestPortion: null,
        feesAndPremiums: null,
        balanceAfter: null,
      }),
    ];
    const entries = validateBankScheduleRows(rows);
    const e = entries.find((x) => x.code === C.BANK_SCHEDULE_ROW_ALL_NUMERIC_FIELDS_MISSING);
    assert.ok(e);
    assert.equal(e.severity, 'requires_review');
    // the four individual missing-field warnings are also present
    assert.equal(bySeverity(entries, 'warning').length, 4);
  });

  it('non-chronological dates generate a warning, once (test 8)', () => {
    const rows = [
      bankRow({ rowId: 'r1', dueDate: '2024-03-31' }),
      bankRow({ rowId: 'r2', dueDate: '2024-01-31' }),
      bankRow({ rowId: 'r3', dueDate: '2023-12-31' }),
    ];
    const entries = validateBankScheduleRows(rows);
    const hits = entries.filter((e) => e.code === C.BANK_SCHEDULE_DATES_NOT_CHRONOLOGICAL);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.severity, 'warning');
  });

  it('low source confidence generates an info entry', () => {
    const rows = [bankRow({ rowId: 'r1', dueDate: '2024-01-31', sourceConfidence: 'low' })];
    const entries = validateBankScheduleRows(rows);
    assert.equal(
      entries.find((e) => e.code === C.BANK_SCHEDULE_ROW_LOW_CONFIDENCE)?.severity,
      'info',
    );
  });

  it('duplicate rowId generates a warning', () => {
    const rows = [
      bankRow({ rowId: 'r1', dueDate: '2024-01-31' }),
      bankRow({ rowId: 'r1', dueDate: '2024-02-29' }),
    ];
    const entries = validateBankScheduleRows(rows);
    assert.ok(codes(entries).includes(C.BANK_SCHEDULE_DUPLICATE_ROW_ID));
  });

  it('null is never converted to zero: missing fields stay absent from context', () => {
    const rows = [bankRow({ rowId: 'r1', dueDate: '2024-01-31', balanceAfter: null })];
    const entries = validateBankScheduleRows(rows);
    const e = entries.find((x) => x.code === C.BANK_SCHEDULE_ROW_MISSING_BALANCE);
    assert.ok(e);
    // the validator reports the absence; it does not fabricate a value:
    // no monetary field appears in the context, and the row keeps null
    assert.equal('balanceAfter' in (e.context ?? {}), false);
    assert.equal(rows[0]?.balanceAfter, null);
  });
});

/* ------------------------------------------------------------------ */
/* 9. Actual payments                                                  */
/* ------------------------------------------------------------------ */

describe('validateActualPayments', () => {
  const payment = (overrides: Partial<ActualPayment> & { paymentId: string }): ActualPayment => ({
    date: toISODate('2024-02-05'),
    amount: moneyFromCents(64_708),
    description: null,
    matchedScheduleRowId: 'r1',
    matchConfidence: 'manual',
    ...overrides,
  });

  it('valid matched payments produce no entries', () => {
    assert.deepEqual(validateActualPayments([payment({ paymentId: 'p1' })]), []);
  });

  it('duplicate paymentId generates a warning (test 9)', () => {
    const entries = validateActualPayments([
      payment({ paymentId: 'p1' }),
      payment({ paymentId: 'p1' }),
    ]);
    const e = entries.find((x) => x.code === C.PAYMENT_DUPLICATE_ID);
    assert.ok(e);
    assert.equal(e.severity, 'warning');
  });

  it('missing amount generates a warning; explicit zero generates info only', () => {
    const missing = validateActualPayments([
      payment({ paymentId: 'p1', amount: null as unknown as ActualPayment['amount'] }),
    ]);
    assert.equal(
      missing.find((e) => e.code === C.PAYMENT_AMOUNT_MISSING)?.severity,
      'warning',
    );

    const zero = validateActualPayments([
      payment({ paymentId: 'p2', amount: moneyFromCents(0) }),
    ]);
    assert.equal(zero.find((e) => e.code === C.PAYMENT_AMOUNT_MISSING), undefined);
    assert.equal(
      zero.find((e) => e.code === C.PAYMENT_AMOUNT_EXPLICIT_ZERO)?.severity,
      'info',
    );
  });

  it('unmatched payment generates an info entry', () => {
    const entries = validateActualPayments([
      payment({ paymentId: 'p1', matchedScheduleRowId: null, matchConfidence: 'unmatched' }),
    ]);
    assert.equal(entries.find((e) => e.code === C.PAYMENT_UNMATCHED)?.severity, 'info');
  });

  it('invalid date generates a warning', () => {
    const entries = validateActualPayments([
      payment({ paymentId: 'p1', date: '2024-02-30' as unknown as ActualPayment['date'] }),
    ]);
    assert.ok(codes(entries).includes(C.PAYMENT_DATE_INVALID));
  });
});

/* ------------------------------------------------------------------ */
/* 10. Neutral report wording                                          */
/* ------------------------------------------------------------------ */

describe('validateNeutralReportText', () => {
  it('forbidden report wording is caught (test 10)', () => {
    const entries = validateNeutralReportText(
      'Το ποσό είναι προς επιστροφή ως αχρεωστήτως καταβληθέν.',
    );
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.code === C.FORBIDDEN_REPORT_TERM));
    assert.ok(entries.every((e) => e.severity === 'warning'));
  });

  it('is accent/case-insensitive', () => {
    const entries = validateNeutralReportText('Η χρέωση είναι ΠΑΡΑΝΟΜΗ.');
    assert.equal(entries.length, 1);
  });

  it('neutral wording produces no entries', () => {
    assert.deepEqual(
      validateNeutralReportText('Οικονομική απόκλιση· απαιτείται έλεγχος.'),
      [],
    );
  });
});

/* ------------------------------------------------------------------ */
/* 11-12. Combined readiness                                           */
/* ------------------------------------------------------------------ */

describe('validateReadyForCalculation', () => {
  const goodInput = () => ({
    caseInfo: validCase,
    rateConfig: fixedRate,
    bankScheduleRows: [
      bankRow({ rowId: 'r1', dueDate: '2024-01-31' }),
      bankRow({ rowId: 'r2', dueDate: '2024-02-29' }),
    ],
  });

  it('clean input can calculate and report with no entries', () => {
    const r = validateReadyForCalculation(goodInput());
    assert.equal(r.canCalculate, true);
    assert.equal(r.canGenerateReport, true);
    assert.deepEqual([...r.auditEntries], []);
  });

  it('blocks calculation when principal is missing (test 11)', () => {
    const r = validateReadyForCalculation({
      ...goodInput(),
      caseInfo: { ...validCase, principal: null as unknown as CaseInfo['principal'] },
    });
    assert.equal(r.canCalculate, false);
    // bank data exists, so a report with limitations is still possible
    assert.equal(r.canGenerateReport, true);
  });

  it('blocks calculation when the bank schedule is empty (test 11)', () => {
    const r = validateReadyForCalculation({ ...goodInput(), bankScheduleRows: [] });
    assert.equal(r.canCalculate, false);
    assert.ok(r.auditEntries.some((e) => e.code === C.BANK_SCHEDULE_EMPTY));
  });

  it('blocks calculation when the rate regime is unusable (test 11)', () => {
    const r = validateReadyForCalculation({
      ...goodInput(),
      rateConfig: {
        ...fixedRate,
        regime: { kind: 'fixed', annualRatePercent: undefined as unknown as number },
      },
    });
    assert.equal(r.canCalculate, false);
    assert.ok(r.auditEntries.some((e) => e.code === C.RATE_FIXED_MISSING));
  });

  it('Law128 unknown + dayCount unknown do NOT block; report allowed with limitations (test 12)', () => {
    const r = validateReadyForCalculation({
      ...goodInput(),
      rateConfig: { ...fixedRate, law128: { kind: 'unknown' }, dayCount: 'unknown' },
      bankScheduleRows: [
        bankRow({ rowId: 'r1', dueDate: '2024-01-31', balanceAfter: null }),
      ],
      actualPayments: [
        {
          paymentId: 'p1',
          date: toISODate('2024-02-05'),
          amount: moneyFromCents(64_708),
          description: null,
          matchedScheduleRowId: null,
          matchConfidence: 'unmatched',
        },
      ],
    });
    assert.equal(r.canCalculate, true);
    assert.equal(r.canGenerateReport, true);
    assert.ok(r.auditEntries.some((e) => e.code === C.LAW128_UNKNOWN && e.severity === 'requires_review'));
    assert.ok(r.auditEntries.some((e) => e.code === C.DAYCOUNT_UNKNOWN && e.severity === 'assumption'));
    assert.ok(r.auditEntries.some((e) => e.code === C.BANK_SCHEDULE_ROW_MISSING_BALANCE && e.severity === 'warning'));
    assert.ok(r.auditEntries.some((e) => e.code === C.PAYMENT_UNMATCHED));
  });
});
