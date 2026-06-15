/**
 * Loan Audit PRO — src/ui-state/browserPdf.ts
 * ------------------------------------------------------------------
 * Browser-native, on-demand PDF generation. It reuses the ALREADY
 * PRODUCED report text from the stored pipeline result and the LOCKED
 * PDF renderer — it recomputes nothing and changes no formula. Fonts
 * are pre-fetched into the browser cache, then the (synchronous)
 * renderer runs with those bytes.
 *
 * The renderer is imported dynamically so it (and the font code) are
 * code-split out of the initial bundle.
 */
import type { LoanAuditPipelineResult } from '../engines/loanAuditPipelineRunner';

export type BrowserPdfStatus = 'ok' | 'no_report_text' | 'render_failed';

export interface BrowserPdfResult {
  readonly status: BrowserPdfStatus;
  readonly pdfBytes: Uint8Array | null;
  readonly message: string;
}

/**
 * Generates PDF bytes in the browser from the stored pipeline result.
 * Returns no_report_text when the run produced no report text.
 */
export async function generatePdfInBrowser(
  pipelineResult: LoanAuditPipelineResult | null,
): Promise<BrowserPdfResult> {
  const reportText = pipelineResult?.reportTextResult ?? null;
  if (reportText === null) {
    return {
      status: 'no_report_text',
      pdfBytes: null,
      message: 'Δεν υπάρχει διαθέσιμο κείμενο μελέτης για παραγωγή PDF.',
    };
  }

  try {
    // Preload fonts, then run the locked renderer with the stored text.
    const { preloadBrowserFonts } = await import('../renderers/browserFontCache');
    await preloadBrowserFonts();
    const { renderLoanAuditPdf } = await import('../renderers/pdfReportRenderer');
    const result = renderLoanAuditPdf({ reportText });
    if (result.pdfBytes === null || result.pdfBytes.length === 0) {
      return {
        status: 'render_failed',
        pdfBytes: null,
        message: 'Η παραγωγή PDF δεν ολοκληρώθηκε με τα διαθέσιμα δεδομένα.',
      };
    }
    return { status: 'ok', pdfBytes: result.pdfBytes, message: 'Το PDF δημιουργήθηκε.' };
  } catch {
    return {
      status: 'render_failed',
      pdfBytes: null,
      message: 'Η παραγωγή PDF απέτυχε στο πρόγραμμα περιήγησης.',
    };
  }
}
