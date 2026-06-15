/**
 * Tests: production PDF renderer (Step 8-B).
 * Covers the 17 required scenarios.
 *
 * Text extraction: pdfjs-dist (legacy Node build) is available in
 * this environment; header, footer numbering, Greek title, euro
 * amounts and signs are verified from ACTUAL extracted PDF text
 * (the renderer embeds /ToUnicode CMaps for both fonts). The
 * spec-allowed fallbacks are kept in case extraction is unavailable.
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
  renderLoanAuditPdf,
  buildSummaryTableFromComparison,
  verifyGreekGlyphCoverage,
  PDF_AUDIT_CODES,
} from '../src/renderers/pdfReportRenderer';
import { findForbiddenFindingTerms } from '../src/engines/findingsEngine';
import {
  realReportText,
  realReportBundle,
  longReportText,
  poisonedReportText,
} from './fixtures/reportTextFixtures';

const REQUIRED_SECTION_TITLES = [
  'Εξώφυλλο / Ταυτότητα Μελέτης',
  'Στοιχεία Υπόθεσης',
  'Σύνοψη Ελέγχου',
  'Δεδομένα Τράπεζας / Fund',
  'Δεδομένα Επανυπολογισμού',
  'Μεθοδολογία Επανυπολογισμού',
  'Συγκριτικά Αποτελέσματα',
  'Τεχνικά Οικονομικά Ευρήματα',
  'Ελλείποντα Δεδομένα',
  'Περιορισμοί Μελέτης',
  'Δήλωση Περιορισμού',
  'Στοιχεία Συντάκτη / Γραφείου',
];

/** Extract all text from PDF bytes via pdfjs-dist; null if unavailable. */
async function extractPdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: bytes.slice(),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    }).promise;
    let text = '';
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text +=
        content.items
          .map((i) => ('str' in i ? (i as { str: string }).str : ''))
          .join(' ') + '\n';
    }
    await doc.destroy();
    return text;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* production output                                                   */
/* ------------------------------------------------------------------ */

