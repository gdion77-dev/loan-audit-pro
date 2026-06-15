/**
 * Loan Audit PRO — src/components/layout/AuditPanel.tsx
 * ------------------------------------------------------------------
 * The permanent right-hand «Φάκελος Ελέγχου» panel. It now displays
 * the DRAFT validation summary (from adaptDraftToDomain →
 * buildDraftValidationSummary): an overall draft status plus issues
 * grouped by section, each with its level, field label, message and
 * row context. This is DRAFT validation only — it is NOT connected
 * to real engine AuditEntry data, and no pipeline/PDF call occurs.
 */
import React from 'react';
import {
  draftStatusLabel,
  draftStatusToken,
  draftIssueLevelLabel,
  type DraftValidationSummary,
} from '../../ui-state/draftValidationSummary';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';

export const AUDIT_PANEL_TITLE = 'Φάκελος Ελέγχου';

export interface AuditPanelProps {
  readonly summary: DraftValidationSummary;
  /** Optional: audit entries from the last pipeline run, grouped by stage. */
  readonly pipelineResult?: LoanAuditPipelineResult | null;
}

interface StageGroup {
  readonly stage: string;
  readonly messages: readonly string[];
}

/** Groups pipeline audit entries by their `stage` context tag. */
function groupByStage(result: LoanAuditPipelineResult): readonly StageGroup[] {
  const order: string[] = [];
  const byStage = new Map<string, string[]>();
  for (const entry of result.auditEntries) {
    const stage = String((entry.context as Record<string, unknown> | undefined)?.['stage'] ?? 'γενικά');
    if (!byStage.has(stage)) {
      byStage.set(stage, []);
      order.push(stage);
    }
    byStage.get(stage)!.push(entry.message);
  }
  return order.map((stage) => ({ stage, messages: byStage.get(stage)! }));
}

export const AuditPanel: React.FC<AuditPanelProps> = ({ summary, pipelineResult }) => {
  const sectionsWithIssues = summary.sections.filter((s) => s.issues.length > 0);
  const hasIssues = sectionsWithIssues.length > 0;
  const stageGroups = pipelineResult != null ? groupByStage(pipelineResult) : [];

  return (
    <aside className="lap-audit-panel" aria-label={AUDIT_PANEL_TITLE}>
      <h2 className="lap-audit-panel__title">{AUDIT_PANEL_TITLE}</h2>

      <p
        className={`lap-draft-status lap-draft-status--${draftStatusToken(summary.status)}`}
        role="status"
      >
        Κατάσταση προσχεδίου: {draftStatusLabel(summary.status)}
      </p>

      <p className="lap-audit-panel__hint">
        Έλεγχος προσχεδίου. Η σύνδεση με πραγματικά AuditEntry θα γίνει σε επόμενο βήμα.
      </p>

      {!hasIssues ? (
        <p className="lap-audit-empty">Δεν εντοπίστηκαν ελλείψεις στο προσχέδιο.</p>
      ) : (
        sectionsWithIssues.map((section) => (
          <div key={section.sectionId} className="lap-audit-group">
            <h3 className="lap-audit-group__label">
              {section.title} — {draftStatusLabel(section.status)}
            </h3>
            <ul className="lap-audit-group__list">
              {section.issues.map((issue, i) => (
                <li
                  key={`${section.sectionId}-${i}`}
                  className={`lap-audit-issue lap-audit-issue--${issue.level}`}
                >
                  <span className="lap-audit-issue__level">{draftIssueLevelLabel(issue.level)}</span>
                  <span className="lap-audit-issue__field">{issue.fieldLabel}</span>
                  <span className="lap-audit-issue__message">{issue.message}</span>
                  {issue.rowId !== undefined ? (
                    <span className="lap-audit-issue__row">Γραμμή: {issue.rowId}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {stageGroups.length > 0 ? (
        <div className="lap-audit-pipeline">
          <h3 className="lap-audit-panel__subtitle">Αποτελέσματα εκτέλεσης</h3>
          {stageGroups.map((group) => (
            <div key={group.stage} className="lap-audit-group">
              <h4 className="lap-audit-group__label">Στάδιο: {group.stage}</h4>
              <ul className="lap-audit-group__list">
                {group.messages.map((message, i) => (
                  <li key={`${group.stage}-${i}`} className="lap-audit-group__entry">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
};
