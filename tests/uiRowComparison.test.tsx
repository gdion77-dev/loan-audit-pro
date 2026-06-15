/**
 * Tests: detailed row-level comparison table (Step 15-A).
 * Covers the 24 required scenarios.
 *
 * ComparisonSection reads the ALREADY-STORED comparisonResult.rows;
 * nothing is recomputed. Rendered via renderToStaticMarkup with
 * crafted ComparisonRow data for the edge cases (sign, null, cap).
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { ComparisonSection } from '../src/components/sections/ComparisonSection';
import { moneyFromCents, type NullableMoney } from '../src/domain/money';
import type { LoanAuditPipelineResult } from '../src/engines/loanAuditPipelineRunner';
import type { ScheduleComparisonResult } from '../src/engines/scheduleComparisonEngine';
import type { ComparisonRow } from '../src/domain/comparisonTypes';
import type { FindingLevel } from '../src/domain/comparisonTypes';

const m = (cents: number | null): NullableMoney => (cents === null ? null : moneyFromCents(cents));

function row(partial: Partial<ComparisonRow>): ComparisonRow {
  return {
    period: 1,
    dueDate: '2024-01-31',
    bankInstallment: null,
    bankPrincipal: null,
    bankInterest: null,
    bankBalance: null,
    recalculatedInstallment: null,
    recalculatedPrincipal: null,
    recalculatedInterest: null,
    recalculatedBalance: null,
    actualPaid: null,
    economicDifference: null,
    findingLevel: 'info' as FindingLevel,
    notes: null,
    ...partial,
  };
}

function resultWithRows(rows: readonly ComparisonRow[]): LoanAuditPipelineResult {
  const comparisonResult: ScheduleComparisonResult = {
    status: 'success',
    rows,
    summary: {
      totalBankInstallmentsCents: null,
      totalRecalculatedInstallmentsCents: null,
      totalEconomicDifferenceCents: null,
      totalBankInterestCents: null,
      totalRecalculatedInterestCents: null,
      totalInterestDifferenceCents: null,
      totalBankPrincipalCents: null,
      totalRecalculatedPrincipalCents: null,
      totalPrincipalDifferenceCents: null,
      comparedRowCount: rows.length,
      excludedRowCount: 0,
      unmatchedBankRowCount: 0,
      unmatchedRecalcRowCount: 0,
      rowsRequiringReviewCount: 0,
    },
    unmatchedBankRows: [],
    unmatchedRecalcRows: [],
    auditEntries: [],
  };
  return { comparisonResult } as unknown as LoanAuditPipelineResult;
}

const render = (pipelineResult: LoanAuditPipelineResult | null): string =>
  renderToStaticMarkup(React.createElement(ComparisonSection, { pipelineResult }));

/* ------------------------------------------------------------------ */
/* presence                                                            */
/* ------------------------------------------------------------------ */

