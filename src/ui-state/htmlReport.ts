/**
 * Loan Audit PRO — src/ui-state/htmlReport.ts
 * ------------------------------------------------------------------
 * Builds the PROFESSIONAL client report by injecting real pipeline data
 * into the approved design template (variant B, "Modern"). It reads
 * already-computed figures (case info, comparison summary, findings,
 * recalculated schedule) and maps them to the template's REPORT_DATA
 * schema. It RECOMPUTES NOTHING and changes no financial figure —
 * presentation only. Neutral wording preserved.
 *
 * The HTML opens in a new tab; the user prints it to PDF.
 */
import type { LoanAuditPipelineResult } from '../engines/loanAuditPipelineRunner';
import { getReportTemplateHtml } from '../report-template/reportTemplate';
import { buildReconciliationFindings } from './reconciliationFindingsAdapter';

function eur(cents: number | null): number {
  return cents === null ? 0 : cents / 100;
}

function isoToGreek(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

const SEVERITY_LABEL: Record<string, string> = {
  informational: 'ΠΛΗΡΟΦΟΡΙΑΚΟ',
  requires_review: 'ΑΠΑΙΤΕΙΤΑΙ ΕΛΕΓΧΟΣ',
  attention: 'ΠΡΟΣΟΧΗ',
};

/**
 * Summarize the (optional) payment reconciliation result for the report.
 * Reads already-computed figures only — no recalculation, no new
 * financial logic. Falls back to the original neutral note when no
 * actual payments were entered, so the report behaves exactly as
 * before for cases without manual payment data.
 */
function buildActualPaymentsNote(pipelineResult: LoanAuditPipelineResult): string {
  const rec = pipelineResult.paymentReconciliationResult;
  if (rec === null || rec.summary === null) {
    return 'Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα';
  }
  const s = rec.summary;
  const paidCount = s.matchedPaymentCount + s.unmatchedPaymentCount;
  const parts: string[] = [`${paidCount} καταχωρισμένες καταβολές`];
  if (s.totalActualPaidCents !== null) {
    parts.push(`σύνολο ${eur(s.totalActualPaidCents).toFixed(2).replace('.', ',')} €`);
  }
  if (s.totalDifferenceVsRecalculatedCents !== null) {
    parts.push(
      `διαφορά έναντι επανυπολογισμού ${eur(s.totalDifferenceVsRecalculatedCents).toFixed(2).replace('.', ',')} €`,
    );
  }
  if (s.unmatchedPaymentCount > 0) {
    parts.push(`${s.unmatchedPaymentCount} χωρίς αντιστοίχιση`);
  }
  return parts.join(' · ');
}

function buildReportData(
  pipelineResult: LoanAuditPipelineResult,
): Record<string, unknown> | null {
  const caseInfo = pipelineResult.reportModelResult?.reportModel?.caseInfo ?? null;
  const summary = pipelineResult.comparisonResult?.summary ?? null;
  if (caseInfo === null || summary === null) return null;

  const findings = [
    ...(pipelineResult.findingsResult?.findings ?? []),
    ...buildReconciliationFindings(pipelineResult.paymentReconciliationResult),
  ];
  const recalcRows = pipelineResult.recalcScheduleResult?.rows ?? [];
  // The applied annual rate is real engine output (per recalculated row),
  // not a re-derivation — every row in a fixed-rate schedule carries the
  // same value, so the first row is representative.
  const firstRow = recalcRows[0];
  const annualRatePct = firstRow ? firstRow.appliedAnnualRatePercent : null;

  const amortization = recalcRows.map((r, i) => ({
    month: i + 1,
    date: r.dueDate ? isoToGreek(r.dueDate) : '',
    balance: eur(r.closingBalance?.cents ?? null),
    interest: eur(r.interest?.cents ?? null),
    principal: eur(r.principal?.cents ?? null),
  }));

  return {
    caseNumber: caseInfo.caseId,
    preparedDate: isoToGreek(new Date().toISOString().slice(0, 10)),
    debtor: caseInfo.debtorName,
    bank: caseInfo.institution,
    contractNumber: caseInfo.contractNumber,
    principal: eur(caseInfo.principal?.cents ?? null),
    annualRatePct: annualRatePct ?? '',
    months: caseInfo.termMonths,
    dayCount: '',

    comparedPeriods: summary.comparedRowCount,
    missingPeriods: summary.excludedRowCount,
    deviationPeriods: summary.rowsRequiringReviewCount,
    interestDiff: eur(summary.totalInterestDifferenceCents),
    principalDiff: eur(summary.totalPrincipalDifferenceCents),

    bankRows: summary.comparedRowCount + summary.unmatchedBankRowCount,
    bankUnmatched: summary.unmatchedBankRowCount,
    bankExcluded: summary.excludedRowCount,
    bankTotal: eur(summary.totalBankInstallmentsCents),
    recalcRows: summary.comparedRowCount + summary.unmatchedRecalcRowCount,
    recalcUnmatched: summary.unmatchedRecalcRowCount,
    recalcProgram: 'Σταθερή δόση',
    recalcTotal: eur(summary.totalRecalculatedInstallmentsCents),
    totalDiff: eur(summary.totalEconomicDifferenceCents),

    methodology: {
      programType: 'Σταθερή τοκοχρεολυτική δόση',
      accrual: 'Επί ανεξόφλητου υπολοίπου',
      rate: 'Βάσει δηλωμένων όρων',
      dayCount: '',
      law12875: 'Βάσει δηλωμένων όρων',
      rounding: 'half-up',
    },

    actualPaymentsNote: buildActualPaymentsNote(pipelineResult),
    findings: findings.map((f) => ({
      code: f.findingId,
      severity: SEVERITY_LABEL[f.level] ?? f.level,
      title: f.title,
      text: f.description,
      magnitude: eur(f.amountCents),
    })),

    missingData:
      pipelineResult.findingsResult?.findings.some((f) => f.level === 'missing_data')
        ? 'Εντοπίστηκαν περιπτώσεις με ελλιπή δεδομένα στις συγκρινόμενες περιόδους.'
        : `Δεν καταγράφηκαν ελλείποντα δεδομένα στο σύνολο των ${summary.comparedRowCount} συγκρινόμενων περιόδων.`,
    limitations:
      'Τεχνικός οικονομικός επανυπολογισμός και σύγκριση με τραπεζικά δεδομένα βάσει διαθέσιμων δεδομένων· δεν αποτελεί νομική κρίση ούτε γνωμοδότηση.',
    disclaimer:
      'Η παρούσα αποτελεί τεχνική οικονομική αποτύπωση βάσει των διαθέσιμων δεδομένων και δεν αποτελεί νομική κρίση ούτε γνωμοδότηση νομικού περιεχομένου.',

    amortization,
  };
}

export interface HtmlReportResult {
  readonly status: 'ok' | 'no_data';
  readonly html: string;
  readonly message?: string;
}

/**
 * Builds the full standalone HTML report (head, styles, script and
 * injected REPORT_DATA) ready to open in a new tab or save as a file.
 */
export function buildHtmlReport(
  pipelineResult: LoanAuditPipelineResult | null,
): HtmlReportResult {
  if (pipelineResult === null) {
    return { status: 'no_data', html: '', message: 'Δεν υπάρχουν διαθέσιμα δεδομένα μελέτης.' };
  }
  const data = buildReportData(pipelineResult);
  if (data === null) {
    return {
      status: 'no_data',
      html: '',
      message: 'Δεν υπάρχουν διαθέσιμα δεδομένα μελέτης. Εκτελέστε πρώτα τη μελέτη.',
    };
  }

  const template = getReportTemplateHtml();
  const json = JSON.stringify(data);
  const injection = `<script>window.REPORT_DATA = ${json};</script>`;
  const html = template.replace('<!--REPORT_DATA_INJECTION-->', injection);
  return { status: 'ok', html };
}

/**
 * Opens the professional report in a new browser tab so the user can
 * print it to PDF. Returns false (and does nothing) when there is no
 * data to render.
 */
export function openHtmlReport(pipelineResult: LoanAuditPipelineResult | null): boolean {
  const result = buildHtmlReport(pipelineResult);
  if (result.status !== 'ok') return false;
  const win = window.open('', '_blank');
  if (win === null) return false;
  win.document.open();
  win.document.write(result.html);
  win.document.close();
  return true;
}
