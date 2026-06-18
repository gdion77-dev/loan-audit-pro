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
import type { ActualPaymentsAmortizationResult } from '../engines/actualPaymentsAmortizationEngine';
import { getReportTemplateHtml } from '../report-template/reportTemplate';
import { buildReconciliationFindings } from './reconciliationFindingsAdapter';

const ACTUAL_STATUS_LABEL: Record<string, string> = {
  settled_on_time: 'Εξοφλήθηκε εμπρόθεσμα',
  settled_late: 'Εξοφλήθηκε εκπρόθεσμα',
  partially_settled: 'Μερική εξόφληση',
  unsettled: 'Ανεξόφλητη',
  requires_review: 'Απαιτείται έλεγχος',
};

/**
 * Maps the actual-payments amortization result (cents) into the
 * template's `actualAmortization` shape (euro values). Presentation
 * only — no recomputation. Returns null when there is nothing to show.
 */
function buildActualAmortizationData(
  amort: ActualPaymentsAmortizationResult | null | undefined,
): Record<string, unknown> | null {
  if (!amort || amort.rows.length === 0) return null;
  return {
    totalLateInterest: amort.totalLateInterestCents === null ? null : eur(amort.totalLateInterestCents),
    finalUnpaidInterest: eur(amort.finalUnpaidInterestCents),
    finalOverduePrincipal: eur(amort.finalOverduePrincipalCents),
    finalActualBalance: amort.finalActualBalanceCents === null ? null : eur(amort.finalActualBalanceCents),
    rows: amort.rows.map((r) => ({
      date: isoToGreek(r.dueDate),
      installment: eur(r.installmentCents),
      paid: eur(r.paidCents),
      defaultInterest: r.defaultInterestAccruedCents === null ? null : eur(r.defaultInterestAccruedCents),
      toInterest: eur(r.appliedToInterestCents),
      toPrincipal: eur(r.appliedToPrincipalCents),
      overduePrincipal: eur(r.overduePrincipalCents),
      unpaidInterest: eur(r.unpaidInterestCarryForwardCents),
      balance: eur(r.actualClosingBalanceCents),
      status: r.status,
      statusLabel: ACTUAL_STATUS_LABEL[r.status] ?? r.status,
    })),
  };
}

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
 * Plain-language explanations for findings, keyed by the engine's stable
 * finding title. The engine text (legally precise but technical) is kept
 * as a secondary line; this gives a non-expert reader a clear summary.
 * Unknown titles fall back to the technical text only.
 */
const FINDING_PLAIN: Record<string, { title: string; text: (count: number, amount: string) => string }> = {
  'Καμία απόκλιση άνω κατωφλίου': {
    title: 'Δεν βρέθηκε σημαντική διαφορά',
    text: () =>
      'Συγκρίνοντας το δοσολόγιο που υπολόγισε η εφαρμογή με τα στοιχεία της τράπεζας, δεν προέκυψε διαφορά που να ξεπερνά το όριο σημαντικότητας.',
  },
  'Σύνοψη σύγκρισης με τραπεζικά δεδομένα': {
    title: 'Σύγκριση με τα στοιχεία της τράπεζας',
    text: (count) =>
      `Ελέγχθηκαν ${count} περίοδοι του δανείου. Η σύγκριση του υπολογισμού της εφαρμογής με τα στοιχεία της τράπεζας δεν εμφάνισε διαφορά.`,
  },
  'Οικονομική απόκλιση πραγματικής καταβολής': {
    title: 'Διαφορές στις πραγματικές καταβολές',
    text: (count, amount) =>
      `Σε ${count} περιόδους, το ποσό που πληρώθηκε διαφέρει από την κανονική δόση. Συνολική διαφορά: ${amount}. Αρνητικό ποσό σημαίνει ότι πληρώθηκε λιγότερο από την κανονική δόση. Καλό είναι να ελεγχθεί.`,
  },
  'Σύνοψη συμφωνίας πραγματικών καταβολών': {
    title: 'Σύνοψη πραγματικών καταβολών',
    text: (count, amount) =>
      `Καταχωρίστηκαν ${count} πραγματικές καταβολές. Η συνολική διαφορά τους από τις κανονικές δόσεις είναι ${amount} (αρνητικό = πληρώθηκε λιγότερο).`,
  },
  'Μη αντιστοιχισμένες πραγματικές καταβολές': {
    title: 'Καταβολές χωρίς αντιστοίχιση',
    text: (count) =>
      `${count} πραγματικές καταβολές δεν μπόρεσαν να αντιστοιχιστούν σε συγκεκριμένη δόση. Χρειάζεται έλεγχος.`,
  },
  'Μη οριστικοποιήσιμα ευρήματα σύγκρισης': {
    title: 'Η σύγκριση δεν ολοκληρώθηκε',
    text: () =>
      'Η σύγκριση με τα στοιχεία της τράπεζας δεν μπόρεσε να ολοκληρωθεί λόγω ελλιπών δεδομένων. Δεν υπολογίστηκαν ποσά με υποθέσεις.',
  },
};