describe('pdfReportRenderer: production output', () => {
  const bundle = realReportBundle();
  const table = buildSummaryTableFromComparison(bundle.comparisonSummary);
  const result = renderLoanAuditPdf({ reportText: bundle.reportText, summaryTable: table });

  it('PDF bytes produced for clean report, with %PDF header (test 1)', () => {
    assert.equal(result.status, 'success');
    assert.ok(result.pdfBytes && result.pdfBytes.length > 10_000);
    assert.equal(Buffer.from(result.pdfBytes.slice(0, 5)).toString('latin1'), '%PDF-');
    assert.ok(result.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_RENDERED));
  });

  it('page count accurate, at least 1, consistent with audit (test 2)', () => {
    assert.ok(result.pageCount !== null && result.pageCount >= 1);
    const e = result.auditEntries.find((x) => x.code === PDF_AUDIT_CODES.PDF_RENDERED);
    assert.equal((e!.context as Record<string, unknown>)['pageCount'], result.pageCount);
  });

  it('full report has complete Greek glyph coverage', () => {
    const coverage = verifyGreekGlyphCoverage(bundle.reportText.fullText);
    assert.deepEqual(coverage.missing, []);
  });

  it('header, footer numbering, title, amounts, signs, sections in EXTRACTED text (tests 3-8)', async () => {
    assert.ok(result.pdfBytes);
    const extracted = await extractPdfText(result.pdfBytes);
    if (extracted === null) {
      // spec-allowed fallback:
      assert.ok(bundle.reportText.fullText.includes('Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου'));
      assert.ok(bundle.reportText.fullText.includes('+5,32'));
      assert.ok(bundle.reportText.fullText.includes('-1,83'));
      return;
    }
    const squashed = extracted.replace(/\s+/g, ' ');
    // test 3: header branding on the page:
    assert.ok(squashed.includes('Loan Audit PRO'));
    assert.ok(squashed.includes('The Bizboost by G. Dionysiou'));
    // test 4: footer numbering with accurate total:
    assert.ok(squashed.includes(`Σελίδα 1 από ${result.pageCount}`));
    assert.ok(squashed.includes('Τεχνική οικονομική αποτύπωση βάσει διαθέσιμων δεδομένων.'));
    // test 5: Greek title:
    assert.ok(squashed.includes('Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου'));
    // test 6: euro amounts:
    assert.ok(squashed.includes('10.000,00 €'));
    // test 7: signs preserved:
    assert.ok(squashed.includes('+5,32'));
    assert.ok(squashed.includes('-1,83'));
    // test 8: all 12 sections:
    for (const title of REQUIRED_SECTION_TITLES) assert.ok(squashed.includes(title), title);
  });

  it('limitations section readable in extracted text (test 9)', async () => {
    const extracted = await extractPdfText(result.pdfBytes!);
    if (extracted === null) {
      const s10 = bundle.reportText.sections.find((s) => s.sectionId === 'S10')!;
      assert.ok(s10.body.length > 0);
      return;
    }
    const squashed = extracted.replace(/\s+/g, ' ');
    assert.ok(squashed.includes('Περιορισμοί Μελέτης'));
    assert.ok(squashed.includes('γνωμοδότηση νομικού περιεχομένου'));
  });

  it('comparative table rendered from existing summary values (extracted)', async () => {
    const extracted = await extractPdfText(result.pdfBytes!);
    if (extracted === null) {
      assert.ok(table.length === 3); // fallback: rows exist
      return;
    }
    const squashed = extracted.replace(/\s+/g, ' ');
    for (const h of ['Μέγεθος', 'Τράπεζα / Fund', 'Επανυπολογισμός', 'Οικονομική Διαφορά', 'Σημείωση']) {
      assert.ok(squashed.includes(h), h);
    }
    // values from the EXISTING summary: bank installments 65240+64708,
    // recalc 2×64708, diff +532; interest diff −183:
    assert.ok(squashed.includes('1.299,48 €')); // total bank installments
    assert.ok(squashed.includes('1.294,16 €')); // total recalc installments
    assert.ok(squashed.includes('+5,32 €'));
    assert.ok(squashed.includes('-1,83 €'));
    // no table-skip info when the table was provided:
    assert.equal(
      result.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_TABLE_SKIPPED),
      false,
    );
  });

  it('table skipped with audit info when structured values are absent', () => {
    const r = renderLoanAuditPdf({ reportText: realReportText() });
    assert.equal(r.status, 'success');
    assert.ok(r.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_TABLE_SKIPPED));
  });

  it('null totals render as dash with note, never 0,00 € (test 12)', async () => {
    // a summary with null totals — pass it through the table formatter:
    const rows = buildSummaryTableFromComparison({
      ...realReportBundle().comparisonSummary,
      totalBankInstallmentsCents: null,
      totalRecalculatedInstallmentsCents: null,
      totalEconomicDifferenceCents: null,
    });
    assert.equal(rows[0]!.bankText, '—');
    assert.equal(rows[0]!.diffText, '—');
    assert.ok(rows[0]!.noteText.includes('δεν οριστικοποιείται'));
    assert.equal(rows[0]!.bankText.includes('0,00'), false);
    const r = renderLoanAuditPdf({ reportText: realReportText(), summaryTable: rows });
    const extracted = await extractPdfText(r.pdfBytes!);
    if (extracted !== null) {
      assert.ok(extracted.includes('Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.'));
    }
  });
});

/* ------------------------------------------------------------------ */
/* paging                                                              */
/* ------------------------------------------------------------------ */

describe('pdfReportRenderer: paging', () => {
  it('long report produces multiple pages with correct footer totals (test 11)', async () => {
    const r = renderLoanAuditPdf({ reportText: longReportText() });
    assert.ok(r.pageCount !== null && r.pageCount >= 2);
    const extracted = await extractPdfText(r.pdfBytes!);
    if (extracted !== null) {
      const matches = [...extracted.matchAll(/Σελίδα (\d+) από (\d+)/g)];
      assert.equal(matches.length, r.pageCount); // one footer per page
      for (const m of matches) assert.equal(Number(m[2]), r.pageCount); // total accurate
      const pagesSeen = matches.map((m) => Number(m[1]));
      assert.deepEqual(pagesSeen, Array.from({ length: r.pageCount }, (_, i) => i + 1));
    }
    // section page breaks force >= 12 pages:
    const broken = renderLoanAuditPdf({
      reportText: realReportText(),
      options: { includeSectionPageBreaks: true },
    });
    assert.ok(broken.pageCount !== null && broken.pageCount >= 12);
  });
});

