/**
 * Loan Audit PRO — src/ui-state/draftValidationSummary.ts
 * ------------------------------------------------------------------
 * User-facing validation summary for the draft state. Pure types +
 * a grouping helper that turns the adapter's flat issue list into a
 * per-section summary with an aggregate status. Greek neutral
 * wording only — no engine call, no calculation.
 */

import type { DraftToDomainResult, DraftIssue } from './draftToDomainAdapter';

export type DraftStatus = 'ready' | 'requires_review' | 'missing_data';

export type DraftIssueLevel = 'info' | 'warning' | 'requires_review' | 'missing_data';

export interface DraftValidationSummarySection {
  readonly sectionId: string;
  readonly title: string;
  readonly status: DraftStatus;
  readonly issues: readonly DraftIssue[];
}

export interface DraftValidationSummary {
  readonly status: DraftStatus;
  readonly sections: readonly DraftValidationSummarySection[];
}

/** Stable section order and Greek titles, aligned with the UI. */
const SECTION_TITLES: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'case_info', title: 'Στοιχεία Υπόθεσης' },
  { id: 'loan_terms', title: 'Όροι Δανείου / Ρύθμισης' },
  { id: 'rate_config', title: 'Επιτόκιο' },
  { id: 'bank_schedule', title: 'Δοσολόγιο Τράπεζας / Fund' },
  { id: 'actual_payments', title: 'Πραγματικές Καταβολές' },
  { id: 'recalc_settings', title: 'Ρυθμίσεις Επανυπολογισμού' },
];

/** A section's status is the worst level among its issues. */
function sectionStatus(issues: readonly DraftIssue[]): DraftStatus {
  if (issues.some((i) => i.level === 'missing_data')) return 'missing_data';
  if (issues.some((i) => i.level === 'requires_review' || i.level === 'warning')) {
    return 'requires_review';
  }
  return 'ready';
}

/** Greek label for an overall/section status. */
export function draftStatusLabel(status: DraftStatus): string {
  switch (status) {
    case 'ready':
      return 'Έτοιμο';
    case 'requires_review':
      return 'Απαιτείται έλεγχος';
    case 'missing_data':
      return 'Ελλιπή δεδομένα';
  }
}

/** Stable CSS modifier token for a status. */
export function draftStatusToken(status: DraftStatus): 'ready' | 'requires-review' | 'missing-data' {
  switch (status) {
    case 'ready':
      return 'ready';
    case 'requires_review':
      return 'requires-review';
    case 'missing_data':
      return 'missing-data';
  }
}

/** Greek label for an individual issue level. */
export function draftIssueLevelLabel(level: DraftIssueLevel): string {
  switch (level) {
    case 'info':
      return 'Πληροφορία';
    case 'warning':
      return 'Προειδοποίηση';
    case 'requires_review':
      return 'Απαιτείται έλεγχος';
    case 'missing_data':
      return 'Ελλιπή δεδομένα';
  }
}

/**
 * Groups the adapter's issues by section into a user-facing summary.
 * The overall status is copied from the adapter result (single source
 * of truth); per-section statuses are derived from their issues.
 */
export function buildDraftValidationSummary(
  result: DraftToDomainResult,
): DraftValidationSummary {
  const allIssues: readonly DraftIssue[] = [...result.missingData, ...result.warnings];
  const sections = SECTION_TITLES.map(({ id, title }) => {
    const issues = allIssues.filter((i) => i.section === id);
    return { sectionId: id, title, status: sectionStatus(issues), issues };
  });
  return { status: result.status, sections };
}
