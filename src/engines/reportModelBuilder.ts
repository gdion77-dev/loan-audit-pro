/**
 * Loan Audit PRO — src/engines/reportModelBuilder.ts
 * ------------------------------------------------------------------
 * Step 7-A: ReportModel Builder ONLY.
 *
 * Assembles the EXISTING Step 1-A ReportModel («ΤΕΧΝΙΚΗ ΟΙΚΟΝΟΜΙΚΗ
 * ΜΕΛΕΤΗ ΕΛΕΓΧΟΥ ΔΑΝΕΙΟΥ») from:
 *   - CaseInfo,
 *   - the locked ScheduleComparisonResult (Step 6-A),
 *   - the locked FindingsResult (Step 6-B),
 *   - methodology metadata and optional notes/preparer info.
 *
 * Pure data preparation: NO PDF, NO markup rendering, NO components,
 * NO schedule generation, NO re-comparison, NO findings
 * regeneration. Numbers are copied from the upstream results — never
 * recomputed, never inferred; null totals stay null and become
 * stated limitations. The locked sign convention
 * (bank/fund − recalculated) passes through untouched.
 *
 * Wording safety: every user-supplied or generated free text passes
 * the Step 1-A forbidden-terms guard EXTENDED with the Step 6-B
 * list. Offending text is replaced with a neutral placeholder, an
 * audit warning is recorded and the status becomes requires_review;
 * the final model additionally passes through the Step 1-A
 * createReportModel guard as a last net.
 *
 * Scope guards: independent of Ν.3869/2010 and ΑΠ 6/2026.
 *
 * Step 9-B: optionally integrates an ALREADY-COMPUTED
 * PaymentReconciliationResult. Its numbers are copied, never
 * recomputed (reconcileActualPayments is NOT called here). Note the
 * reconciliation sign convention is DISTINCT from the schedule
 * comparison one:
 *   reconciliation: differenceVsBank = actualPaid − bankDue,
 *                   differenceVsRecalculated = actualPaid − recalcDue
 *   comparison:     economicDifference = bank/fund − recalculated
 * The two never mix. totalActualPaidDifference in the ReportModel is
 * populated from the reconciliation's totalDifferenceVsRecalculated
 * (preferred) and stays null when not finalizable.
 */

import type { ISODateTime } from '../domain/dateTypes';
import type { CurrencyCode } from '../domain/money';
import { moneyFromCents, formatMoneyGreek, type NullableMoney } from '../domain/money';
import type { CaseInfo } from '../domain/loanTypes';
import type { FindingLevel } from '../domain/comparisonTypes';
import {
  createReportModel,
  ReportWordingError,
  type ReportModel,
  type Finding,
  type MissingDataItem,
  type ComparisonSummary,
} from '../domain/reportTypes';
import { type AuditEntry } from '../domain/auditTypes';
import { warning, requiresReview } from '../domain/auditFactories';
import { validateCaseInfo } from '../domain/validators';
import { VALIDATION_AUDIT_CODES as C } from '../domain/auditFactories';
import type { ScheduleComparisonResult } from './scheduleComparisonEngine';
import type { PaymentReconciliationResult } from './paymentReconciliationEngine';
import {
  findForbiddenFindingTerms,
  FINDINGS_AUDIT_CODES as FC,
  type FindingsResult,
  type TechnicalFinding,
} from './findingsEngine';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this builder                                */
/* ------------------------------------------------------------------ */

export const REPORT_BUILDER_AUDIT_CODES = {
  REPORT_INPUT_MISSING: 'REPORT_INPUT_MISSING',
  REPORT_TEXT_NOT_NEUTRAL: 'REPORT_TEXT_NOT_NEUTRAL',
  REPORT_GUARD_REJECTED: 'REPORT_GUARD_REJECTED',
  /** Reused from Step 6-B for non-report-safe findings. */
  FINDING_NOT_REPORT_SAFE: FC.FINDING_NOT_REPORT_SAFE,
} as const;

const RC = REPORT_BUILDER_AUDIT_CODES;

export const REPORT_TITLE = 'Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου';

const NEUTRAL_PLACEHOLDER =
  'Το κείμενο εξαιρέθηκε από τη μελέτη λόγω μη ουδέτερης διατύπωσης· απαιτείται έλεγχος.';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ReportBuilderStatus = 'success' | 'requires_review' | 'missing_data';

