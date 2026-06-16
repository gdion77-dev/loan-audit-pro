/**
 * Loan Audit PRO — src/components/sections/FindingsSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Ευρήματα». Displays the ALREADY-COMPUTED
 * findings stored in pipelineResult.findingsResult. It recomputes
 * nothing and calls no engine — it only formats what the locked
 * pipeline produced. Signed amounts preserve their sign; a null
 * amount is shown as «Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.».
 */
import React from 'react';
import { SECTIONS } from './sectionDefinitions';
import { moneyFromCents, formatMoneyGreek } from '../../domain/money';
import { buildReconciliationFindings } from '../../ui-state/reconciliationFindingsAdapter';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';
import type { TechnicalFinding } from '../../engines/findingsEngine';

const def = SECTIONS.find((s) => s.id === 'findings')!;

const NOT_FINALIZED = 'Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.';

function signedMoneyOrNotFinalized(cents: number | null): string {
  if (cents === null) return NOT_FINALIZED;
  const formatted = formatMoneyGreek(moneyFromCents(Math.abs(cents)));
  return cents < 0 ? `−${formatted}` : formatted;
}

export interface FindingsSectionProps {
  readonly pipelineResult: LoanAuditPipelineResult | null;
}

export const FindingsSection: React.FC<FindingsSectionProps> = ({ pipelineResult }) => {
  const findingsResult = pipelineResult?.findingsResult ?? null;
  // Presentation-only merge: the locked findings engine only compares
  // Τράπεζα/Fund vs Επανυπολογισμό. When the user also entered actual
  // payments, append the (already-computed) reconciliation findings so
  // both kinds of deviation are visible together. No recomputation.
  const reconciliationFindings = buildReconciliationFindings(
    pipelineResult?.paymentReconciliationResult ?? null,
  );
  const allFindings: readonly TechnicalFinding[] = [
    ...(findingsResult?.findings ?? []),
    ...reconciliationFindings,
  ];

  return (
    <section className="lap-card" aria-label={def.title}>
      <h2 className="lap-card__title">{def.title}</h2>
      <p className="lap-card__explanation">{def.explanation}</p>

      {findingsResult === null ? (
        <p className="lap-empty-state">Δεν έχει εκτελεστεί ακόμη μελέτη.</p>
      ) : (
        <>
          <p className="lap-result-status">Κατάσταση: {findingsResult.status}</p>
          <p className="lap-result-status">Πλήθος ευρημάτων: {allFindings.length}</p>

          {allFindings.length === 0 ? (
            <p className="lap-empty-state">Δεν εντοπίστηκαν τεχνικά οικονομικά ευρήματα.</p>
          ) : (
            <ul className="lap-findings-list">
              {allFindings.map((finding: TechnicalFinding) => (
                <li key={finding.findingId} className={`lap-finding lap-finding--${finding.level}`}>
                  <span className="lap-finding__id">{finding.findingId}</span>
                  <span className="lap-finding__level">{finding.level}</span>
                  <span className="lap-finding__title">{finding.title}</span>
                  <span className="lap-finding__amount">
                    Ποσό: {signedMoneyOrNotFinalized(finding.amountCents)}
                  </span>
                  {finding.affectedPeriods.length > 0 ? (
                    <span className="lap-finding__periods">
                      Περίοδοι: {finding.affectedPeriods.join(', ')}
                    </span>
                  ) : null}
                  <span className="lap-finding__safe">
                    {finding.reportSafe ? 'Κατάλληλο για αναφορά' : 'Μόνο εσωτερικός έλεγχος'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};
