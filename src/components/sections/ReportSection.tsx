/**
 * Loan Audit PRO — src/components/sections/ReportSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Μελέτη / PDF». Validation-aware execution of
 * the LOCKED pipeline. The «Εκτέλεση Μελέτης» button is enabled only
 * when the draft validation status is 'ready'; otherwise it is
 * disabled with a clear message. On click it asks AppShell to run the
 * pipeline (via the pure executePipelineFromDraft helper). After a
 * run, it shows the pipeline status and whether PDF bytes exist.
 *
 * No browser download, no save/load, no backend in this step.
 */
import React from 'react';
import { SECTIONS } from './sectionDefinitions';
import type { DraftStatus } from '../../ui-state/draftValidationSummary';
import type { PipelineRunStatus } from '../../ui-state/pipelineExecutor';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';
import type { FieldState } from '../../ui-state/fieldState';
import { fieldValue, fieldUnknown } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'report')!;

export interface ReportSectionProps {
  readonly draftStatus: DraftStatus;
  readonly pipelineRunStatus: PipelineRunStatus;
  readonly pipelineResult: LoanAuditPipelineResult | null;
  readonly onExecute: () => void;
  readonly onDownloadPdf: () => void;
  /** Opens the professional HTML report (print-to-PDF) in a new tab. */
  readonly onOpenHtmlReport?: () => void;
  /** Optional status/error message from browser PDF generation. */
  readonly pdfBrowserMessage?: string | null;
  /** Free-text economic observations printed in the report. */
  readonly analystNotes?: FieldState<string>;
  readonly onAnalystNotesChange?: (next: FieldState<string>) => void;
}

function runStatusLabel(status: PipelineRunStatus): string {
  switch (status) {
    case 'not_run':
      return 'Δεν έχει εκτελεστεί ακόμη υπολογισμός';
    case 'running':
      return 'Σε εξέλιξη…';
    case 'success':
      return 'Επιτυχία';
    case 'requires_review':
      return 'Απαιτείται έλεγχος';
    case 'missing_data':
      return 'Ελλιπή δεδομένα';
    case 'failed':
      return 'Αποτυχία εκτέλεσης';
  }
}

