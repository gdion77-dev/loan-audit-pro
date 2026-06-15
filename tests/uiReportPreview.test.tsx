/**
 * Tests: report text preview (Step 14-C).
 * Covers the 19 required scenarios.
 *
 * ReportSection reads the ALREADY-PRODUCED reportTextResult.fullText;
 * nothing is regenerated. Rendered via renderToStaticMarkup; preview
 * edge cases use crafted result objects.
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

import { ReportSection } from '../src/components/sections/ReportSection';
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
  return d;
}

const producedResult = (): LoanAuditPipelineResult => {
  const outcome = executePipelineFromDraft(readyDraft());
  assert.ok(outcome.result);
  return outcome.result;
};

const renderReport = (pipelineResult: LoanAuditPipelineResult | null): string =>
  renderToStaticMarkup(
    React.createElement(ReportSection, {
      draftStatus: 'ready',
      pipelineRunStatus: pipelineResult ? 'success' : 'not_run',
      pipelineResult,
      onExecute: () => {},
      onDownloadPdf: () => {},
    }),
  );

/** Craft a result whose reportTextResult.fullText is exactly `text`. */
function resultWithText(text: string | null): LoanAuditPipelineResult {
  const base = producedResult();
  const reportTextResult =
    text === null ? null : { ...base.reportTextResult, fullText: text };
  return { ...base, reportTextResult } as unknown as LoanAuditPipelineResult;
}

/* ------------------------------------------------------------------ */
/* presence / absence                                                  */
/* ------------------------------------------------------------------ */

describe('reportPreview: presence', () => {
  it('shows no preview before pipeline execution (test 1)', () => {
    const html = renderReport(null);
    assert.equal(html.includes('Προεπισκόπηση κειμένου'), false);
  });

  it('shows «Μη διαθέσιμη» when reportTextResult is missing (test 2)', () => {
    const html = renderReport(resultWithText(null));
    assert.ok(html.includes('Προεπισκόπηση κειμένου: Μη διαθέσιμη'));
  });

  it('shows «Μη διαθέσιμη» when fullText is empty', () => {
    const html = renderReport(resultWithText(''));
    assert.ok(html.includes('Προεπισκόπηση κειμένου: Μη διαθέσιμη'));
  });

  it('shows «Προεπισκόπηση κειμένου» when fullText exists (test 3)', () => {
    const html = renderReport(resultWithText('Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου'));
    assert.ok(html.includes('Προεπισκόπηση κειμένου'));
    assert.equal(html.includes('Μη διαθέσιμη'), false);
  });
});

/* ------------------------------------------------------------------ */
/* content fidelity                                                    */
/* ------------------------------------------------------------------ */

describe('reportPreview: content', () => {
  it('preserves Greek text (test 4)', () => {
    const greek = 'Οικονομική απόκλιση και τεχνικό οικονομικό εύρημα ανά περίοδο.';
    const html = renderReport(resultWithText(greek));
    assert.ok(html.includes(greek));
  });

  it('preserves line breaks (test 5)', () => {
    const multiline = 'Γραμμή 1\nΓραμμή 2\nΓραμμή 3';
    const html = renderReport(resultWithText(multiline));
    // rendered inside a <pre>; the literal newlines are retained:
    assert.ok(html.includes('Γραμμή 1\nΓραμμή 2\nΓραμμή 3'));
  });

  it('is read-only — uses a non-editable <pre>, no input/textarea (test 6)', () => {
    const html = renderReport(resultWithText('Κείμενο μελέτης'));
    assert.ok(html.includes('<pre'));
    assert.equal(/<textarea|<input|contenteditable/i.test(html), false);
  });
});

/* ------------------------------------------------------------------ */
/* length capping                                                      */
/* ------------------------------------------------------------------ */

describe('reportPreview: capping', () => {
  it('caps the preview to a safe length (test 7)', () => {
    const long = 'Α'.repeat(5000);
    const html = renderReport(resultWithText(long));
    // only the first 3000 chars are present, not all 5000:
    assert.ok(html.includes('Α'.repeat(3000)));
    assert.equal(html.includes('Α'.repeat(3001)), false);
  });

  it('long preview shows the truncation/help message (test 8)', () => {
    const long = 'Β'.repeat(5000);
    const html = renderReport(resultWithText(long));
    assert.ok(
      html.includes('Η προεπισκόπηση εμφανίζει μέρος της μελέτης. Το πλήρες κείμενο περιλαμβάνεται στο PDF.'),
    );
  });

  it('short preview does not show the truncation/help message (test 9)', () => {
    const html = renderReport(resultWithText('Σύντομο κείμενο μελέτης'));
    assert.equal(html.includes('Η προεπισκόπηση εμφανίζει μέρος της μελέτης'), false);
  });
});

/* ------------------------------------------------------------------ */
/* coexistence with PDF controls                                       */
/* ------------------------------------------------------------------ */

describe('reportPreview: coexistence', () => {
  it('still shows PDF availability (test 10)', () => {
    const html = renderReport(producedResult());
    assert.ok(html.includes('PDF: Διαθέσιμο'));
  });

  it('still shows «Λήψη PDF» when pdfBytes exist (test 11)', () => {
    const html = renderReport(producedResult());
    assert.ok(html.includes('Λήψη PDF'));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('reportPreview: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const reportSrc = readFileSync(
    join(here, '../src/components/sections/ReportSection.tsx'),
    'utf8',
  );
  const code = reportSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no runLoanAuditPipeline call in ReportSection (test 12)', () => {
    assert.equal(/runLoanAuditPipeline/.test(code), false);
  });

  it('no renderLoanAuditPdf call in ReportSection (test 13)', () => {
    assert.equal(/renderLoanAuditPdf/.test(code), false);
  });

  it('no report text renderer call in ReportSection (test 14)', () => {
    assert.equal(/renderLoanAuditReportText/.test(code), false);
  });

  it('no backend/persistence/auth/localStorage (test 15)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|writeFileSync/i.test(code),
      false,
    );
  });

  it('no Excel/OCR/file upload (test 16)', () => {
    assert.equal(/xlsx|tesseract|<input[^>]*type=["']file["']|readAsArrayBuffer/i.test(code), false);
  });

  it('no forbidden domain wording (tests 17, 18, 19)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|3869|6\/2026|αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        reportSrc,
      ),
      false,
    );
  });
});