describe('rowComparison: presence', () => {
  it('keeps not-run message before execution (test 1)', () => {
    assert.ok(render(null).includes('Δεν έχει εκτελεστεί ακόμη μελέτη.'));
  });

  it('shows empty-rows message when rows are empty (test 2)', () => {
    assert.ok(render(resultWithRows([])).includes('Δεν υπάρχουν αναλυτικές γραμμές σύγκρισης.'));
  });

  it('renders a row-level table when rows exist (test 3)', () => {
    const html = render(resultWithRows([row({ period: 1 })]));
    assert.ok(html.includes('<table'));
    assert.equal(html.includes('Δεν υπάρχουν αναλυτικές γραμμές σύγκρισης.'), false);
  });

  it('renders all table headers (test 4)', () => {
    const html = render(resultWithRows([row({})]));
    for (const h of [
      'Περίοδος / Γραμμή',
      'Ημερομηνία',
      'Δόση Τράπεζας/Fund',
      'Δόση Επανυπολογισμού',
      'Οικονομική Διαφορά',
      'Τόκος Τράπεζας/Fund',
      'Τόκος Επανυπολογισμού',
      'Διαφορά Τόκου',
      'Κατάσταση',
    ]) {
      assert.ok(html.includes(h), `missing header: ${h}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* values                                                              */
/* ------------------------------------------------------------------ */

describe('rowComparison: values', () => {
  it('renders bank/fund and recalculated installment amounts (tests 5, 6)', () => {
    const html = render(
      resultWithRows([row({ bankInstallment: m(304_500), recalculatedInstallment: m(300_000) })]),
    );
    assert.ok(html.includes('3.045,00'));
    assert.ok(html.includes('3.000,00'));
  });

  it('renders economic difference with preserved positive sign (test 7)', () => {
    const html = render(resultWithRows([row({ economicDifference: m(4_500) })]));
    assert.ok(html.includes('45,00'));
    assert.equal(html.includes('−45,00'), false);
  });

  it('renders negative economic difference with explicit «−» (test 8)', () => {
    const html = render(resultWithRows([row({ economicDifference: m(-4_500) })]));
    assert.ok(html.includes('−45,00'));
  });

  it('renders null amount as «Δεν οριστικοποιείται», never 0,00 € (test 9)', () => {
    const html = render(resultWithRows([row({ bankInstallment: null, economicDifference: null })]));
    assert.ok(html.includes('Δεν οριστικοποιείται'));
    // there is no fabricated zero for a null cell:
    assert.equal(html.includes('0,00'), false);
  });

  it('renders interest amounts and a display-only interest difference when both sides exist (test 10)', () => {
    const html = render(
      resultWithRows([row({ bankInterest: m(10_000), recalculatedInterest: m(7_500) })]),
    );
    assert.ok(html.includes('100,00')); // bank interest
    assert.ok(html.includes('75,00')); // recalc interest
    assert.ok(html.includes('25,00')); // difference 100,00 − 75,00
  });

  it('interest difference is not finalized when one side is null', () => {
    const html = render(resultWithRows([row({ bankInterest: m(10_000), recalculatedInterest: null })]));
    assert.ok(html.includes('Δεν οριστικοποιείται'));
  });

  it('renders the row status / finding level (test 11)', () => {
    const html = render(resultWithRows([row({ findingLevel: 'requires_review' as FindingLevel })]));
    assert.ok(html.includes('requires_review'));
  });

  it('sign convention text remains visible (test 12)', () => {
    const html = render(resultWithRows([row({})]));
    assert.ok(
      html.includes('Η οικονομική διαφορά υπολογίζεται ως ποσό Τράπεζας/Fund μείον ποσό επανυπολογισμού.'),
    );
  });
});

/* ------------------------------------------------------------------ */
/* capping                                                             */
/* ------------------------------------------------------------------ */

describe('rowComparison: capping', () => {
  it('caps the table preview at 100 rows (test 13)', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row({ period: i + 1 }));
    const html = render(resultWithRows(rows));
    // a tbody <tr> per displayed row + 1 header row:
    const trCount = (html.match(/<tr/g) ?? []).length;
    assert.equal(trCount, 101); // 100 body rows + 1 header
  });

  it('shows the more-than-100 message when needed (test 14)', () => {
    const rows = Array.from({ length: 150 }, (_, i) => row({ period: i + 1 }));
    const html = render(resultWithRows(rows));
    assert.ok(
      html.includes('Εμφανίζονται οι πρώτες 100 γραμμές. Το πλήρες αποτέλεσμα περιλαμβάνεται στη μελέτη/PDF.'),
    );
  });

  it('does not show the cap message at or below 100 rows', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row({ period: i + 1 }));
    const html = render(resultWithRows(rows));
    assert.equal(html.includes('Εμφανίζονται οι πρώτες 100 γραμμές'), false);
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('rowComparison: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const comparisonSrc = readFileSync(
    join(here, '../src/components/sections/ComparisonSection.tsx'),
    'utf8',
  );
  const code = comparisonSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no pagination/sorting/filter/export introduced (test 15)', () => {
    assert.equal(/onSort|sortBy|paginate|pageSize|filter\(|exportTo|downloadCsv/i.test(code), false);
  });

  it('no compareSchedules call in UI (test 16)', () => {
    assert.equal(/compareSchedules/.test(code), false);
  });

  it('no generateFindings call in UI (test 17)', () => {
    assert.equal(/generateFindings/.test(code), false);
  });

  it('no runLoanAuditPipeline call in UI (test 18)', () => {
    assert.equal(/runLoanAuditPipeline/.test(code), false);
  });

  it('no PDF / report-text renderer call (test 19)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(code), false);
  });

  it('no backend/persistence/auth/localStorage (test 20)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|writeFileSync/i.test(code),
      false,
    );
  });

  it('no Excel/OCR/file upload (test 21)', () => {
    assert.equal(/xlsx|tesseract|<input[^>]*type=["']file["']|readAsArrayBuffer/i.test(code), false);
  });

  it('no forbidden domain wording (tests 22, 23, 24)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|3869|6\/2026|αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        comparisonSrc,
      ),
      false,
    );
  });
});
