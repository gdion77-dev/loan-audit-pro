/**
 * Tests: audit entry creation + report model creation with warnings
 * and neutral-wording enforcement.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAuditEntry,
  AUDIT_CODES,
  AUDIT_SEVERITIES,
  hasWarnings,
  filterBySeverity,
  AuditError,
} from '../src/domain/auditTypes';
import {
  createReportModel,
  findForbiddenTerms,
  FORBIDDEN_REPORT_TERMS,
  ReportWordingError,
  type ReportModel,
} from '../src/domain/reportTypes';
import { moneyFromCents } from '../src/domain/money';
import { toISODate } from '../src/domain/dateTypes';
import type { CaseInfo } from '../src/domain/loanTypes';

const caseInfo: CaseInfo = {
  caseId: 'CASE-001',
  debtorName: 'Δοκιμαστικός Οφειλέτης',
  contractNumber: '123456789',
  institution: 'Τράπεζα Α',
  servicer: null,
  contractDate: toISODate('2018-03-15'),
  restructuringDate: null,
  principal: moneyFromCents(15_000_000), // €150.000,00
  currency: 'EUR',
  startDate: toISODate('2018-04-01'),
  endDate: toISODate('2033-04-01'),
  termMonths: 180,
  notes: null,
};

function baseReportInput(): Omit<ReportModel, 'generatedAt'> {
  return {
    caseInfo,
    inputSummary: 'Σύνοψη δεδομένων εισόδου όπως καταχωρήθηκαν.',
    methodology:
      'Τεχνικός οικονομικός επανυπολογισμός με τόκο επί ανεξόφλητου υπολοίπου κεφαλαίου, σύμβαση ημερομέτρησης ACT_360 (ρητή υπόθεση).',
    bankScheduleSummary: 'Σύνοψη δοσολογίου τράπεζας με ελλιπή δεδομένα σε 3 γραμμές.',
    recalculationSummary: 'Σύνοψη δικού μας επανυπολογισμού.',
    comparisonSummary: {
      totalInterestDifference: moneyFromCents(45_210),
      totalPrincipalDifference: moneyFromCents(0),
      totalActualPaidDifference: null,
      periodsWithDeviation: 12,
      periodsWithMissingData: 3,
      periodsCompared: 96,
    },
    findings: [
      {
        findingId: 'F-1',
        level: 'deviation',
        title: 'Οικονομική διαφορά τόκων',
        description:
          'Τεχνικό οικονομικό εύρημα: σωρευτική οικονομική διαφορά τόκων 452,10 € σε 12 περιόδους. Απαιτείται έλεγχος.',
        magnitude: moneyFromCents(45_210),
        affectedPeriods: [4, 5, 6],
      },
    ],
    missingData: [
      {
        field: 'law128',
        description: 'Ελλιπή δεδομένα: άγνωστο καθεστώς Ν.128/75.',
        impact: 'Διπλό σενάριο υπολογισμού· απαιτείται έλεγχος.',
      },
    ],
    limitations: [
      'Η παρούσα αποτελεί τεχνικό οικονομικό επανυπολογισμό βάσει των διαθέσιμων δεδομένων και σύγκριση με τραπεζικά δεδομένα.',
    ],
    auditEntries: [
      createAuditEntry({
        severity: 'requires_review',
        code: AUDIT_CODES.LAW128_UNKNOWN,
        message: 'Απαιτείται έλεγχος καθεστώτος Ν.128/75.',
      }),
      createAuditEntry({
        severity: 'assumption',
        code: AUDIT_CODES.DAYCOUNT_UNKNOWN,
        message: 'Σύμβαση ημερομέτρησης άγνωστη: ρητή υπόθεση ACT_360.',
      }),
    ],
  };
}

describe('audit entry creation', () => {
  it('creates a frozen entry with defaults', () => {
    const e = createAuditEntry({
      severity: 'warning',
      code: AUDIT_CODES.MISSING_BANK_DATA,
      message: 'Ελλιπή δεδομένα δοσολογίου σε 3 γραμμές.',
    });
    assert.equal(e.severity, 'warning');
    assert.equal(e.code, 'MISSING_BANK_DATA');
    assert.equal(e.context, null);
    assert.ok(Object.isFrozen(e));
  });

  it('supports exactly the four severities', () => {
    assert.deepEqual(
      [...AUDIT_SEVERITIES],
      ['info', 'assumption', 'warning', 'requires_review'],
    );
  });

  it('rejects empty code or message', () => {
    assert.throws(
      () => createAuditEntry({ severity: 'info', code: '', message: 'x' }),
      AuditError,
    );
    assert.throws(
      () => createAuditEntry({ severity: 'info', code: 'X', message: '  ' }),
      AuditError,
    );
  });

  it('hasWarnings detects warning and requires_review', () => {
    const info = createAuditEntry({ severity: 'info', code: 'X', message: 'ok' });
    const warn = createAuditEntry({ severity: 'warning', code: 'Y', message: 'w' });
    assert.equal(hasWarnings([info]), false);
    assert.equal(hasWarnings([info, warn]), true);
  });

  it('filterBySeverity selects matching entries', () => {
    const entries = baseReportInput().auditEntries;
    assert.equal(filterBySeverity(entries, 'requires_review').length, 1);
    assert.equal(filterBySeverity(entries, 'info').length, 0);
  });
});

describe('report model creation with warnings', () => {
  it('creates a report preserving audit warnings and stamping generatedAt', () => {
    const report = createReportModel(baseReportInput(), () => new Date('2026-06-12T10:00:00Z'));
    assert.equal(report.generatedAt, '2026-06-12T10:00:00.000Z');
    assert.equal(report.auditEntries.length, 2);
    assert.equal(hasWarnings(report.auditEntries), true);
    assert.equal(report.findings.length, 1);
    assert.equal(report.comparisonSummary.periodsWithMissingData, 3);
    assert.ok(Object.isFrozen(report));
  });

  it('economic difference may be positive, zero or negative', () => {
    const input = baseReportInput();
    const negative = {
      ...input,
      comparisonSummary: {
        ...input.comparisonSummary,
        totalInterestDifference: moneyFromCents(-1_000),
        totalPrincipalDifference: moneyFromCents(0),
      },
    };
    const report = createReportModel(negative);
    assert.equal(report.comparisonSummary.totalInterestDifference?.cents, -1000);
    assert.equal(report.comparisonSummary.totalPrincipalDifference?.cents, 0);
  });

  it('rejects forbidden legal wording in findings', () => {
    const input = baseReportInput();
    const bad = {
      ...input,
      findings: [
        {
          ...input.findings[0]!,
          description: 'Το ποσό είναι προς επιστροφή ως αχρεωστήτως καταβληθέν.',
        },
      ],
    };
    assert.throws(() => createReportModel(bad), ReportWordingError);
    try {
      createReportModel(bad);
    } catch (err) {
      const e = err as ReportWordingError;
      assert.equal(e.violations.length, 1);
      assert.ok(e.violations[0]!.terms.includes('προς επιστροφή'));
      assert.ok(e.violations[0]!.terms.includes('αχρεωστήτως'));
    }
  });

  it('rejects forbidden wording in limitations (accent-insensitive)', () => {
    const input = baseReportInput();
    const bad = {
      ...input,
      limitations: ['Η χρέωση είναι ΠΑΡΑΝΟΜΗ.'],
    };
    assert.throws(() => createReportModel(bad), ReportWordingError);
  });

  it('findForbiddenTerms returns empty for neutral wording', () => {
    assert.deepEqual(
      [...findForbiddenTerms('Οικονομική απόκλιση· απαιτείται έλεγχος.')],
      [],
    );
  });

  it('forbidden list contains the specified terms', () => {
    for (const term of ['παράνομο', 'άκυρο', 'διεκδίκηση', 'προς επιστροφή', 'αχρεωστήτως', 'νομική γνωμοδότηση']) {
      assert.ok(
        FORBIDDEN_REPORT_TERMS.includes(term),
        `missing forbidden term: ${term}`,
      );
    }
  });
});
