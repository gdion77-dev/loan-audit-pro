/**
 * Loan Audit PRO — src/components/sections/ComparisonSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Σύγκριση». Displays the ALREADY-COMPUTED
 * comparison result stored in pipelineResult.comparisonResult. It
 * recomputes nothing and calls no engine — it only formats values
 * that the locked pipeline already produced. Null totals are shown as
 * «Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.» — never as 0,00 €.
 */
import React from 'react';
import { SECTIONS } from './sectionDefinitions';
import { moneyFromCents, formatMoneyGreek } from '../../domain/money';
import type { NullableMoney } from '../../domain/money';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';
import type { ComparisonRow } from '../../domain/comparisonTypes';
import type {
  ActualPaymentsAmortizationResult,
  ActualAmortizationRow,
  ActualAmortizationRowStatus,
} from '../../engines/actualPaymentsAmortizationEngine';

const def = SECTIONS.find((s) => s.id === 'comparison')!;

const NOT_FINALIZED = 'Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.';
const NOT_FINALIZED_SHORT = 'Δεν οριστικοποιείται';
const SIGN_CONVENTION =
  'Η οικονομική διαφορά υπολογίζεται ως ποσό Τράπεζας/Fund μείον ποσό επανυπολογισμού.';
const ROW_PREVIEW_LIMIT = 100;

const ACTUAL_STATUS_LABEL: Record<ActualAmortizationRowStatus, string> = {
  settled_on_time: 'Εξοφλήθηκε εμπρόθεσμα',
  settled_late: 'Εξοφλήθηκε εκπρόθεσμα',
  partially_settled: 'Μερική εξόφληση',
  unsettled: 'Ανεξόφλητη',
  requires_review: 'Απαιτείται έλεγχος',
};

/** dd.mm.yyyy display from an ISO date, mirroring htmlReport.ts. */
function isoToGreekDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Signed euro display preserving the sign; null → not-finalized text. */
function signedMoneyOrNotFinalized(cents: number | null): string {
  if (cents === null) return NOT_FINALIZED;
  const formatted = formatMoneyGreek(moneyFromCents(Math.abs(cents)));
  return cents < 0 ? `−${formatted}` : formatted;
}

/** Short variant for table cells. */
function signedCellOrNotFinalized(cents: number | null): string {
  if (cents === null) return NOT_FINALIZED_SHORT;
  const formatted = formatMoneyGreek(moneyFromCents(Math.abs(cents)));
  return cents < 0 ? `−${formatted}` : formatted;
}

/** Cents from a NullableMoney without recomputation; null stays null. */
function centsOf(money: NullableMoney): number | null {
  return money === null ? null : money.cents;
}

export interface ComparisonSectionProps {
  readonly pipelineResult: LoanAuditPipelineResult | null;
  readonly actualPaymentsAmortization?: ActualPaymentsAmortizationResult | null;
}

