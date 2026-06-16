/**
 * Loan Audit PRO — src/ui-state/reconciliationFindingsAdapter.ts
 * ------------------------------------------------------------------
 * Presentation-only adapter. The locked findings engine
 * (src/engines/findingsEngine.ts) only ever compares Τράπεζα/Fund vs
 * Επανυπολογισμός — it has no knowledge of actual payments. This
 * module reads the ALREADY-COMPUTED payment reconciliation result
 * (src/engines/paymentReconciliationEngine.ts) and maps it into the
 * same TechnicalFinding shape used everywhere else (Ευρήματα tab and
 * the PDF), so a user who entered actual payments sees deviations
 * against those payments too — without recomputing or altering any
 * financial figure, and without changing the locked findings engine.
 *
 * IDs use the RC- prefix (RC-001, RC-002, …) so they are visually and
 * programmatically distinct from the locked engine's F-00N findings.
 */
import type { PaymentReconciliationResult, PaymentReconciliationRow } from '../engines/paymentReconciliationEngine';
import type { TechnicalFinding, TechnicalFindingLevel } from '../engines/findingsEngine';
import { formatMoneyGreek, moneyFromCents, type CurrencyCode } from '../domain/money';

const MATERIALITY_THRESHOLD_CENTS = 1;

function fmt(cents: number, currency: CurrencyCode): string {
  return formatMoneyGreek(moneyFromCents(cents, currency));
}

function signExplanation(totalCents: number): string {
  if (totalCents > 0) {
    return 'θετική οικονομική διαφορά: η πραγματική καταβολή είναι υψηλότερη από τη δόση δοσολογίου';
  }
  if (totalCents < 0) {
    return 'αρνητική οικονομική διαφορά: η πραγματική καταβολή είναι χαμηλότερη από τη δόση δοσολογίου';
  }
  return 'μηδενική οικονομική διαφορά';
}

/**
 * Builds additional findings from a payment reconciliation result.
 * Returns an empty array when there is nothing to report (no result,
 * no summary, or no rows) — callers simply append the result to the
 * existing findings list.
 */
export function buildReconciliationFindings(
  reconciliation: PaymentReconciliationResult | null,
  currency: CurrencyCode = 'EUR',
): readonly TechnicalFinding[] {
  if (reconciliation === null || reconciliation.summary === null) return [];
  const { summary, rows } = reconciliation;
  const findings: TechnicalFinding[] = [];
  let seq = 0;
  const nextId = (): string => {
    seq += 1;
    return `RC-${String(seq).padStart(3, '0')}`;
  };

  const deviatingRows: PaymentReconciliationRow[] = rows.filter(
    (r) =>
      r.differenceVsRecalculatedCents !== null &&
      Math.abs(r.differenceVsRecalculatedCents) >= MATERIALITY_THRESHOLD_CENTS,
  );

  if (deviatingRows.length > 0) {
    const totalCents = deviatingRows.reduce(
      (sum, r) => sum + (r.differenceVsRecalculatedCents ?? 0),
      0,
    );
    const level: TechnicalFindingLevel =
      deviatingRows.some((r) => r.status === 'requires_review') ? 'requires_review' : 'deviation';
    findings.push({
      findingId: nextId(),
      level,
      title: 'Οικονομική απόκλιση πραγματικής καταβολής',
      description:
        `Τεχνικό οικονομικό εύρημα: σε ${deviatingRows.length} περιόδους εντοπίστηκε απόκλιση ` +
        `μεταξύ πραγματικής καταβολής και δόσης δοσολογίου άνω του κατωφλίου σημαντικότητας, με ` +
        `συνολικό υπογεγραμμένο μέγεθος ${fmt(totalCents, currency)} βάσει διαθέσιμων δεδομένων ` +
        `(${signExplanation(totalCents)}). Απαιτείται έλεγχος.`,
      affectedRowIds: deviatingRows.map((r) => r.rowId),
      affectedPeriods: deviatingRows.map((r) => r.dueDate ?? r.rowId),
      amountCents: totalCents,
      count: deviatingRows.length,
      source: 'audit',
      reportSafe: true,
    });
  }

  if (summary.unmatchedPaymentCount > 0) {
    const unmatched = rows.filter((r) => r.status === 'unmatched_payment');
    findings.push({
      findingId: nextId(),
      level: 'missing_data',
      title: 'Μη αντιστοιχισμένες πραγματικές καταβολές',
      description:
        `Ελλιπή δεδομένα αντιστοίχισης: ${summary.unmatchedPaymentCount} πραγματική(ές) ` +
        `καταβολή(ές) χωρίς αντίστοιχη γραμμή δοσολογίου.`,
      affectedRowIds: unmatched.map((r) => r.paymentId ?? r.rowId),
      affectedPeriods: [],
      amountCents: 0,
      count: summary.unmatchedPaymentCount,
      source: 'audit',
      reportSafe: true,
    });
  }

  findings.push({
    findingId: nextId(),
    level: 'info',
    title: 'Σύνοψη συμφωνίας πραγματικών καταβολών',
    description:
      `Συμφωνία πραγματικών καταβολών έναντι δοσολογίου βάσει διαθέσιμων δεδομένων: ` +
      `${summary.matchedPaymentCount + summary.unmatchedPaymentCount} καταχωρισμένες καταβολές, ` +
      `${summary.matchedPaymentCount} αντιστοιχισμένες, ${summary.unmatchedPaymentCount} χωρίς ` +
      `αντιστοίχιση` +
      (summary.totalDifferenceVsRecalculatedCents !== null
        ? `. Συνολική οικονομική διαφορά ${fmt(summary.totalDifferenceVsRecalculatedCents, currency)} ` +
          `(${signExplanation(summary.totalDifferenceVsRecalculatedCents)})`
        : '') +
      '.',
    affectedRowIds: [],
    affectedPeriods: [],
    amountCents: summary.totalDifferenceVsRecalculatedCents,
    count: summary.matchedPaymentCount + summary.unmatchedPaymentCount,
    source: 'audit',
    reportSafe: true,
  });

  return findings;
}
