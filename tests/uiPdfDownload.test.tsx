/**
 * Tests: PDF download (Step 14-A).
 * Covers the 18 required scenarios.
 *
 * The download mechanics are pure/injectable (buildPdfFilename,
 * createPdfBlob, downloadPdfBytes with an injected environment), so
 * they are tested without a real DOM. ReportSection is checked via
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

import { ReportSection } from '../src/components/sections/ReportSection';
import {
  buildPdfFilename,
  sanitizeFilenameFragment,
  createPdfBlob,
  downloadPdfBytes,
  type DownloadEnvironment,
} from '../src/ui-state/pdfDownload';
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

/* ------------------------------------------------------------------ */
/* a ready draft + real pipeline result with pdf bytes                 */
/* ------------------------------------------------------------------ */

function readyDraft(): LoanAuditDraftState {
  const base = createEmptyDraftState();
  let d: LoanAuditDraftState = {
    ...base,
    caseInfoDraft: {
      debtorName: fieldValue<string>('Επώνυμο Οφειλέτη'),
      contractNumber: fieldValue<string>('4500/1 A'),
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

/** A fake environment that records calls and never touches a real DOM. */
function fakeEnv(): {
  env: DownloadEnvironment;
  calls: { created: number; revoked: number; clicked: number; href: string; download: string };
} {
  const calls = { created: 0, revoked: 0, clicked: 0, href: '', download: '' };
  const env: DownloadEnvironment = {
    createObjectURL: () => {
      calls.created += 1;
      return 'blob:fake-url';
    },
    revokeObjectURL: () => {
      calls.revoked += 1;
    },
    createAnchor: () => ({
      set href(v: string) {
        calls.href = v;
      },
      get href() {
        return calls.href;
      },
      set download(v: string) {
        calls.download = v;
      },
      get download() {
        return calls.download;
      },
      click: () => {
        calls.clicked += 1;
      },
    }),
  };
  return { env, calls };
}

/* ------------------------------------------------------------------ */
/* filename                                                            */
/* ------------------------------------------------------------------ */

describe('pdfDownload: filename', () => {
  it('defaults to loan-audit-report.pdf (test 8)', () => {
    assert.equal(buildPdfFilename(), 'loan-audit-report.pdf');
    assert.equal(buildPdfFilename(null), 'loan-audit-report.pdf');
    assert.equal(buildPdfFilename(''), 'loan-audit-report.pdf');
  });

  it('uses a sanitized contract number (test 9)', () => {
    assert.equal(buildPdfFilename('4500/1 A'), 'loan-audit-4500-1-A.pdf');
    assert.equal(buildPdfFilename('  weird**name  '), 'loan-audit-weird-name.pdf');
  });

  it('sanitizes unsafe characters and Greek to dashes', () => {
    assert.equal(sanitizeFilenameFragment('a/b\\c:d e'), 'a-b-c-d-e');
    assert.equal(sanitizeFilenameFragment('Σύμβαση 12'), '12'); // Greek stripped, digits kept
  });

  it('never includes the debtor name (test 10)', () => {
    // even when a debtor-like string is passed as contractNumber, only
    // the contract fragment is used; the API has no debtor parameter:
    const name = buildPdfFilename('4500-1');
    assert.equal(name.includes('Οφειλ'), false);
    assert.equal(buildPdfFilename.length, 1); // single param: contractNumber only
  });
});

/* ------------------------------------------------------------------ */
/* blob + download mechanics                                           */
/* ------------------------------------------------------------------ */

describe('pdfDownload: mechanics', () => {
  it('creates an application/pdf Blob (test 6)', () => {
    const blob = createPdfBlob(new Uint8Array([1, 2, 3]));
    assert.equal(blob.type, 'application/pdf');
    assert.equal(blob.size, 3);
  });

  it('uses existing bytes without regenerating (test 7)', () => {
    // the helper only receives bytes; it has no pipeline/renderer access.
    const result = producedResult();
    const bytes = result.pdfResult?.pdfBytes ?? null;
    assert.ok(bytes && bytes.length > 0);
    const { env, calls } = fakeEnv();
    const outcome = downloadPdfBytes(bytes, '4500-1', env);
    assert.equal(outcome.triggered, true);
    assert.equal(calls.created, 1);
    assert.equal(calls.clicked, 1);
  });

  it('revokes the object URL after the click (test 11)', () => {
    const { env, calls } = fakeEnv();
    const outcome = downloadPdfBytes(new Uint8Array([1, 2, 3, 4]), null, env);
    assert.equal(outcome.revoked, true);
    assert.equal(calls.created, 1);
    assert.equal(calls.revoked, 1);
    assert.equal(outcome.filename, 'loan-audit-report.pdf');
  });

  it('does nothing when pdf bytes are missing or empty', () => {
    const { env, calls } = fakeEnv();
    const a = downloadPdfBytes(null, '4500-1', env);
    const b = downloadPdfBytes(new Uint8Array([]), '4500-1', env);
    assert.equal(a.triggered, false);
    assert.equal(b.triggered, false);
    assert.equal(calls.created, 0); // no URL created
    assert.equal(calls.revoked, 0);
  });
});

/* ------------------------------------------------------------------ */
/* ReportSection UI                                                    */
/* ------------------------------------------------------------------ */

describe('pdfDownload: ReportSection UI', () => {
  const renderReport = (
    pipelineResult: LoanAuditPipelineResult | null,
  ): string =>
    renderToStaticMarkup(
      React.createElement(ReportSection, {
        draftStatus: 'ready',
        pipelineRunStatus: pipelineResult ? 'success' : 'not_run',
        pipelineResult,
        onExecute: () => {},
        onDownloadPdf: () => {},
      }),
    );

  it('no download button before pipeline execution (test 1)', () => {
    const html = renderReport(null);
    assert.equal(html.includes('Λήψη PDF'), false);
  });

  it('shows «PDF: Μη διαθέσιμο» only when there is neither bytes nor report text (test 2)', () => {
    // no pdf bytes AND no report text → truly unavailable
    const noPdf = { ...producedResult(), pdfResult: null, reportTextResult: null } as LoanAuditPipelineResult;
    const html = renderReport(noPdf);
    assert.ok(html.includes('PDF: Μη διαθέσιμο'));
    assert.equal(html.includes('Λήψη PDF'), false);
  });

  it('shows «PDF: Διαθέσιμο» when pdfBytes exist (test 3)', () => {
    const html = renderReport(producedResult());
    assert.ok(html.includes('PDF: Διαθέσιμο'));
  });

  it('shows the «Λήψη PDF» button when pdfBytes exist (test 4)', () => {
    const html = renderReport(producedResult());
    assert.ok(html.includes('Λήψη PDF'));
  });

  it('offers on-demand download when report text exists but no pdf bytes (browser path, test 5)', () => {
    // browser case: pipeline ran with renderPdf:false (pdfResult null) but a
    // report text exists → PDF can be generated on demand, button shown.
    const noBytes = { ...producedResult(), pdfResult: null } as LoanAuditPipelineResult;
    const html = renderReport(noBytes);
    assert.ok(html.includes('PDF: Διαθέσιμο'));
    assert.ok(html.includes('Λήψη PDF'));
  });

  it('still offers download when bytes are empty but report text exists', () => {
    const base = producedResult();
    const emptyPdf = {
      ...base,
      pdfResult: { ...base.pdfResult, pdfBytes: new Uint8Array(0) },
    } as LoanAuditPipelineResult;
    const html = renderReport(emptyPdf);
    assert.ok(html.includes('Λήψη PDF')); // on-demand generation from report text
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('pdfDownload: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, '../src');

  // ReportSection + AppShell must not regenerate PDFs or do ad-hoc
  // downloads; the sanctioned pdfDownload.ts owns the mechanics.
  const reportSrc = readFileSync(join(srcRoot, 'components/sections/ReportSection.tsx'), 'utf8');
  const appShellSrc = readFileSync(join(srcRoot, 'components/layout/AppShell.tsx'), 'utf8');
  const helperSrc = readFileSync(join(srcRoot, 'ui-state/pdfDownload.ts'), 'utf8');
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no renderLoanAuditPdf call in ReportSection/AppShell/helper (test 12)', () => {
    assert.equal(/renderLoanAuditPdf/.test(strip(reportSrc)), false);
    assert.equal(/renderLoanAuditPdf/.test(strip(appShellSrc)), false);
    assert.equal(/renderLoanAuditPdf/.test(strip(helperSrc)), false);
  });

  it('no runLoanAuditPipeline added outside sanctioned executor (test 13)', () => {
    assert.equal(/runLoanAuditPipeline/.test(strip(reportSrc)), false);
    assert.equal(/runLoanAuditPipeline/.test(strip(helperSrc)), false);
  });

  it('helper does not upload/persist/regenerate (test 14)', () => {
    const code = strip(helperSrc);
    assert.equal(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|renderLoanAuditPdf|runLoanAuditPipeline/i.test(code), false);
  });

  it('no Excel/OCR/file upload in helper (test 15)', () => {
    assert.equal(/xlsx|tesseract|<input[^>]*type=["']file["']|readAsArrayBuffer/i.test(strip(helperSrc)), false);
  });

  it('no forbidden domain wording across the new files (tests 16, 17, 18)', () => {
    const all = reportSrc + '\n' + appShellSrc + '\n' + helperSrc;
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|3869|6\/2026|αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        all,
      ),
      false,
    );
  });
});