export const ReportSection: React.FC<ReportSectionProps> = ({
  draftStatus,
  pipelineRunStatus,
  pipelineResult,
  onExecute,
  onDownloadPdf,
  onOpenHtmlReport,
  pdfBrowserMessage,
  analystNotes,
  onAnalystNotesChange,
}) => {
  const ready = draftStatus === 'ready';
  const pdfBytesExist =
    pipelineResult?.pdfResult?.pdfBytes != null && pipelineResult.pdfResult.pdfBytes.length > 0;
  // A PDF can be produced if the pipeline already made bytes (Node) OR a
  // report text exists to render on demand in the browser.
  const reportTextExists =
    pipelineResult?.reportTextResult != null && pipelineResult.reportTextResult.fullText.length > 0;
  const canDownload = pdfBytesExist || reportTextExists;

  return (
    <section className="lap-card" aria-label={def.title}>
      <h2 className="lap-card__title">{def.title}</h2>
      <p className="lap-card__explanation">{def.explanation}</p>

      <p className={`lap-draft-status lap-draft-status--${ready ? 'ready' : draftStatus === 'missing_data' ? 'missing-data' : 'requires-review'}`}>
        {ready
          ? 'Το προσχέδιο είναι έτοιμο για εκτέλεση μελέτης.'
          : 'Η μελέτη δεν μπορεί να εκτελεστεί ακόμη. Συμπληρώστε ή ελέγξτε τα ελλείποντα δεδομένα.'}
      </p>

      <button type="button" className="lap-btn" onClick={() => onExecute()} disabled={!ready}>
        Εκτέλεση Μελέτης
      </button>

      <div className="lap-report-grid">
        <div className="lap-report-card">
          <h3 className="lap-report-card__title">Προεπισκόπηση μελέτης</h3>
          <p className="lap-report-card__hint">
            {pipelineResult?.reportTextResult != null
              ? 'Η οικονομική μελέτη δημιουργήθηκε ως δομημένο κείμενο.'
              : 'Η οικονομική μελέτη θα εμφανίζεται εδώ ως δομημένο κείμενο.'}
          </p>
        </div>
        <div className="lap-report-card">
          <h3 className="lap-report-card__title">Παραγωγή PDF</h3>
          <p className="lap-report-card__hint">
            {pdfBytesExist
              ? 'Το PDF δημιουργήθηκε (η λήψη θα προστεθεί σε επόμενο βήμα).'
              : 'Η εξαγωγή PDF θα ενεργοποιηθεί μετά τον επανυπολογισμό.'}
          </p>
        </div>
      </div>

      <p className="lap-status" role="status">
        Κατάσταση: {runStatusLabel(pipelineRunStatus)}
      </p>

      {pipelineResult !== null ? (
        <p className="lap-report-pdf-flag">
          PDF: {canDownload ? 'Διαθέσιμο' : 'Μη διαθέσιμο'}
        </p>
      ) : null}

      {onAnalystNotesChange ? (
        <div style={{ marginTop: '16px' }}>
          <label htmlFor="report-analyst-notes" style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
            Παρατηρήσεις συντάκτη (τυπώνονται στην οικονομική έκθεση)
          </label>
          <p className="lap-field-help" style={{ marginTop: 0, marginBottom: '6px' }}>
            Προαιρετικό ελεύθερο κείμενο με τις δικές σας οικονομικές παρατηρήσεις. Εμφανίζεται στην
            τελευταία σελίδα «Οικονομική Έκθεση» του PDF.
          </p>
          <textarea
            id="report-analyst-notes"
            value={analystNotes && analystNotes.status === 'value' ? analystNotes.value : ''}
            onChange={(e: { target: { value: string } }) =>
              onAnalystNotesChange(
                e.target.value === '' ? fieldUnknown<string>('manual') : fieldValue<string>(e.target.value, 'manual'),
              )
            }
            rows={6}
            placeholder="π.χ. σχόλια για το συνολικό κόστος, τις αποκλίσεις, ή προτάσεις διευθέτησης…"
            style={{ width: '100%', padding: '10px', fontSize: '13px', fontFamily: 'inherit', borderRadius: '8px', border: '1px solid var(--hair, #ddd)', resize: 'vertical' }}
          />
        </div>
      ) : null}

      {pipelineResult !== null && canDownload ? (
        <div className="lap-btn-row">
          {onOpenHtmlReport ? (
            <button type="button" className="lap-btn" onClick={() => onOpenHtmlReport()}>
              Άνοιγμα επαγγελματικής αναφοράς (PDF)
            </button>
          ) : null}
          <button type="button" className="lap-btn lap-btn--secondary" onClick={() => onDownloadPdf()}>
            Λήψη απλού PDF
          </button>
        </div>
      ) : null}

      {pdfBrowserMessage != null && pdfBrowserMessage.length > 0 ? (
        <p className="lap-report-pdf-flag" role="status">
          {pdfBrowserMessage}
        </p>
      ) : null}

      {pipelineResult !== null ? renderTextPreview(pipelineResult) : null}
    </section>
  );
};

const PREVIEW_LIMIT = 3000;

/** Read-only preview of the already-produced report text (no regeneration). */
function renderTextPreview(pipelineResult: LoanAuditPipelineResult): React.ReactElement {
  const fullText = pipelineResult.reportTextResult?.fullText ?? null;
  if (fullText === null || fullText.length === 0) {
    return <p className="lap-report-pdf-flag">Προεπισκόπηση κειμένου: Μη διαθέσιμη</p>;
  }
  const truncated = fullText.length > PREVIEW_LIMIT;
  const preview = truncated ? fullText.slice(0, PREVIEW_LIMIT) : fullText;
  return (
    <div className="lap-report-preview">
      <h3 className="lap-report-card__title">Προεπισκόπηση κειμένου</h3>
      {/* <pre> is inherently non-editable and preserves line breaks and Greek. */}
      <pre className="lap-report-preview__box" aria-readonly="true" tabIndex={0}>
        {preview}
      </pre>
      {truncated ? (
        <p className="lap-report-preview__note">
          Η προεπισκόπηση εμφανίζει μέρος της μελέτης. Το πλήρες κείμενο περιλαμβάνεται στο PDF.
        </p>
      ) : null}
    </div>
  );
}
