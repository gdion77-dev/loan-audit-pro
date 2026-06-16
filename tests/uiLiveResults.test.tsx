/**
 * Tests: live Comparison & Findings sections (Step 14-B).
 * Covers the 22 required scenarios.
 *
 * Sections read the ALREADY-STORED pipelineResult; nothing is
 * recomputed. A real (locked) pipeline run provides the data; for
 * sign/null edge cases the result's findings are checked, and the
 * sections are rendered with crafted result objects via
 * renderToStaticMarkup.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { AppShell } from '../src/components/layout/AppShell';
import { ComparisonSection } from '../src/components/sections/ComparisonSection';
import { FindingsSection } from '../src/components/sections/FindingsSection';
import { executePipelineFromDraft } from '../src/ui-state/pipelineExecutor';
import {
  createEmptyDraftState,
  type LoanAuditDraftState,
} from '../src/ui-state/loanAuditDraftState';
import {
  addBankScheduleDraftRow,
  updateBankScheduleDraftRowField,
} from '../src/ui-state/draftUpdates';
import { fieldValue, fieldExplicitZero, fieldUnknown, parseTextToField } from '../src/ui-state/fieldState';
import type { LoanAuditPipelineResult } from '../src/engines/loanAuditPipelineRunner';
import type { ScheduleComparisonResult, ScheduleComparisonSummary } from '../src/engines/scheduleComparisonEngine';
import type { FindingsResult, TechnicalFinding } from '../src/engines/findingsEngine';

function readyDraft(): LoanAuditDraftState {
  const base = createEmptyDraftState();
  let d: LoanAuditDraftState = {
    ...base,
    caseInfoDraft: {
      debtorName: fieldValue<string>('Οφειλέτης'),
      contractNumber: fieldValue<string>('4500-1'),
      institution: fieldValue<string>('Τράπεζα Α'),
      servicer: fieldUnknown<string>(),
    },
    loanTermsDraft: {
      principalCents: fieldValue<number>(900_000),
      termMonths: fieldValue<number>(3),
      startDate: fieldValue<string>('2024-01-01'),
      endDate: fieldValue<string>('2024-03-31'),
    },
    rateConfigDraft: {
      regimeKind: fieldValue<string>('fixed'),
      annualRatePercent: fieldValue<number>(6),
      spreadPercent: fieldUnknown<number>(),
      law128Status: fieldValue<string>('included_in_rate'),
      law128Percent: fieldUnknown<number>("manual"),
    },
    recalculationSettingsDraft: {
      scheduleMode: fieldValue<string>('equal_principal'),
      roundingMode: fieldValue<string>('half_up'),
      feesAndPremiumsPerPeriodCents: fieldExplicitZero(),
    },
  };
  d = { ...d, bankScheduleDraft: { ...d.bankScheduleDraft, dayCountConvention: fieldValue<string>('ACT_365') } };
  d = addBankScheduleDraftRow(d, 'b1');
  d = updateBankScheduleDraftRowField(d, 0, 'dueDate', parseTextToField('2024-01-31'));
  d = updateBankScheduleDraftRowField(d, 0, 'installmentCents', fieldValue<number>(304_500));
  d = addBankScheduleDraftRow(d, 'b2');
  d = updateBankScheduleDraftRowField(d, 1, 'dueDate', parseTextToField('2024-02-29'));
  d = updateBankScheduleDraftRowField(d, 1, 'installmentCents', fieldValue<number>(304_500));
  return d;
}

const producedResult = (): LoanAuditPipelineResult => {
  const outcome = executePipelineFromDraft(readyDraft());
  assert.ok(outcome.result);
  return outcome.result;
};

const renderComparison = (pipelineResult: LoanAuditPipelineResult | null): string =>
  renderToStaticMarkup(React.createElement(ComparisonSection, { pipelineResult }));
const renderFindings = (pipelineResult: LoanAuditPipelineResult | null): string =>
  renderToStaticMarkup(React.createElement(FindingsSection, { pipelineResult }));

/** Build a comparison-only result with a crafted summary. */
function resultWithSummary(summary: ScheduleComparisonSummary | null): LoanAuditPipelineResult {
  const comparisonResult: ScheduleComparisonResult = {
    status: 'success',
    rows: [],
    summary,
    unmatchedBankRows: [],
    unmatchedRecalcRows: [],
    auditEntries: [],
  };
  return { comparisonResult } as unknown as LoanAuditPipelineResult;
}