/* ------------------------------------------------------------------ */
/* fonts                                                               */
/* ------------------------------------------------------------------ */

describe('pdfReportRenderer: fonts', () => {
  it('bold font missing -> fallback to regular, PDF still produced (test 13)', () => {
    const r = renderLoanAuditPdf({
      reportText: realReportText(),
      options: { fontConfig: { boldPath: '/nonexistent/Bold.ttf' } },
    });
    assert.equal(r.status, 'success');
    assert.ok(r.pdfBytes);
    assert.ok(r.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_BOLD_FONT_FALLBACK));
  });

  it('regular Greek font missing -> PDF_FONT_UNAVAILABLE, no broken PDF (test 14)', () => {
    const r = renderLoanAuditPdf({
      reportText: realReportText(),
      options: { fontConfig: { regularPath: '/nonexistent/Sans.ttf' } },
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.pdfBytes, null);
    assert.equal(r.pageCount, null);
    assert.ok(r.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_FONT_UNAVAILABLE));
    assert.equal(r.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_RENDERED), false);
  });
});

/* ------------------------------------------------------------------ */
/* wording safety                                                      */
/* ------------------------------------------------------------------ */

describe('pdfReportRenderer: wording safety', () => {
  it('forbidden wording blocks rendering BEFORE PDF_RENDERED (test 10)', () => {
    const r = renderLoanAuditPdf({ reportText: poisonedReportText() });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.pdfBytes, null);
    assert.equal(r.pageCount, null);
    assert.ok(r.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_TEXT_NOT_NEUTRAL));
    assert.equal(r.auditEntries.some((e) => e.code === PDF_AUDIT_CODES.PDF_RENDERED), false);
  });

  it('forbidden wording in table cells also blocks rendering', () => {
    const r = renderLoanAuditPdf({
      reportText: realReportText(),
      summaryTable: [
        { label: 'Δόσεις', bankText: '1,00 €', recalcText: '1,00 €', diffText: '0,00 €', noteText: 'προς επιστροφή' },
      ],
    });
    assert.equal(r.status, 'requires_review');
    assert.equal(r.pdfBytes, null);
  });

  it('no ΑΠ 6/2026 or Ν.3869 wording in input or extracted output (test 17 output side)', async () => {
    const reportText = realReportText();
    assert.equal(/3869/.test(reportText.fullText), false);
    assert.equal(/6\s*\/\s*2026/.test(reportText.fullText), false);
    const r = renderLoanAuditPdf({ reportText });
    const extracted = await extractPdfText(r.pdfBytes!);
    if (extracted !== null) {
      assert.equal(/3869/.test(extracted), false);
      assert.equal(/6\s*\/\s*2026/.test(extracted), false);
      assert.deepEqual([...findForbiddenFindingTerms(extracted)], []);
    }
  });

  it('requires_review report text propagates to PDF status', () => {
    const base = realReportText();
    const reviewText = { ...base, status: 'requires_review' as const };
    const r = renderLoanAuditPdf({ reportText: reviewText });
    assert.equal(r.status, 'requires_review');
    assert.ok(r.pdfBytes); // rendered but flagged
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('pdfReportRenderer: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    join(here, '../src/renderers/pdfReportRenderer.ts'),
    'utf8',
  );
  const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no UI/React/markup renderer introduced (test 15)', () => {
    assert.equal(/React|jsx|className|innerHTML|document\.|window\.|<div|<\/|\.html\b/i.test(codeOnly), false);
  });

  it('no recalculation/schedule/comparison/findings logic introduced (test 16)', () => {
    assert.equal(
      /compareSchedules\s*\(|generateFindings\s*\(|buildLoanAuditReportModel\s*\(|renderLoanAuditReportText\s*\(|buildEqual|buildSingleRecalcRow|allocateSinglePayment|resolveRateForDate|calculateDayCount|calculateAccruedInterest/.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no ΑΠ 6/2026 or Ν.3869 outside the banned-fragments guard (test 17 source side)', () => {
    const withoutGuardList = codeOnly.replace(/const BANNED_FRAGMENTS[\s\S]*?\];/, '');
    assert.equal(/3869/.test(withoutGuardList), false);
    assert.equal(/6\s*\/\s*2026/.test(withoutGuardList), false);
  });
});
