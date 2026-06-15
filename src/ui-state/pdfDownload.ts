/**
 * Loan Audit PRO — src/ui-state/pdfDownload.ts
 * ------------------------------------------------------------------
 * Browser-side download of ALREADY-PRODUCED PDF bytes. This module
 * never regenerates a PDF: it consumes the Uint8Array stored in
 * pipelineResult.pdfResult.pdfBytes. It calls no engine, no renderer,
 * no pipeline; it does not upload, persist, or touch localStorage.
 *
 * The logic is split so it is testable without a real DOM:
 *   - buildPdfFilename: pure filename construction + sanitization.
 *   - createPdfBlob: wraps bytes in an application/pdf Blob.
 *   - downloadPdfBytes: orchestrates the download, with the DOM and
 *     URL APIs injected so tests can supply fakes and assert that the
 *     object URL is revoked.
 */

const DEFAULT_PDF_FILENAME = 'loan-audit-report.pdf';

/**
 * Sanitizes a filename fragment: keeps Latin letters, digits, dash and
 * underscore; everything else (spaces, slashes, dots, Greek, etc.) is
 * replaced with a dash; collapses repeats and trims dashes.
 */
export function sanitizeFilenameFragment(fragment: string): string {
  return fragment
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Builds a safe PDF filename. Uses the (sanitized) contract number
 * when available, else a fixed default. NEVER includes the debtor
 * name. Always ends in «.pdf».
 */
export function buildPdfFilename(contractNumber?: string | null): string {
  if (contractNumber != null) {
    const safe = sanitizeFilenameFragment(contractNumber);
    if (safe.length > 0) return `loan-audit-${safe}.pdf`;
  }
  return DEFAULT_PDF_FILENAME;
}

/** Wraps existing PDF bytes in an application/pdf Blob (no regeneration). */
export function createPdfBlob(pdfBytes: Uint8Array): Blob {
  // Copy into a fresh ArrayBuffer-backed view for Blob compatibility.
  const copy = new Uint8Array(pdfBytes.length);
  copy.set(pdfBytes);
  return new Blob([copy], { type: 'application/pdf' });
}

/** Minimal DOM/URL surface needed for a download — injectable for tests. */
export interface DownloadEnvironment {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly createAnchor: () => {
    href: string;
    download: string;
    click: () => void;
  };
}

export interface PdfDownloadOutcome {
  readonly triggered: boolean;
  readonly filename: string;
  /** True once the object URL has been revoked (always, after click). */
  readonly revoked: boolean;
  readonly reason?: string;
}

/**
 * Triggers a browser download of existing PDF bytes. Returns a result
 * describing what happened. If bytes are missing/empty, it does
 * nothing (no URL created). The object URL is always revoked after the
 * click. The environment is injected so this is unit-testable.
 */
export function downloadPdfBytes(
  pdfBytes: Uint8Array | null,
  contractNumber: string | null,
  env: DownloadEnvironment,
): PdfDownloadOutcome {
  const filename = buildPdfFilename(contractNumber);
  if (pdfBytes == null || pdfBytes.length === 0) {
    return { triggered: false, filename, revoked: false, reason: 'no_pdf_bytes' };
  }
  const blob = createPdfBlob(pdfBytes);
  const url = env.createObjectURL(blob);
  try {
    const anchor = env.createAnchor();
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    env.revokeObjectURL(url); // always revoke, even if click throws
  }
  return { triggered: true, filename, revoked: true };
}

/**
 * Builds a DownloadEnvironment from a real document/window. Used by the
 * UI; never invoked in tests (which inject a fake environment).
 */
export function browserDownloadEnvironment(
  doc: Document,
  urlApi: { createObjectURL: (b: Blob) => string; revokeObjectURL: (u: string) => void },
): DownloadEnvironment {
  return {
    createObjectURL: (blob) => urlApi.createObjectURL(blob),
    revokeObjectURL: (url) => urlApi.revokeObjectURL(url),
    createAnchor: () => doc.createElement('a'),
  };
}
