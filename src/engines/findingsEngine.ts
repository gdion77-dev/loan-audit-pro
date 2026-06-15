/**
 * Loan Audit PRO — src/engines/findingsEngine.ts
 * ------------------------------------------------------------------
 * Step 6-B: Findings Engine ONLY.
 *
 * Converts a ScheduleComparisonResult (locked Step 6-A output) into
 * NEUTRAL TECHNICAL FINANCIAL FINDINGS for the study. Pure transform:
 * it reads the existing comparison result and NEVER recomputes
 * schedules, interest, rates, day counts or comparisons.
 *
 * SIGN CONVENTION (locked — unchanged):
 *   difference = bankOrFundAmount − recalculatedAmount
 *   > 0  bank/fund amount higher than the recalculation
 *   < 0  recalculation higher than the bank/fund amount
 *
 * WORDING: neutral financial terminology only («τεχνικό οικονομικό
 * εύρημα», «οικονομική απόκλιση/διαφορά», «απαιτείται έλεγχος»,
 * «ελλιπή δεδομένα», «βάσει διαθέσιμων δεδομένων»). Every produced
 * finding passes through the existing forbidden-terms guard; any
 * finding carrying non-neutral wording (e.g. injected through
 * upstream free text) is marked reportSafe = false with an audit
 * warning instead of being silently printed.
 *
 * Scope guards: independent of Ν.3869/2010 and ΑΠ 6/2026; no UI/PDF/
 * Excel/reconciliation; no schedule generation; totals are never
 * faked — null totals are described as not finalizable.
 */

import type { CurrencyCode, NullableMoney } from '../domain/money';
import { formatMoneyGreek, moneyFromCents } from '../domain/money';
import type { ComparisonRow } from '../domain/comparisonTypes';
import { findForbiddenTerms, FORBIDDEN_REPORT_TERMS } from '../domain/reportTypes';
import { createAuditEntry, type AuditEntry } from '../domain/auditTypes';
import { warning } from '../domain/auditFactories';
import {
  SCHEDULE_COMPARISON_AUDIT_CODES as SC,
  type ScheduleComparisonResult,
} from './scheduleComparisonEngine';

/* ------------------------------------------------------------------ */
/* Audit codes specific to this engine                                 */
/* ------------------------------------------------------------------ */

export const FINDINGS_AUDIT_CODES = {
  FINDINGS_NOT_FINALIZABLE: 'FINDINGS_NOT_FINALIZABLE',
  FINDING_NOT_REPORT_SAFE: 'FINDING_NOT_REPORT_SAFE',
} as const;

const FC = FINDINGS_AUDIT_CODES;

/**
 * Extra non-neutral terms guarded in addition to the Step 1-A list.
 * (The Step 1-A FORBIDDEN_REPORT_TERMS already covers: παράνομο,
 * άκυρο, διεκδίκηση, προς επιστροφή, αχρεωστήτως, νομική γνωμοδότηση.)
 */
export const ADDITIONAL_FORBIDDEN_FINDING_TERMS: readonly string[] = [
  'δικαιούται',
  'οφείλει η τράπεζα',
  'υπαιτιότητα',
  'νομική παραβίαση',
  'αγωγή',
  'ανακοπή',
] as const;

