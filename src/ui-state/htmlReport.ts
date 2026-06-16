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

export interface HtmlReportResult {
  readonly status: 'ok' | 'no_data';
  readonly html: string;
  readonly message: string;
}

function buildReportData(
  pipelineResult: LoanAuditPipelineResult,
): Record<string, unknown> | null {
  const caseInfo = pipelineResult.reportModelResult?.reportModel?.caseInfo ?? null;
  const summary = pipelineResult.comparisonResult?.summary ?? null;
  if (caseInfo === null || summary === null) return null;

  const findings = pipelineResult.findingsResult?.findings ?? [];
  const recalcRows = pipelineResult.recalcScheduleResult?.rows ?? [];

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
    annualRatePct: '',
    months: caseInfo.termMonths,
    dayCount: '',

    comparedPeriods: summary.comparedRowCount,
    missingPeriods: summary.excludedRowCount,
    deviationPeriods: summary.rowsRequiringReviewCount,
    interestDiff: eur(summary.totalInterestDifferenceCents),
    capitalDiff: eur(summary.totalPrincipalDifferenceCents),

    bankRows: summary.comparedRowCount + summary.unmatchedBankRowCount,
    bankUnmatched: summary.unmatchedBankRowCount,
    bankMissing: summary.excludedRowCount,
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

    actualPaymentsNote: 'Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα',
    findings: findings.map((f) => ({
      code: f.findingId,
      severity: SEVERITY_LABEL[f.level] ?? f.level,
      title: f.title,
      text: f.description,
      magnitude: eur(f.amountCents),
    })),

    missingData:
      summary.excludedRowCount === 0
        ? `Δεν καταγράφηκαν ελλείποντα δεδομένα στο σύνολο των ${summary.comparedRowCount} συγκρινόμενων περιόδων.`
        : `Καταγράφηκαν ${summary.excludedRowCount} περίοδοι με ελλείποντα δεδομένα από τις ${summary.comparedRowCount} συγκρινόμενες.`,
    limitations:
      'Τεχνικός οικονομικός επανυπολογισμός και σύγκριση με τραπεζικά δεδομένα βάσει διαθέσιμων δεδομένων· δεν αποτελεί νομική κρίση ούτε γνωμοδότηση.',
    disclaimer:
      'Η παρούσα αποτελεί τεχνική οικονομική αποτύπωση βάσει των διαθέσιμων δεδομένων και δεν αποτελεί νομική κρίση ούτε γνωμοδότηση νομικού περιεχομένου.',
    amortization: amortization.length > 0 ? amortization : null,
  };
}

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
  const injection = `<script>window.REPORT_DATA = ${JSON.stringify(data)};</script>`;
  const html = template.replace('<!--REPORT_DATA_INJECTION-->', injection);

  return { status: 'ok', html, message: 'Η αναφορά δημιουργήθηκε.' };
}

export function openHtmlReport(pipelineResult: LoanAuditPipelineResult | null): boolean {
  const built = buildHtmlReport(pipelineResult);
  if (built.status !== 'ok') return false;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const win = window.open('', '_blank');
  if (win === null) return false;
  win.document.open();
  win.document.write(built.html);
  win.document.close();
  return true;
}