export const ComparisonSection: React.FC<ComparisonSectionProps> = ({
  pipelineResult,
  actualPaymentsAmortization = null,
}) => {
  const comparison = pipelineResult?.comparisonResult ?? null;

  return (
    <section className="lap-card" aria-label={def.title}>
      <h2 className="lap-card__title">{def.title}</h2>
      <p className="lap-card__explanation">{def.explanation}</p>

      {comparison === null ? (
        <p className="lap-empty-state">Δεν έχει εκτελεστεί ακόμη μελέτη.</p>
      ) : (
        <>
          <p className="lap-result-status">Κατάσταση: {comparison.status}</p>

          {comparison.summary !== null ? (
            <dl className="lap-result-grid">
              <div className="lap-result-row">
                <dt>Συγκριθείσες γραμμές</dt>
                <dd>{comparison.summary.comparedRowCount}</dd>
              </div>
              <div className="lap-result-row">
                <dt>Μη αντιστοιχισμένες γραμμές Τράπεζας/Fund</dt>
                <dd>{comparison.summary.unmatchedBankRowCount}</dd>
              </div>
              <div className="lap-result-row">
                <dt>Μη αντιστοιχισμένες γραμμές επανυπολογισμού</dt>
                <dd>{comparison.summary.unmatchedRecalcRowCount}</dd>
              </div>
              <div className="lap-result-row">
                <dt>Συνολική οικονομική διαφορά</dt>
                <dd>{signedMoneyOrNotFinalized(comparison.summary.totalEconomicDifferenceCents)}</dd>
              </div>
              <div className="lap-result-row">
                <dt>Συνολική διαφορά τόκων</dt>
                <dd>{signedMoneyOrNotFinalized(comparison.summary.totalInterestDifferenceCents)}</dd>
              </div>
              <div className="lap-result-row">
                <dt>Συνολική διαφορά κεφαλαίου</dt>
                <dd>{signedMoneyOrNotFinalized(comparison.summary.totalPrincipalDifferenceCents)}</dd>
              </div>
            </dl>
          ) : (
            <p className="lap-result-status">{NOT_FINALIZED}</p>
          )}

          <p className="lap-sign-convention">{SIGN_CONVENTION}</p>

          {comparison.rows.length === 0 ? (
            <p className="lap-empty-state">Δεν υπάρχουν αναλυτικές γραμμές σύγκρισης.</p>
          ) : (
            <>
              <table className="lap-table lap-comparison-table">
                <thead>
                  <tr>
                    <th>Περίοδος / Γραμμή</th>
                    <th>Ημερομηνία</th>
                    <th>Δόση Τράπεζας/Fund</th>
                    <th>Δόση Επανυπολογισμού</th>
                    <th>Οικονομική Διαφορά</th>
                    <th>Τόκος Τράπεζας/Fund</th>
                    <th>Τόκος Επανυπολογισμού</th>
                    <th>Διαφορά Τόκου</th>
                    <th>Κατάσταση</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.slice(0, ROW_PREVIEW_LIMIT).map((row: ComparisonRow) => {
                    const bankInt = centsOf(row.bankInterest);
                    const recalcInt = centsOf(row.recalculatedInterest);
                    // display-only interest difference: shown solely when both
                    // already-computed sides exist; never invents a value.
                    const interestDiff = bankInt !== null && recalcInt !== null ? bankInt - recalcInt : null;
                    return (
                      <tr key={row.period}>
                        <td>{row.period}</td>
                        <td>{row.dueDate}</td>
                        <td>{signedCellOrNotFinalized(centsOf(row.bankInstallment))}</td>
                        <td>{signedCellOrNotFinalized(centsOf(row.recalculatedInstallment))}</td>
                        <td>{signedCellOrNotFinalized(centsOf(row.economicDifference))}</td>
                        <td>{signedCellOrNotFinalized(bankInt)}</td>
                        <td>{signedCellOrNotFinalized(recalcInt)}</td>
                        <td>{signedCellOrNotFinalized(interestDiff)}</td>
                        <td>{row.findingLevel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {comparison.rows.length > ROW_PREVIEW_LIMIT ? (
                <p className="lap-report-preview__note">
                  Εμφανίζονται οι πρώτες 100 γραμμές. Το πλήρες αποτέλεσμα περιλαμβάνεται στη μελέτη/PDF.
                </p>
              ) : null}
            </>
          )}
        </>
      )}

      <h3 className="lap-card__subtitle">Πραγματικές Καταβολές — Παράλληλη Απομείωση</h3>
      <p className="lap-card__explanation">
        Παράλληλος υπολογισμός βάσει των πραγματικών ημερομηνιών και ποσών καταβολής (όχι του
        θεωρητικού δοσολογίου). Ο καταλογισμός κάθε καταβολής γίνεται πρώτα σε ανεξόφλητο τόκο
        (ΑΚ 423) και μόνο το υπόλοιπο μειώνει το κεφάλαιο.
      </p>
      {actualPaymentsAmortization === null ? (
        <p className="lap-empty-state">
          Δεν υπάρχει διαθέσιμος υπολογισμός — εκτελέστε τη μελέτη με τουλάχιστον μία
          καταχωρισμένη πραγματική καταβολή.
        </p>
      ) : (
        <>
          <p className="lap-result-status">Κατάσταση: {actualPaymentsAmortization.status}</p>
          <dl className="lap-result-grid">
            <div className="lap-result-row">
              <dt>Σύνολο τόκου υπερημερίας</dt>
              <dd>{signedMoneyOrNotFinalized(actualPaymentsAmortization.totalLateInterestCents)}</dd>
            </div>
            <div className="lap-result-row">
              <dt>Ανεξόφλητος τόκος (τρέχον υπόλοιπο)</dt>
              <dd>{signedMoneyOrNotFinalized(actualPaymentsAmortization.finalUnpaidInterestCents)}</dd>
            </div>
            <div className="lap-result-row">
              <dt>Πραγματικό υπόλοιπο κεφαλαίου</dt>
              <dd>{signedMoneyOrNotFinalized(actualPaymentsAmortization.finalActualBalanceCents)}</dd>
            </div>
          </dl>

          {actualPaymentsAmortization.rows.length === 0 ? (
            <p className="lap-empty-state">Δεν υπάρχουν αναλυτικές γραμμές.</p>
          ) : (
            <table className="lap-table lap-actual-amortization-table">
              <thead>
                <tr>
                  <th>Γραμμή</th>
                  <th>Ημερομηνία λήξης</th>
                  <th>Δόση</th>
                  <th>Καταβλήθηκε</th>
                  <th>Τελ. καταβολή</th>
                  <th>Τόκος υπερημερίας</th>
                  <th>Ημέρες</th>
                  <th>Σε τόκους</th>
                  <th>Σε κεφάλαιο</th>
                  <th>Ανεξόφλητος τόκος (μεταφ.)</th>
                  <th>Πραγματικό υπόλοιπο</th>
                  <th>Κατάσταση</th>
                </tr>
              </thead>
              <tbody>
                {actualPaymentsAmortization.rows.slice(0, ROW_PREVIEW_LIMIT).map((row: ActualAmortizationRow) => (
                  <tr key={row.rowId}>
                    <td>{row.rowId}</td>
                    <td>{isoToGreekDate(row.dueDate)}</td>
                    <td>{signedCellOrNotFinalized(row.installmentCents)}</td>
                    <td>{signedCellOrNotFinalized(row.paidCents)}</td>
                    <td>{row.lastPaymentDate ? isoToGreekDate(row.lastPaymentDate) : '—'}</td>
                    <td>{signedCellOrNotFinalized(row.defaultInterestAccruedCents)}</td>
                    <td>{row.defaultInterestDays ?? '—'}</td>
                    <td>{signedCellOrNotFinalized(row.appliedToInterestCents)}</td>
                    <td>{signedCellOrNotFinalized(row.appliedToPrincipalCents)}</td>
                    <td>{signedCellOrNotFinalized(row.unpaidInterestCarryForwardCents)}</td>
                    <td>{signedCellOrNotFinalized(row.actualClosingBalanceCents)}</td>
                    <td>{ACTUAL_STATUS_LABEL[row.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {actualPaymentsAmortization.rows.length > ROW_PREVIEW_LIMIT ? (
            <p className="lap-report-preview__note">
              Εμφανίζονται οι πρώτες 100 γραμμές. Το πλήρες αποτέλεσμα περιλαμβάνεται στη μελέτη.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
};
