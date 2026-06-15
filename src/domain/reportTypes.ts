/**
 * Loan Audit PRO — src/domain/reportTypes.ts
 * ------------------------------------------------------------------
 * Report model for «ΤΕΧΝΙΚΗ ΟΙΚΟΝΟΜΙΚΗ ΜΕΛΕΤΗ ΕΛΕΓΧΟΥ ΔΑΝΕΙΟΥ».
 *
 * Wording rule: the report uses NEUTRAL FINANCIAL wording only.
 * It is a technical financial recalculation, not a legal opinion.
 * Forbidden terms are enforced by createReportModel below.
 */

import type { ISODateTime } from './dateTypes';
import type { NullableMoney } from './money';
import type { CaseInfo } from './loanTypes';
import type { AuditEntry } from './auditTypes';
import type { FindingLevel } from './comparisonTypes';

/**
 * Terms that must never appear in report text (case-insensitive,
 * accent-insensitive). Legal characterizations are out of scope for
 * a technical financial study.
 */
export const FORBIDDEN_REPORT_TERMS: readonly string[] = [
  'παράνομο',
  'παράνομη',
  'παράνομα',
  'άκυρο',
  'άκυρη',
  'άκυρα',
  'διεκδίκηση',
  'διεκδικήσιμο',
  'προς επιστροφή',
  'αχρεωστήτως',
  'νομική γνωμοδότηση',
] as const;

/** Examples of allowed neutral wording (reference for UI/report copy). */
export const ALLOWED_REPORT_TERMS: readonly string[] = [
  'τεχνικό οικονομικό εύρημα',
  'οικονομική απόκλιση',
  'οικονομική διαφορά',
  'απαιτείται έλεγχος',
  'ελλιπή δεδομένα',
  'σύγκριση με τραπεζικά δεδομένα',
] as const;

/** Lowercase + strip Greek diacritics for robust matching. */
function normalizeGreek(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const FORBIDDEN_NORMALIZED = FORBIDDEN_REPORT_TERMS.map(normalizeGreek);

/** Returns the forbidden terms found in `text` (empty array = clean). */
export function findForbiddenTerms(text: string): readonly string[] {
  const normalized = normalizeGreek(text);
  const found: string[] = [];
  FORBIDDEN_NORMALIZED.forEach((term, i) => {
    if (normalized.includes(term)) {
      const original = FORBIDDEN_REPORT_TERMS[i];
      if (original !== undefined) found.push(original);
    }
  });
  return found;
}

/** Ένα τεχνικό οικονομικό εύρημα. */
export interface Finding {
  readonly findingId: string;
  readonly level: FindingLevel;
  /** Short neutral title, e.g. «Οικονομική διαφορά τόκων». */
  readonly title: string;
  /** Neutral financial description. */
  readonly description: string;
  /** Συνολικό οικονομικό μέγεθος του ευρήματος. null = not quantifiable. */
  readonly magnitude: NullableMoney;
  /** Affected period numbers (1-based). Empty = case-level finding. */
  readonly affectedPeriods: readonly number[];
}

/** Ελλείπον δεδομένο που περιόρισε τη μελέτη. */
export interface MissingDataItem {
  readonly field: string;
  readonly description: string;
  readonly impact: string;
}

/** Aggregate figures of the comparison (totals, counts). */
export interface ComparisonSummary {
  /** Σωρευτική οικονομική διαφορά τόκων (bank − recalculated). */
  readonly totalInterestDifference: NullableMoney;
  readonly totalPrincipalDifference: NullableMoney;
  readonly totalActualPaidDifference: NullableMoney;
  readonly periodsWithDeviation: number;
  readonly periodsWithMissingData: number;
  readonly periodsCompared: number;
}

export interface ReportModel {
  readonly caseInfo: CaseInfo;
  /** Σύνοψη δεδομένων εισόδου όπως καταχωρήθηκαν. */
  readonly inputSummary: string;
  /** Μεθοδολογία: τύπος δανείου, ημερομέτρηση, Ν.128/75, υποθέσεις. */
  readonly methodology: string;
  readonly bankScheduleSummary: string;
  readonly recalculationSummary: string;
  readonly comparisonSummary: ComparisonSummary;
  readonly findings: readonly Finding[];
  readonly missingData: readonly MissingDataItem[];
  /** Περιορισμοί μελέτης + δήλωση περιορισμού ευθύνης. */
  readonly limitations: readonly string[];
  readonly auditEntries: readonly AuditEntry[];
  readonly generatedAt: ISODateTime;
}

export class ReportWordingError extends Error {
  override name = 'ReportWordingError';
  constructor(
    message: string,
    readonly violations: readonly { location: string; terms: readonly string[] }[],
  ) {
    super(message);
  }
}

/**
 * Factory: validates neutral wording across all free-text fields and
 * stamps generatedAt. Throws ReportWordingError if any forbidden term
 * is present. Audit entries (including warnings) pass through intact —
 * warnings are part of the report, never dropped.
 */
export function createReportModel(
  input: Omit<ReportModel, 'generatedAt'>,
  now: () => Date = () => new Date(),
): ReportModel {
  const violations: { location: string; terms: readonly string[] }[] = [];

  const check = (location: string, text: string): void => {
    const terms = findForbiddenTerms(text);
    if (terms.length > 0) violations.push({ location, terms });
  };

  check('inputSummary', input.inputSummary);
  check('methodology', input.methodology);
  check('bankScheduleSummary', input.bankScheduleSummary);
  check('recalculationSummary', input.recalculationSummary);
  input.findings.forEach((f, i) => {
    check(`findings[${i}].title`, f.title);
    check(`findings[${i}].description`, f.description);
  });
  input.missingData.forEach((m, i) => {
    check(`missingData[${i}].description`, m.description);
    check(`missingData[${i}].impact`, m.impact);
  });
  input.limitations.forEach((l, i) => check(`limitations[${i}]`, l));

  if (violations.length > 0) {
    throw new ReportWordingError(
      `Report contains non-neutral wording in ${violations.length} location(s)`,
      violations,
    );
  }

  return Object.freeze({
    ...input,
    generatedAt: now().toISOString() as ISODateTime,
  });
}