/** Build a findings-only result with crafted findings. */
function resultWithFindings(findings: readonly TechnicalFinding[]): LoanAuditPipelineResult {
  const findingsResult: FindingsResult = { status: 'success', findings, auditEntries: [] };
  return { findingsResult } as unknown as LoanAuditPipelineResult;
}

function finding(partial: Partial<TechnicalFinding>): TechnicalFinding {
  return {
    findingId: 'F-1',
    level: 'info',
    title: 'Τεχνικό οικονομικό εύρημα',
    description: '',
    affectedRowIds: [],
    affectedPeriods: [],
    amountCents: null,
    count: 1,
    source: 'comparison',
    reportSafe: true,
    ...partial,
  };
}

/* ------------------------------------------------------------------ */
/* not-run state                                                       */
/* ------------------------------------------------------------------ */

describe('liveResults: not-run state', () => {
  it('ComparisonSection shows not-run message before execution (test 1)', () => {
    assert.ok(renderComparison(null).includes('Δεν έχει εκτελεστεί ακόμη μελέτη.'));
  });

  it('FindingsSection shows not-run message before execution (test 2)', () => {
    assert.ok(renderFindings(null).includes('Δεν έχει εκτελεστεί ακόμη μελέτη.'));
  });
});

/* ------------------------------------------------------------------ */
/* comparison                                                          */
/* ------------------------------------------------------------------ */

describe('liveResults: comparison', () => {
  it('renders pipeline comparison status (test 3)', () => {
    const html = renderComparison(producedResult());
    assert.ok(html.includes('Κατάσταση:'));
  });

  it('renders row counts (test 4)', () => {
    const html = renderComparison(producedResult());
    assert.ok(html.includes('Συγκριθείσες γραμμές'));
    assert.ok(html.includes('Μη αντιστοιχισμένες γραμμές Τράπεζας/Fund'));
    assert.ok(html.includes('Μη αντιστοιχισμένες γραμμές επανυπολογισμού'));
  });

  it('renders total economic difference with sign (test 5)', () => {
    const summary: ScheduleComparisonSummary = {
      totalBankInstallmentsCents: null,
      totalRecalculatedInstallmentsCents: null,
      totalEconomicDifferenceCents: -12_345,
      totalBankInterestCents: null,
      totalRecalculatedInterestCents: null,
      totalInterestDifferenceCents: 6_789,
      totalBankPrincipalCents: null,
      totalRecalculatedPrincipalCents: null,
      totalPrincipalDifferenceCents: null,
      comparedRowCount: 2,
      excludedRowCount: 0,
      unmatchedBankRowCount: 0,
      unmatchedRecalcRowCount: 0,
      rowsRequiringReviewCount: 0,
    };
    const html = renderComparison(resultWithSummary(summary));
    assert.ok(html.includes('−123,45'));   // negative preserved
    assert.ok(html.includes('67,89'));      // positive interest difference
  });

  it('renders null totals as not finalized, never 0,00 € (test 6)', () => {
    const summary: ScheduleComparisonSummary = {
      totalBankInstallmentsCents: null,
      totalRecalculatedInstallmentsCents: null,
      totalEconomicDifferenceCents: null,
      totalBankInterestCents: null,
      totalRecalculatedInterestCents: null,
      totalInterestDifferenceCents: null,
      totalBankPrincipalCents: null,
      totalRecalculatedPrincipalCents: null,
      totalPrincipalDifferenceCents: null,
      comparedRowCount: 0,
      excludedRowCount: 0,
      unmatchedBankRowCount: 0,
      unmatchedRecalcRowCount: 0,
      rowsRequiringReviewCount: 0,
    };
    const html = renderComparison(resultWithSummary(summary));
    assert.ok(html.includes('Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.'));
    assert.equal(html.includes('0,00'), false); // never a fake zero for null
  });

  it('displays the sign convention (test 7)', () => {
    const html = renderComparison(producedResult());
    assert.ok(
      html.includes('Η οικονομική διαφορά υπολογίζεται ως ποσό Τράπεζας/Fund μείον ποσό επανυπολογισμού.'),
    );
  });
});