function normalizeGreek(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const EXTRA_NORMALIZED = ADDITIONAL_FORBIDDEN_FINDING_TERMS.map(normalizeGreek);

/** Forbidden terms found in `text` (Step 1-A guard + the extra list). */
export function findForbiddenFindingTerms(text: string): readonly string[] {
  const fromBase = findForbiddenTerms(text);
  const normalized = normalizeGreek(text);
  const extra = ADDITIONAL_FORBIDDEN_FINDING_TERMS.filter((_, i) =>
    normalized.includes(EXTRA_NORMALIZED[i]!),
  );
  return [...fromBase, ...extra];
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type FindingsStatus = 'success' | 'requires_review' | 'missing_data';

export type TechnicalFindingLevel =
  | 'info'
  | 'rounding'
  | 'deviation'
  | 'missing_data'
  | 'requires_review';

export type FindingSource = 'comparison' | 'audit' | 'summary';

export interface TechnicalFinding {
  readonly findingId: string;
  readonly level: TechnicalFindingLevel;
  readonly title: string;
  readonly description: string;
  readonly affectedRowIds: readonly string[];
  readonly affectedPeriods: readonly string[];
  /** Signed total per the locked convention; null = not quantifiable. */
  readonly amountCents: number | null;
  readonly count: number;
  readonly source: FindingSource;
  readonly reportSafe: boolean;
}

export interface FindingsInput {
  readonly comparisonResult: ScheduleComparisonResult;
  /** Default 1 cent — must mirror the comparison threshold in use. */
  readonly materialityThresholdCents?: number;
  readonly currency?: CurrencyCode;
  /** Default true: emit the neutral «no deviation» info finding. */
  readonly includeZeroDifferenceFinding?: boolean;
}

export interface FindingsResult {
  readonly status: FindingsStatus;
  readonly findings: readonly TechnicalFinding[];
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function centsOf(value: NullableMoney | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isSafeInteger(value.cents) ? value.cents : null;
}

function fmt(cents: number, currency: CurrencyCode): string {
  return formatMoneyGreek(moneyFromCents(cents, currency));
}

/** Neutral sign explanation per the locked convention. */
function signExplanation(totalCents: number): string {
  if (totalCents > 0) {
    return 'θετική οικονομική διαφορά: το μέγεθος τράπεζας / fund είναι υψηλότερο από τον επανυπολογισμό';
  }
  if (totalCents < 0) {
    return 'αρνητική οικονομική διαφορά: ο επανυπολογισμός είναι υψηλότερος από το μέγεθος τράπεζας / fund';
  }
  return 'μηδενική οικονομική διαφορά';
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function generateFindings(input: FindingsInput): FindingsResult {
  const comparison = input.comparisonResult;
  const threshold = input.materialityThresholdCents ?? 1;
  const currency: CurrencyCode = input.currency ?? 'EUR';
  const includeZero = input.includeZeroDifferenceFinding ?? true;

  const auditEntries: AuditEntry[] = [];
  const findings: TechnicalFinding[] = [];
  let seq = 0;

  const addFinding = (f: Omit<TechnicalFinding, 'findingId' | 'reportSafe'>): void => {
    seq += 1;
    const findingId = `F-${String(seq).padStart(3, '0')}`;
    const violations = [
      ...findForbiddenFindingTerms(f.title),
      ...findForbiddenFindingTerms(f.description),
    ];
    const reportSafe = violations.length === 0;
    if (!reportSafe) {
      auditEntries.push(
        warning(
          FC.FINDING_NOT_REPORT_SAFE,
          `Μη ουδέτερη διατύπωση σε εύρημα (${findingId}): οι όροι δεν επιτρέπονται σε τεχνική οικονομική μελέτη. Το εύρημα σημάνθηκε ως μη ασφαλές για τη μελέτη.`,
          { findingId, terms: violations },
        ),
      );
    }
    findings.push({ ...f, findingId, reportSafe });
  };

  /* --- rule 2: comparison not finalizable ---------------------------- */
  if (comparison.status === 'missing_data') {
    addFinding({
      level: 'missing_data',
      title: 'Μη οριστικοποιήσιμα ευρήματα σύγκρισης',
      description:
        'Τεχνικό οικονομικό εύρημα: τα ευρήματα σύγκρισης με τραπεζικά δεδομένα δεν μπορούν να οριστικοποιηθούν λόγω ελλιπών δεδομένων σύγκρισης. Δεν υπολογίζονται ποσά βάσει υποθέσεων.',
      affectedRowIds: [],
      affectedPeriods: [],
      amountCents: null,
      count: 0,
      source: 'comparison',
    });
    auditEntries.push(
      warning(FC.FINDINGS_NOT_FINALIZABLE, 'Ελλιπή δεδομένα σύγκρισης: τα ευρήματα δεν οριστικοποιούνται.'),
    );
    return { status: 'missing_data', findings, auditEntries };
  }

  /* --- rule 5: material differences grouped by category ------------- */
  interface Category {
    readonly key: string;
    readonly label: string;
    readonly bank: (r: ComparisonRow) => number | null;
    readonly recalc: (r: ComparisonRow) => number | null;
  }
  const categories: readonly Category[] = [
    { key: 'installment', label: 'δόσης', bank: (r) => centsOf(r.bankInstallment), recalc: (r) => centsOf(r.recalculatedInstallment) },
    { key: 'interest', label: 'τόκων', bank: (r) => centsOf(r.bankInterest), recalc: (r) => centsOf(r.recalculatedInterest) },
    { key: 'principal', label: 'χρεολυσίου', bank: (r) => centsOf(r.bankPrincipal), recalc: (r) => centsOf(r.recalculatedPrincipal) },
    { key: 'balance', label: 'υπολοίπου κεφαλαίου', bank: (r) => centsOf(r.bankBalance), recalc: (r) => centsOf(r.recalculatedBalance) },
  ];

  let anyMaterial = false;

  for (const cat of categories) {
    const affected: { period: string; dueDate: string; diff: number }[] = [];
    for (const row of comparison.rows) {
      const b = cat.bank(row);
      const rc = cat.recalc(row);
      if (b === null || rc === null) continue; // missing handled separately
      const d = b - rc; // locked convention
      if (Math.abs(d) > threshold) {
        affected.push({ period: String(row.period), dueDate: row.dueDate, diff: d });
      }
    }
    if (affected.length === 0) continue;
    anyMaterial = true;
    const total = affected.reduce((s, a) => s + a.diff, 0);
    addFinding({
      level: 'deviation',
      title: `Οικονομική απόκλιση ${cat.label}`,
      description:
        `Τεχνικό οικονομικό εύρημα: σε ${affected.length} περιόδους εντοπίστηκε οικονομική απόκλιση ${cat.label} άνω του κατωφλίου σημαντικότητας, με συνολικό υπογεγραμμένο μέγεθος ${fmt(total, currency)} βάσει διαθέσιμων δεδομένων (${signExplanation(total)}). Απαιτείται έλεγχος.`,
      affectedRowIds: affected.map((a) => a.period),
      affectedPeriods: affected.map((a) => a.dueDate),
      amountCents: total,
      count: affected.length,
      source: 'comparison',
    });
  }

  /* --- rule 4: clean comparison info finding ------------------------- */
  if (!anyMaterial && comparison.status === 'success' && includeZero) {
    addFinding({
      level: 'info',
      title: 'Καμία απόκλιση άνω κατωφλίου',
      description:
        'Δεν εντοπίστηκε οικονομική απόκλιση άνω του κατωφλίου σημαντικότητας στα συγκρινόμενα δεδομένα.',
      affectedRowIds: [],
      affectedPeriods: [],
      amountCents: 0,
      count: comparison.rows.length,
      source: 'comparison',
    });
  }

  /* --- rule 7: audit-derived findings -------------------------------- */
  const auditFindingSpecs: ReadonlyArray<{
    code: string;
    level: TechnicalFindingLevel;
    title: string;
  }> = [
    { code: SC.BANK_VALUE_MISSING, level: 'missing_data', title: 'Ελλιπή δεδομένα τράπεζας / fund' },
    { code: SC.RECALC_VALUE_MISSING, level: 'missing_data', title: 'Ελλιπή δεδομένα επανυπολογισμού' },
    { code: SC.UNMATCHED_BANK_ROW, level: 'missing_data', title: 'Μη αντιστοιχισμένες γραμμές τράπεζας / fund' },
    { code: SC.UNMATCHED_RECALC_ROW, level: 'missing_data', title: 'Μη αντιστοιχισμένες γραμμές επανυπολογισμού' },
    { code: SC.AMBIGUOUS_DATE_MATCH, level: 'requires_review', title: 'Μη μονοσήμαντη αντιστοίχιση ημερομηνιών' },
    { code: SC.MATERIAL_DIFFERENCE, level: 'requires_review', title: 'Περίοδοι με ουσιώδη οικονομική απόκλιση' },
  ];

  for (const spec of auditFindingSpecs) {
    const matches = comparison.auditEntries.filter((e) => e.code === spec.code);
    for (const e of matches) {
      const ctx = (e.context ?? {}) as Record<string, unknown>;
      const rowRefs = Array.isArray(ctx['rowRefs']) ? (ctx['rowRefs'] as string[]) : [];
      const occurrences =
        typeof ctx['occurrences'] === 'number' ? (ctx['occurrences'] as number) : rowRefs.length || 1;
      addFinding({
        level: spec.level,
        title: spec.title,
        description: e.message,
        affectedRowIds: rowRefs,
        affectedPeriods: [],
        amountCents: null,
        count: occurrences,
        source: 'audit',
      });
    }
  }

  /* --- rule 6: summary finding ---------------------------------------- */
  const s = comparison.summary;
  if (s !== null) {
    const totalText =
      s.totalEconomicDifferenceCents === null
        ? 'Η συνολική οικονομική διαφορά δεν οριστικοποιείται λόγω ελλιπών δεδομένων.'
        : `Συνολική οικονομική διαφορά ${fmt(s.totalEconomicDifferenceCents, currency)} (${signExplanation(s.totalEconomicDifferenceCents)}).`;
    addFinding({
      level: 'info',
      title: 'Σύνοψη σύγκρισης με τραπεζικά δεδομένα',
      description:
        `Σύγκριση με τραπεζικά δεδομένα βάσει διαθέσιμων δεδομένων: ${s.comparedRowCount} συγκρινόμενες περίοδοι, ` +
        `${s.excludedRowCount} εξαιρέθηκαν λόγω ελλιπών στοιχείων, ` +
        `${s.unmatchedBankRowCount} μη αντιστοιχισμένες γραμμές τράπεζας / fund, ` +
        `${s.unmatchedRecalcRowCount} μη αντιστοιχισμένες γραμμές επανυπολογισμού, ` +
        `${s.rowsRequiringReviewCount} περίοδοι απαιτούν έλεγχο. ${totalText}`,
      affectedRowIds: [],
      affectedPeriods: [],
      amountCents: s.totalEconomicDifferenceCents,
      count: s.comparedRowCount,
      source: 'summary',
    });
  }

  /* --- status ----------------------------------------------------------- */
  const anyReviewFinding = findings.some(
    (f) => f.level === 'requires_review' || f.level === 'deviation' || !f.reportSafe,
  );
  const status: FindingsStatus =
    comparison.status === 'requires_review' || anyReviewFinding
      ? 'requires_review'
      : 'success';

  return { status, findings, auditEntries };
}

/** Re-exported for completeness checks in callers/tests. */
export { FORBIDDEN_REPORT_TERMS };
