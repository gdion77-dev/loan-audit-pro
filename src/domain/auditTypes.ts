/**
 * Loan Audit PRO — src/domain/auditTypes.ts
 * ------------------------------------------------------------------
 * Audit-trail entries. Core audit rule of the app: no silent
 * assumptions. Every default, every missing datum, every 'unknown'
 * state must become an AuditEntry that later surfaces in the UI and
 * in the report's methodology / limitations sections.
 */

export type AuditSeverity = 'info' | 'assumption' | 'warning' | 'requires_review';

export const AUDIT_SEVERITIES: readonly AuditSeverity[] = [
  'info',
  'assumption',
  'warning',
  'requires_review',
] as const;

export function isAuditSeverity(value: unknown): value is AuditSeverity {
  return (
    typeof value === 'string' &&
    (AUDIT_SEVERITIES as readonly string[]).includes(value)
  );
}

/**
 * Well-known audit codes. The type stays open (string) so later
 * engines can add codes, but these are the canonical ones referenced
 * across the app.
 */
export const AUDIT_CODES = {
  /** Καθεστώς Ν.128/75 άγνωστο — «Απαιτείται έλεγχος». */
  LAW128_UNKNOWN: 'LAW128_UNKNOWN',
  /** Σύμβαση ημερομέτρησης άγνωστη — assumption + warning. */
  DAYCOUNT_UNKNOWN: 'DAYCOUNT_UNKNOWN',
  /** Πολιτική αρνητικού δείκτη άγνωστη — διπλό σενάριο. */
  NEGATIVE_INDEX_POLICY_UNKNOWN: 'NEGATIVE_INDEX_POLICY_UNKNOWN',
  /** Ελλιπή δεδομένα δοσολογίου τράπεζας / fund. */
  MISSING_BANK_DATA: 'MISSING_BANK_DATA',
  /** Ελλιπές ιστορικό τιμών δείκτη για περίοδο. */
  MISSING_INDEX_VALUE: 'MISSING_INDEX_VALUE',
  /** Ασυμφωνία στοιχείων σύμβασης ↔ δοσολογίου — τεχνική παρατήρηση. */
  CONTRACT_SCHEDULE_MISMATCH: 'CONTRACT_SCHEDULE_MISMATCH',
  /** Σιωπηρή υπόθεση που έγινε ρητή (γενικός κωδικός). */
  EXPLICIT_ASSUMPTION: 'EXPLICIT_ASSUMPTION',
  /** Αναντιστοίχιστη πραγματική καταβολή. */
  UNMATCHED_PAYMENT: 'UNMATCHED_PAYMENT',
} as const;

export type AuditCode = (typeof AUDIT_CODES)[keyof typeof AUDIT_CODES] | (string & {});

export interface AuditEntry {
  readonly severity: AuditSeverity;
  readonly code: AuditCode;
  /** Ουδέτερη οικονομική διατύπωση (no legal conclusions). */
  readonly message: string;
  /** Structured context (period, field, values). null = none. */
  readonly context: Readonly<Record<string, unknown>> | null;
}

export class AuditError extends Error {
  override name = 'AuditError';
}

/** Factory with validation. */
export function createAuditEntry(input: {
  severity: AuditSeverity;
  code: AuditCode;
  message: string;
  context?: Record<string, unknown> | null;
}): AuditEntry {
  if (!isAuditSeverity(input.severity)) {
    throw new AuditError(`Invalid audit severity: ${String(input.severity)}`);
  }
  if (typeof input.code !== 'string' || input.code.trim() === '') {
    throw new AuditError('Audit code must be a non-empty string');
  }
  if (typeof input.message !== 'string' || input.message.trim() === '') {
    throw new AuditError('Audit message must be a non-empty string');
  }
  return Object.freeze({
    severity: input.severity,
    code: input.code,
    message: input.message,
    context: input.context ?? null,
  });
}

/** Convenience predicates used by UI / report later. */
export function hasWarnings(entries: readonly AuditEntry[]): boolean {
  return entries.some(
    (e) => e.severity === 'warning' || e.severity === 'requires_review',
  );
}

export function filterBySeverity(
  entries: readonly AuditEntry[],
  severity: AuditSeverity,
): readonly AuditEntry[] {
  return entries.filter((e) => e.severity === severity);
}