function plainFinding(
  title: string,
  count: number,
  amount: string,
): { title: string; text: string } | null {
  const m = FINDING_PLAIN[title];
  if (!m) return null;
  return { title: m.title, text: m.text(count, amount) };
}

export interface HtmlReportResult {
  readonly status: 'ok' | 'no_data';
  readonly html: string;
  readonly message: string;
}

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
  actualPaymentsAmortization?: ActualPaymentsAmortizationResult | null,
  rateLabel?: string,
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
    rateLabel: rateLabel ?? null,
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

    actualPaymentsNote: buildActualPaymentsNote(pipelineResult),
    findings: findings.map((f) => {
      const amountStr =
        f.amountCents === null ? '—' : `${eur(f.amountCents).toFixed(2).replace('.', ',')} €`;
      const plain = plainFinding(f.title, f.count ?? 0, amountStr);
      return {
        code: f.findingId,
        severity: SEVERITY_LABEL[f.level] ?? f.level,
        title: plain ? plain.title : f.title,
        text: plain ? plain.text : f.description,
        technicalTitle: f.title,
        technicalText: f.description,
        magnitude: eur(f.amountCents),
      };
    }),

    missingData:
      summary.excludedRowCount === 0
        ? `Δεν καταγράφηκαν ελλείποντα δεδομένα στο σύνολο των ${summary.comparedRowCount} συγκρινόμενων περιόδων.`
        : `Καταγράφηκαν ${summary.excludedRowCount} περίοδοι με ελλείποντα δεδομένα από τις ${summary.comparedRowCount} συγκρινόμενες.`,
    limitations:
      'Τεχνικός οικονομικός επανυπολογισμός και σύγκριση με τραπεζικά δεδομένα βάσει διαθέσιμων δεδομένων· δεν αποτελεί νομική κρίση ούτε γνωμοδότηση.',
    disclaimer:
      'Η παρούσα αποτελεί τεχνική οικονομική αποτύπωση βάσει των διαθέσιμων δεδομένων και δεν αποτελεί νομική κρίση ούτε γνωμοδότηση νομικού περιεχομένου.',
    amortization: amortization.length > 0 ? amortization : null,
    actualAmortization: buildActualAmortizationData(actualPaymentsAmortization),
  };
}

export function buildHtmlReport(
  pipelineResult: LoanAuditPipelineResult | null,
  actualPaymentsAmortization?: ActualPaymentsAmortizationResult | null,
  rateLabel?: string,
): HtmlReportResult {
  if (pipelineResult === null) {
    return { status: 'no_data', html: '', message: 'Δεν υπάρχουν διαθέσιμα δεδομένα μελέτης.' };
  }
  const data = buildReportData(pipelineResult, actualPaymentsAmortization, rateLabel);
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

export function openHtmlReport(
  pipelineResult: LoanAuditPipelineResult | null,
  actualPaymentsAmortization?: ActualPaymentsAmortizationResult | null,
  rateLabel?: string,
): boolean {
  const built = buildHtmlReport(pipelineResult, actualPaymentsAmortization, rateLabel);
  if (built.status !== 'ok') return false;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const win = window.open('', '_blank');
  if (win === null) return false;
  win.document.open();
  win.document.write(built.html);
  win.document.close();
  return true;
}
