/**
 * Loan Audit PRO — src/renderers/reportTextRenderer.ts
 * ------------------------------------------------------------------
 * Step 7-B: Report TEXT Renderer ONLY.
 *
 * Converts an existing, already-guarded ReportModel (Step 7-A) into
 * structured GREEK text sections for the «Τεχνική Οικονομική Μελέτη
 * Ελέγχου Δανείου». Plain text only: NO PDF, NO markup, NO
 * components, NO recalculation of any kind — every number is read
 * from the model and rendered as-is, with its sign preserved.
 *
 * Formatting rules:
 *   - euro amounts in Greek format (1.234,56 €);
 *   - DIFFERENCE amounts are rendered with an explicit sign
 *     (+5,32 € / -1,83 €) under the locked convention, and the
 *     convention sentence accompanies every appearance:
 *     «Η οικονομική διαφορά υπολογίζεται ως ποσό Τράπεζας/Fund μείον
 *     ποσό επανυπολογισμού.»
 *   - null amounts render as «Δεν οριστικοποιείται με τα διαθέσιμα
 *     δεδομένα.» — NEVER as 0,00 €.
 *
 * Wording safety: although the model has already passed the Step 7-A
 * guards, the renderer re-screens every text it emits with the
 * extended forbidden-terms guard PLUS the renderer-specific bans
 * («νομική γνωμοδότηση», «3869», «6/2026» references). Offending
 * text is replaced with a neutral marker, a warning is recorded and
 * the render status becomes requires_review.
 */

import { formatMoneyGreek, type NullableMoney } from '../domain/money';
import type { ReportModel, Finding } from '../domain/reportTypes';
import type { FindingLevel } from '../domain/comparisonTypes';
import type { AuditEntry } from '../domain/auditTypes';
import { warning } from '../domain/auditFactories';
import { findForbiddenFindingTerms } from '../engines/findingsEngine';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const RENDER_AUDIT_CODES = {
  RENDER_TEXT_NOT_NEUTRAL: 'RENDER_TEXT_NOT_NEUTRAL',
} as const;

export const RENDERED_REPORT_TITLE = 'Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου';

export const NOT_FINALIZED_TEXT = 'Δεν οριστικοποιείται με τα διαθέσιμα δεδομένα.';

export const SIGN_CONVENTION_TEXT =
  'Η οικονομική διαφορά υπολογίζεται ως ποσό Τράπεζας/Fund μείον ποσό επανυπολογισμού.';

const GENERAL_DISCLAIMER =
  'Η παρούσα αποτελεί τεχνική οικονομική αποτύπωση βάσει των διαθέσιμων δεδομένων και δεν αποτελεί νομική κρίση ούτε γνωμοδότηση νομικού περιεχομένου.';

const NEUTRAL_MARKER =
  'Το κείμενο εξαιρέθηκε από τη μελέτη λόγω μη ουδέτερης διατύπωσης· απαιτείται έλεγχος.';

/** Renderer-specific banned fragments (beyond the extended guard). */
const RENDERER_BANNED_FRAGMENTS: readonly string[] = [
  'νομικη γνωμοδοτηση',
  '3869',
  '6/2026',
];

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ReportTextRenderStatus = 'success' | 'requires_review';

export type ReportSectionLevel =
  | 'cover'
  | 'summary'
  | 'methodology'
  | 'findings'
  | 'limitations'
  | 'appendix';

export interface ReportTextSection {
  readonly sectionId: string;
  readonly title: string;
  readonly body: string;
  readonly level: ReportSectionLevel;
}