export interface ReportMethodologyInput {
  readonly scheduleType: string;
  readonly rateDescription: string;
  readonly dayCountConvention: string;
  readonly law128Status: string;
  readonly negativeIndexPolicy: string;
  readonly roundingPolicy: string;
  readonly dataCoverageNote: string;
}

export interface ReportPreparerInput {
  readonly name: string;
  readonly professionalTitle: string;
  readonly officeName: string;
  readonly contact: string;
}

export interface ReportModelBuilderInput {
  readonly caseInfo: CaseInfo;
  readonly comparisonResult: ScheduleComparisonResult;
  readonly findingsResult: FindingsResult;
  readonly methodology: ReportMethodologyInput;
  readonly generatedAt?: ISODateTime;
  readonly preparedBy?: ReportPreparerInput;
  readonly additionalNotes?: readonly string[];
  readonly currency?: CurrencyCode;
  /**
   * Step 9-B: optional, ALREADY-COMPUTED reconciliation result.
   * When absent, behaviour is identical to Step 7-A and
   * totalActualPaidDifference stays null.
   */
  readonly paymentReconciliationResult?: PaymentReconciliationResult;
}

export interface ReportModelBuilderResult {
  readonly status: ReportBuilderStatus;
  readonly reportModel: ReportModel | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function buildLoanAuditReportModel(
  input: ReportModelBuilderInput,
): ReportModelBuilderResult {
  const currency: CurrencyCode = input.currency ?? 'EUR';
  const recon = input.paymentReconciliationResult;
  const auditEntries: AuditEntry[] = [
    ...input.comparisonResult.auditEntries,
    ...input.findingsResult.auditEntries,
    ...(recon ? recon.auditEntries : []),
  ];
  let wordingViolations = false;

  /** Money with explicit sign for difference amounts; null → phrase. */
  const signedText = (cents: number | null): string => {
    if (cents === null) return 'Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα';
    const text = formatMoneyGreek(moneyFromCents(cents, currency));
    return cents > 0 ? `+${text}` : text;
  };
  const plainText = (cents: number | null): string =>
    cents === null
      ? 'Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα'
      : formatMoneyGreek(moneyFromCents(cents, currency));

  /** Screen a free-text value; replace if non-neutral. */
  const screen = (location: string, text: string): string => {
    const terms = findForbiddenFindingTerms(text);
    if (terms.length === 0) return text;
    wordingViolations = true;
    auditEntries.push(
      warning(
        RC.REPORT_TEXT_NOT_NEUTRAL,
        `Μη ουδέτερη διατύπωση στο πεδίο «${location}»· το κείμενο αντικαταστάθηκε από ουδέτερη σήμανση και απαιτείται έλεγχος.`,
        { location, terms },
      ),
    );
    return NEUTRAL_PLACEHOLDER;
  };

  /* --- critical case data ------------------------------------------- */
  const caseEntries = validateCaseInfo(input.caseInfo);
  auditEntries.push(...caseEntries);
  const caseBlocking = caseEntries.some((e) =>
    [
      C.CASE_PRINCIPAL_MISSING,
      C.CASE_START_DATE_MISSING,
      C.CASE_TERM_OR_END_DATE_MISSING,
    ].includes(e.code as never),
  );
  if (caseBlocking) {
    auditEntries.push(
      requiresReview(RC.REPORT_INPUT_MISSING, 'Ελλιπή δεδομένα υπόθεσης: η μελέτη δεν μπορεί να συνταχθεί με ασφάλεια χωρίς τα κρίσιμα στοιχεία της υπόθεσης.'),
    );
    return { status: 'missing_data', reportModel: null, auditEntries };
  }

  /* --- upstream missing data ----------------------------------------- */
  if (
    input.comparisonResult.status === 'missing_data' ||
    input.comparisonResult.summary === null ||
    input.findingsResult.status === 'missing_data'
  ) {
    auditEntries.push(
      requiresReview(RC.REPORT_INPUT_MISSING, 'Ελλιπή δεδομένα σύγκρισης ή ευρημάτων: δεν παράγεται μελέτη με υποθετικά ή ελλιπή σύνολα.'),
    );
    return { status: 'missing_data', reportModel: null, auditEntries };
  }

  const cs = input.comparisonResult.summary;

  /* --- findings adapter (amounts and signs pass through) -------------- */
  const toMoney = (cents: number | null): NullableMoney =>
    cents === null ? null : moneyFromCents(cents, currency);
  const levelMap = (level: TechnicalFinding['level']): FindingLevel =>
    level === 'info' ? 'none' : level;

  let anyUnsafeFinding = false;
  const findings: Finding[] = input.findingsResult.findings.map((f) => {
    let description = f.description;
    let title = f.title;
    if (!f.reportSafe) {
      anyUnsafeFinding = true;
      auditEntries.push(
        warning(
          RC.FINDING_NOT_REPORT_SAFE,
          `Το εύρημα ${f.findingId} σημάνθηκε ως μη ασφαλές για τη μελέτη· η διατύπωσή του αντικαταστάθηκε από ουδέτερη σήμανση και απαιτείται έλεγχος.`,
          { findingId: f.findingId },
        ),
      );
      title = 'Εύρημα προς έλεγχο διατύπωσης';
      description = NEUTRAL_PLACEHOLDER;
    } else {
      title = screen(`finding:${f.findingId}:title`, title);
      description = screen(`finding:${f.findingId}:description`, description);
    }
    const periods = f.affectedRowIds
      .map((id) => Number.parseInt(id, 10))
      .filter((n) => Number.isSafeInteger(n));
    return {
      findingId: f.findingId,
      level: levelMap(f.level),
      title,
      description,
      magnitude: toMoney(f.amountCents), // amounts/signs untouched
      affectedPeriods: periods,
    };
  });

  /* --- missing data items ---------------------------------------------- */
  const missingData: MissingDataItem[] = [];
  if (cs.excludedRowCount > 0) {
    missingData.push({
      field: 'bank_schedule_values',
      description: `Ελλιπή δεδομένα: ${cs.excludedRowCount} περίοδοι με μη διαθέσιμες τιμές εξαιρέθηκαν από τα σχετικά σύνολα.`,
      impact: 'Τα σύνολα υπολογίζονται βάσει διαθέσιμων δεδομένων· μερική κάλυψη.',
    });
  }
  if (cs.totalEconomicDifferenceCents === null) {
    missingData.push({
      field: 'total_economic_difference',
      description: 'Ελλιπή δεδομένα: η συνολική οικονομική διαφορά δεν οριστικοποιείται.',
      impact: 'Δεν παρατίθεται συνολικό μέγεθος· απαιτείται συμπλήρωση δεδομένων.',
    });
  }
  if (cs.unmatchedBankRowCount > 0 || cs.unmatchedRecalcRowCount > 0) {
    missingData.push({
      field: 'row_matching',
      description: `Ελλιπή δεδομένα αντιστοίχισης: ${cs.unmatchedBankRowCount} γραμμές τράπεζας / fund και ${cs.unmatchedRecalcRowCount} γραμμές επανυπολογισμού χωρίς αντιστοίχιση.`,
      impact: 'Οι μη αντιστοιχισμένες γραμμές δεν συμμετέχουν στη σύγκριση.',
    });
  }

  /* --- limitations -------------------------------------------------------- */
  const limitations: string[] = [
    'Η παρούσα αποτελεί τεχνικό οικονομικό επανυπολογισμό και σύγκριση με τραπεζικά δεδομένα βάσει διαθέσιμων δεδομένων· δεν αποτελεί νομική κρίση ούτε γνωμοδότηση νομικού περιεχομένου.',
  ];
  if (cs.unmatchedBankRowCount > 0) {
    limitations.push(`Περιορισμός: ${cs.unmatchedBankRowCount} γραμμές δοσολογίου τράπεζας / fund δεν αντιστοιχίστηκαν και εξαιρέθηκαν από τη σύγκριση.`);
  }
  if (cs.unmatchedRecalcRowCount > 0) {
    limitations.push(`Περιορισμός: ${cs.unmatchedRecalcRowCount} γραμμές επανυπολογισμού δεν αντιστοιχίστηκαν και εξαιρέθηκαν από τη σύγκριση.`);
  }
  if (cs.excludedRowCount > 0) {
    limitations.push(`Περιορισμός: ${cs.excludedRowCount} περίοδοι εξαιρέθηκαν από τα σύνολα λόγω ελλιπών τιμών.`);
  }
  if (cs.totalEconomicDifferenceCents === null) {
    limitations.push('Περιορισμός: η συνολική οικονομική διαφορά δεν οριστικοποιείται λόγω ελλιπών δεδομένων και δεν παρατίθεται.');
  }
  if (anyUnsafeFinding) {
    limitations.push('Περιορισμός: ένα ή περισσότερα ευρήματα εξαιρέθηκαν ως προς τη διατύπωσή τους λόγω μη ουδέτερης γλώσσας· απαιτείται έλεγχος πριν την υπογραφή.');
  }
  const reviewFindings = input.findingsResult.findings.filter(
    (f) => f.level === 'requires_review' || f.level === 'deviation',
  ).length;
  if (reviewFindings > 0) {
    limitations.push(`Περιορισμός: ${reviewFindings} ευρήματα απαιτούν έλεγχο πριν από οποιαδήποτε υπογεγραμμένη χρήση.`);
  }
  for (const note of input.additionalNotes ?? []) {
    limitations.push(screen('additionalNotes', note));
  }

  /* --- payment reconciliation integration (Step 9-B) ------------------------ */
  // Values are COPIED from the already-computed result; reconcile is
  // never called here. The reconciliation sign convention
  // (actualPaid − due) is documented separately from the comparison
  // convention (bank − recalculated) and surfaced in its own text.
  let totalActualPaidDifferenceCents: number | null = null;
  let reconciliationSummaryText: string | null = null;
  let reconBankOnlyNote: string | null = null;

  if (recon !== undefined) {
    const rs = recon.summary;
    if (rs === null || recon.status === 'missing_data') {
      missingData.push({
        field: 'payment_reconciliation',
        description: 'Ελλείποντα δεδομένα: η συμφωνία πραγματικών καταβολών δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.',
        impact: 'Δεν παρατίθεται συνολική διαφορά πραγματικής καταβολής.',
      });
      limitations.push('Περιορισμός: η συμφωνία πραγματικών καταβολών δεν οριστικοποιείται λόγω ελλιπών δεδομένων· η συνολική διαφορά πραγματικής καταβολής δεν παρατίθεται.');
      reconciliationSummaryText = screen(
        'reconciliationSummary',
        'Συμφωνία πραγματικών καταβολών: δεν οριστικοποιείται με τα διαθέσιμα δεδομένα. ' +
          'Σύμβαση προσήμου συμφωνίας: διαφορά πραγματικής καταβολής = πραγματικά καταβληθέντα μείον οφειλόμενο ποσό (διακριτή από τη σύμβαση σύγκρισης τράπεζας μείον επανυπολογισμού).',
      );
    } else {
      // prefer the recalculated-side total; fall back to bank side in a
      // clearly labelled subsection (never relabelled as recalculated).
      if (rs.totalDifferenceVsRecalculatedCents !== null) {
        totalActualPaidDifferenceCents = rs.totalDifferenceVsRecalculatedCents;
      } else if (rs.totalDifferenceVsBankCents !== null) {
        reconBankOnlyNote = `Διαφορά πραγματικής καταβολής έναντι τράπεζας / fund: ${signedText(rs.totalDifferenceVsBankCents)} (δεν παρατίθεται ως διαφορά έναντι επανυπολογισμού).`;
      }

      reconciliationSummaryText = screen(
        'reconciliationSummary',
        `Συμφωνία πραγματικών καταβολών βάσει διαθέσιμων δεδομένων. ` +
          `Πραγματικά καταβληθέντα: ${plainText(rs.totalActualPaidCents)}. ` +
          `Οφειλόμενο τράπεζας / fund: ${plainText(rs.totalBankDueCents)}. ` +
          `Οφειλόμενο επανυπολογισμού: ${plainText(rs.totalRecalculatedDueCents)}. ` +
          `Διαφορά πραγματικής καταβολής έναντι τράπεζας / fund: ${signedText(rs.totalDifferenceVsBankCents)}. ` +
          `Διαφορά πραγματικής καταβολής έναντι επανυπολογισμού: ${signedText(rs.totalDifferenceVsRecalculatedCents)}. ` +
          `Αντιστοιχισμένες καταβολές: ${rs.matchedPaymentCount}· μη αντιστοιχισμένες καταβολές: ${rs.unmatchedPaymentCount}· ` +
          `δόσεις χωρίς καταβολή: ${rs.unmatchedDueCount}· περιόδοι προς έλεγχο: ${rs.rowsRequiringReviewCount}· ` +
          `εξαιρεθείσες γραμμές: ${rs.excludedRowCount}. ` +
          (reconBankOnlyNote ?? '') +
          ` Σύμβαση προσήμου συμφωνίας: διαφορά πραγματικής καταβολής = πραγματικά καταβληθέντα μείον οφειλόμενο ποσό (διακριτή από τη σύμβαση σύγκρισης τράπεζας / fund μείον επανυπολογισμού).`,
      );

      // limitations / missingData from reconciliation specifics
      if (rs.unmatchedPaymentCount > 0) {
        limitations.push(`Περιορισμός: ${rs.unmatchedPaymentCount} πραγματικές καταβολές δεν αντιστοιχίστηκαν σε δόση και απαιτούν έλεγχο.`);
        missingData.push({
          field: 'unmatched_payments',
          description: `Ελλείποντα δεδομένα αντιστοίχισης: ${rs.unmatchedPaymentCount} πραγματικές καταβολές χωρίς αντίστοιχη δόση.`,
          impact: 'Οι μη αντιστοιχισμένες καταβολές δεν συμμετέχουν στα σύνολα συμφωνίας.',
        });
      }
      if (rs.unmatchedDueCount > 0) {
        limitations.push(`Περιορισμός: ${rs.unmatchedDueCount} δόσεις χωρίς αντιστοιχισμένη πραγματική καταβολή· δεν τεκμαίρεται μηδενική καταβολή.`);
        missingData.push({
          field: 'unmatched_due_rows',
          description: `Ελλείποντα δεδομένα αντιστοίχισης: ${rs.unmatchedDueCount} δόσεις χωρίς αντιστοιχισμένη καταβολή.`,
          impact: 'Δεν τεκμαίρεται μηδενική καταβολή για τις δόσεις αυτές.',
        });
      }
      if (rs.excludedRowCount > 0) {
        limitations.push(`Περιορισμός: ${rs.excludedRowCount} γραμμές συμφωνίας εξαιρέθηκαν από τα σύνολα λόγω ελλιπών τιμών.`);
        missingData.push({
          field: 'reconciliation_excluded_rows',
          description: `Ελλείποντα δεδομένα: ${rs.excludedRowCount} γραμμές συμφωνίας με μη διαθέσιμες τιμές (καταβολή ή οφειλόμενο).`,
          impact: 'Οι γραμμές αυτές εξαιρέθηκαν από τα σύνολα συμφωνίας.',
        });
      }
      if (rs.rowsRequiringReviewCount > 0) {
        limitations.push(`Περιορισμός: ${rs.rowsRequiringReviewCount} καταβολές με διαφορά πραγματικής καταβολής που απαιτεί έλεγχο.`);
      }
      if (
        rs.totalDifferenceVsRecalculatedCents === null &&
        rs.totalDifferenceVsBankCents === null
      ) {
        limitations.push('Περιορισμός: η συνολική διαφορά πραγματικής καταβολής δεν οριστικοποιείται λόγω ελλιπών δεδομένων.');
        missingData.push({
          field: 'total_actual_paid_difference',
          description: 'Ελλείποντα δεδομένα: η συνολική διαφορά πραγματικής καταβολής δεν οριστικοποιείται.',
          impact: 'Δεν παρατίθεται συνολική διαφορά πραγματικής καταβολής.',
        });
      }
    }
  }

  /* --- texts ----------------------------------------------------------------- */
  const m = input.methodology;
  const preparer = input.preparedBy;
  const inputSummary = screen(
    'inputSummary',
    `${REPORT_TITLE}. Υπόθεση: ${input.caseInfo.debtorName}, σύμβαση ${input.caseInfo.contractNumber}, ${input.caseInfo.institution}${input.caseInfo.servicer ? ` / ${input.caseInfo.servicer}` : ''}. ` +
      `Κεφάλαιο αναφοράς ${formatMoneyGreek(input.caseInfo.principal)}, διάρκεια ${input.caseInfo.termMonths} μήνες. ` +
      `Συγκρίθηκαν ${cs.comparedRowCount} περίοδοι βάσει διαθέσιμων δεδομένων.` +
      (preparer ? ` Κατάρτιση: ${preparer.name}, ${preparer.professionalTitle}, ${preparer.officeName} (${preparer.contact}).` : ''),
  );

  const methodology = screen(
    'methodology',
    `Μεθοδολογία: τεχνικός οικονομικός επανυπολογισμός με τύπο προγράμματος «${m.scheduleType}» και τοκισμό επί του ανεξόφλητου υπολοίπου κεφαλαίου. ` +
      `Επιτόκιο: ${m.rateDescription}. Σύμβαση ημερομέτρησης: ${m.dayCountConvention}. ` +
      `Καθεστώς Ν.128/75: ${m.law128Status}. Χειρισμός αρνητικού δείκτη: ${m.negativeIndexPolicy}. ` +
      `Πολιτική στρογγυλοποίησης: ${m.roundingPolicy}. Κάλυψη δεδομένων: ${m.dataCoverageNote}. ` +
      `Η σύγκριση με τραπεζικά δεδομένα διενεργήθηκε βάσει διαθέσιμων δεδομένων.`,
  );

  const bankScheduleSummary = screen(
    'bankScheduleSummary',
    `Δεδομένα τράπεζας / fund: ${cs.comparedRowCount + cs.unmatchedBankRowCount} γραμμές, εκ των οποίων ${cs.unmatchedBankRowCount} χωρίς αντιστοίχιση και ${cs.excludedRowCount} με ελλιπείς τιμές.` +
      (cs.totalBankInstallmentsCents !== null
        ? ` Σύνολο δόσεων (συγκρίσιμες περίοδοι): ${formatMoneyGreek(moneyFromCents(cs.totalBankInstallmentsCents, currency))}.`
        : ' Το σύνολο δόσεων δεν οριστικοποιείται λόγω ελλιπών δεδομένων.'),
  );

  const recalculationSummary = screen(
    'recalculationSummary',
    `Επανυπολογισμός («${m.scheduleType}»): ${cs.comparedRowCount + cs.unmatchedRecalcRowCount} γραμμές, εκ των οποίων ${cs.unmatchedRecalcRowCount} χωρίς αντιστοίχιση.` +
      (cs.totalRecalculatedInstallmentsCents !== null
        ? ` Σύνολο δόσεων (συγκρίσιμες περίοδοι): ${formatMoneyGreek(moneyFromCents(cs.totalRecalculatedInstallmentsCents, currency))}.`
        : ' Το σύνολο δόσεων δεν οριστικοποιείται λόγω ελλιπών δεδομένων.') +
      (reconciliationSummaryText !== null ? `\n${reconciliationSummaryText}` : ''),
  );

  /* --- summary mapping (numbers copied, never recomputed) -------------------- */
  const comparisonSummary: ComparisonSummary = {
    totalInterestDifference: toMoney(cs.totalInterestDifferenceCents),
    totalPrincipalDifference: toMoney(cs.totalPrincipalDifferenceCents),
    totalActualPaidDifference: toMoney(totalActualPaidDifferenceCents),
    periodsWithDeviation: cs.rowsRequiringReviewCount,
    periodsWithMissingData: cs.excludedRowCount,
    periodsCompared: cs.comparedRowCount,
  };

  /* --- assemble through the Step 1-A guard ------------------------------------ */
  const now =
    input.generatedAt !== undefined
      ? () => new Date(input.generatedAt as string)
      : undefined;

  let reportModel: ReportModel | null = null;
  try {
    reportModel = createReportModel(
      {
        caseInfo: input.caseInfo,
        inputSummary,
        methodology,
        bankScheduleSummary,
        recalculationSummary,
        comparisonSummary,
        findings,
        missingData,
        limitations,
        auditEntries,
      },
      now,
    );
  } catch (err) {
    if (err instanceof ReportWordingError) {
      auditEntries.push(
        warning(RC.REPORT_GUARD_REJECTED, 'Ο τελικός έλεγχος ουδέτερης διατύπωσης απέρριψε τη μελέτη· δεν παράγεται μοντέλο μελέτης χωρίς διόρθωση.', { violations: err.violations.map((v) => v.location) }),
      );
      return { status: 'requires_review', reportModel: null, auditEntries };
    }
    throw err;
  }

  /* --- status -------------------------------------------------------------------- */
  const needsReview =
    input.comparisonResult.status === 'requires_review' ||
    input.findingsResult.status === 'requires_review' ||
    (recon !== undefined && recon.status !== 'success') ||
    anyUnsafeFinding ||
    wordingViolations ||
    cs.unmatchedBankRowCount > 0 ||
    cs.unmatchedRecalcRowCount > 0 ||
    cs.excludedRowCount > 0 ||
    cs.totalEconomicDifferenceCents === null;

  return {
    status: needsReview ? 'requires_review' : 'success',
    reportModel,
    auditEntries,
  };
}