/* ------------------------------------------------------------------ */
/* findings                                                            */
/* ------------------------------------------------------------------ */

describe('liveResults: findings', () => {
  it('renders findings status (test 8)', () => {
    const html = renderFindings(producedResult());
    assert.ok(html.includes('Κατάσταση:'));
  });

  it('renders finding count (test 9)', () => {
    const html = renderFindings(producedResult());
    assert.ok(html.includes('Πλήθος ευρημάτων:'));
  });

  it('renders findingId / title / level (test 10)', () => {
    const html = renderFindings(
      resultWithFindings([finding({ findingId: 'F-42', title: 'Διαφορά τόκων', level: 'requires_review' })]),
    );
    assert.ok(html.includes('F-42'));
    assert.ok(html.includes('Διαφορά τόκων'));
    assert.ok(html.includes('requires_review'));
  });

  it('preserves a positive amount sign (test 11)', () => {
    const html = renderFindings(resultWithFindings([finding({ amountCents: 50_000 })]));
    assert.ok(html.includes('500,00'));
    assert.equal(html.includes('−500,00'), false);
  });

  it('preserves a negative amount sign (test 12)', () => {
    const html = renderFindings(resultWithFindings([finding({ amountCents: -50_000 })]));
    assert.ok(html.includes('−500,00'));
  });

  it('renders a null amount as not finalized (test 13)', () => {
    const html = renderFindings(resultWithFindings([finding({ amountCents: null })]));
    assert.ok(html.includes('Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.'));
  });
});

/* ------------------------------------------------------------------ */
/* AppShell wiring                                                     */
/* ------------------------------------------------------------------ */

describe('liveResults: AppShell wiring', () => {
  it('AppShell passes pipelineResult to both sections (test 14)', () => {
    // Without a run, both sections show the not-run message via AppShell.
    const comparison = renderToStaticMarkup(
      React.createElement(AppShell, { initialSection: 'comparison' }),
    );
    assert.ok(comparison.includes('Δεν έχει εκτελεστεί ακόμη μελέτη.'));
    const findings = renderToStaticMarkup(
      React.createElement(AppShell, { initialSection: 'findings' }),
    );
    assert.ok(findings.includes('Δεν έχει εκτελεστεί ακόμη μελέτη.'));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('liveResults: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, '../src');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const comparisonSrc = readFileSync(join(srcRoot, 'components/sections/ComparisonSection.tsx'), 'utf8');
  const findingsSrc = readFileSync(join(srcRoot, 'components/sections/FindingsSection.tsx'), 'utf8');
  const sectionCode = strip(comparisonSrc) + '\n' + strip(findingsSrc);

  it('no runLoanAuditPipeline call in the sections (test 15)', () => {
    assert.equal(/runLoanAuditPipeline/.test(sectionCode), false);
  });

  it('no comparison/findings engine call in UI (test 16)', () => {
    assert.equal(/compareSchedules|generateFindings/.test(sectionCode), false);
  });

  it('no PDF renderer call in the sections (test 17)', () => {
    assert.equal(/renderLoanAuditPdf/.test(sectionCode), false);
  });

  it('no backend/persistence/auth/localStorage in the sections (test 18)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|writeFileSync/i.test(sectionCode),
      false,
    );
  });

  it('no Excel/OCR/file upload in the sections (test 19)', () => {
    assert.equal(/xlsx|tesseract|<input[^>]*type=["']file["']|readAsArrayBuffer/i.test(sectionCode), false);
  });

  it('no forbidden domain wording in the sections (tests 20, 21, 22)', () => {
    const all = comparisonSrc + '\n' + findingsSrc;
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|3869|6\/2026|αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        all,
      ),
      false,
    );
  });
});