export interface ReportTextRenderResult {
  readonly status: ReportTextRenderStatus;
  readonly title: string;
  readonly sections: readonly ReportTextSection[];
  readonly fullText: string;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function renderLoanAuditReportText(
  reportModel: ReportModel,
): ReportTextRenderResult {
  const auditEntries: AuditEntry[] = [];
  let violations = false;

  const normalize = (t: string): string =>
    t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  /** Screen any text before it enters the rendered output. */
  const screen = (location: string, text: string): string => {
    const terms = [...findForbiddenFindingTerms(text)];
    const norm = normalize(text);
    for (const frag of RENDERER_BANNED_FRAGMENTS) {
      if (norm.includes(frag)) terms.push(frag);
    }
    if (terms.length === 0) return text;
    violations = true;
    auditEntries.push(
      warning(
        RENDER_AUDIT_CODES.RENDER_TEXT_NOT_NEUTRAL,
        `Μη ουδέτερη διατύπωση κατά την αποτύπωση («${location}»)· το κείμενο αντικαταστάθηκε από ουδέτερη σήμανση και απαιτείται έλεγχος.`,
        { location, terms },
      ),
    );
    return NEUTRAL_MARKER;
  };

  /** Plain amount (totals, capital). */
  const amount = (m: NullableMoney): string =>
    m === null ? NOT_FINALIZED_TEXT : formatMoneyGreek(m);

  /** DIFFERENCE amount: sign always explicit, null never zero. */
  const signedAmount = (m: NullableMoney): string => {
    if (m === null) return NOT_FINALIZED_TEXT;
    const text = formatMoneyGreek(m);
    return m.cents > 0 ? `+${text}` : text; // negative already carries '-'
  };

  const levelLabel = (level: FindingLevel): string => {
    switch (level) {
      case 'none':
        return 'Πληροφοριακό';
      case 'rounding':
        return 'Διαφορά στρογγυλοποίησης';
      case 'deviation':
        return 'Οικονομική απόκλιση';
      case 'missing_data':
        return 'Ελλείποντα δεδομένα';
      case 'requires_review':
        return 'Απαιτείται έλεγχος';
    }
  };

  const m = reportModel;
  const cs = m.comparisonSummary;

  /* --- review reasons (for explicit limitations) ---------------------- */
  const reviewAuditCount = m.auditEntries.filter(
    (e) => e.severity === 'requires_review' || e.severity === 'warning',
  ).length;
  const reviewFindings = m.findings.filter(
    (f) => f.level === 'deviation' || f.level === 'requires_review' || f.level === 'missing_data',
  );
  const reviewNeeded = reviewAuditCount > 0 || reviewFindings.length > 0;

  /* --- sections --------------------------------------------------------- */
  const sections: ReportTextSection[] = [];
  const add = (
    sectionId: string,
    title: string,
    level: ReportSectionLevel,
    body: string,
  ): void => {
    sections.push({ sectionId, title, level, body });
  };

  add(
    'S01',
    'Εξώφυλλο / Ταυτότητα Μελέτης',
    'cover',
    `${RENDERED_REPORT_TITLE}\n` +
      `Αριθμός υπόθεσης: ${screen('caseId', m.caseInfo.caseId)}\n` +
      `Ημερομηνία κατάρτισης: ${m.generatedAt}`,
  );

  add(
    'S02',
    'Στοιχεία Υπόθεσης',
    'cover',
    `Οφειλέτης: ${screen('debtorName', m.caseInfo.debtorName)}\n` +
      `Αριθμός σύμβασης: ${screen('contractNumber', m.caseInfo.contractNumber)}\n` +
      `Τράπεζα / Fund: ${screen('institution', m.caseInfo.institution)}` +
      (m.caseInfo.servicer ? ` — Servicer: ${screen('servicer', m.caseInfo.servicer)}` : '') +
      `\nΚεφάλαιο αναφοράς: ${amount(m.caseInfo.principal)}\n` +
      `Διάρκεια: ${m.caseInfo.termMonths} μήνες (${m.caseInfo.startDate} – ${m.caseInfo.endDate})\n` +
      screen('inputSummary', m.inputSummary),
  );

  add(
    'S03',
    'Σύνοψη Ελέγχου',
    'summary',
    `Συγκρίθηκαν ${cs.periodsCompared} περίοδοι βάσει διαθέσιμων δεδομένων· ` +
      `${cs.periodsWithMissingData} περίοδοι με ελλείποντα δεδομένα, ` +
      `${cs.periodsWithDeviation} περίοδοι με οικονομική απόκλιση που απαιτεί έλεγχο.\n` +
      `Συνολική οικονομική διαφορά τόκων: ${signedAmount(cs.totalInterestDifference)}\n` +
      `Συνολική οικονομική διαφορά κεφαλαίου: ${signedAmount(cs.totalPrincipalDifference)}\n` +
      SIGN_CONVENTION_TEXT,
  );

  add('S04', 'Δεδομένα Τράπεζας / Fund', 'summary', screen('bankScheduleSummary', m.bankScheduleSummary));

  add('S05', 'Δεδομένα Επανυπολογισμού', 'summary', screen('recalculationSummary', m.recalculationSummary));

  add('S06', 'Μεθοδολογία Επανυπολογισμού', 'methodology', screen('methodology', m.methodology));

  add(
    'S07',
    'Συγκριτικά Αποτελέσματα',
    'summary',
    `${SIGN_CONVENTION_TEXT}\n` +
      `Περίοδοι σύγκρισης: ${cs.periodsCompared}. ` +
      `Διαφορά τόκων: ${signedAmount(cs.totalInterestDifference)}. ` +
      `Διαφορά κεφαλαίου: ${signedAmount(cs.totalPrincipalDifference)}. ` +
      `Διαφορά πραγματικών καταβολών: ${signedAmount(cs.totalActualPaidDifference)}`,
  );

  const findingLines =
    m.findings.length === 0
      ? 'Δεν καταχωρήθηκαν ευρήματα.'
      : m.findings
          .map((f: Finding, i: number) => {
            const title = screen(`finding:${f.findingId}:title`, f.title);
            const description = screen(`finding:${f.findingId}:description`, f.description);
            const periods =
              f.affectedPeriods.length > 0
                ? ` Περίοδοι: ${f.affectedPeriods.join(', ')}.`
                : '';
            return (
              `${i + 1}. [${f.findingId}] ${title} — ${levelLabel(f.level)}\n` +
              `   ${description}\n` +
              `   Μέγεθος: ${signedAmount(f.magnitude)}${periods}`
            );
          })
          .join('\n');
  add('S08', 'Τεχνικά Οικονομικά Ευρήματα', 'findings', `${findingLines}\n${SIGN_CONVENTION_TEXT}`);

  const missingLines =
    m.missingData.length === 0
      ? 'Δεν καταγράφηκαν ελλείποντα δεδομένα.'
      : m.missingData
          .map((x, i) => `${i + 1}. ${screen(`missing:${x.field}`, x.description)} Επίπτωση: ${screen(`missing:${x.field}:impact`, x.impact)}`)
          .join('\n');
  add('S09', 'Ελλείποντα Δεδομένα', 'limitations', missingLines);

  const limitationLines: string[] = [];
  if (reviewNeeded) {
    limitationLines.push(
      'Η μελέτη φέρει σήμανση «Απαιτείται έλεγχος» για τους εξής λόγους: ' +
        `${reviewFindings.length} ευρήματα με απόκλιση, ελλείποντα δεδομένα ή ανάγκη ελέγχου και ` +
        `${reviewAuditCount} σχετικές εγγραφές στον φάκελο ελέγχου.`,
    );
  }
  for (const l of m.limitations) limitationLines.push(screen('limitation', l));
  if (limitationLines.length === 0) limitationLines.push(GENERAL_DISCLAIMER);
  add('S10', 'Περιορισμοί Μελέτης', 'limitations', limitationLines.map((l, i) => `${i + 1}. ${l}`).join('\n'));

  add('S11', 'Δήλωση Περιορισμού', 'limitations', GENERAL_DISCLAIMER);

  add(
    'S12',
    'Στοιχεία Συντάκτη / Γραφείου',
    'appendix',
    'Στοιχεία κατάρτισης όπως δηλώθηκαν στην ταυτότητα της μελέτης. Θέση υπογραφής: ____________________',
  );

  /* --- full text --------------------------------------------------------- */
  const fullText =
    `${RENDERED_REPORT_TITLE}\n\n` +
    sections.map((s) => `=== ${s.title} ===\n${s.body}`).join('\n\n');

  return {
    status: violations ? 'requires_review' : 'success',
    title: RENDERED_REPORT_TITLE,
    sections,
    fullText,
    auditEntries,
  };
}
