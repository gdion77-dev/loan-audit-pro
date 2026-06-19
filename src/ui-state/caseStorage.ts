/**
 * Loan Audit PRO — src/ui-state/caseStorage.ts
 * ------------------------------------------------------------------
 * Persistence for saved loan-audit cases. The app is a static site
 * with no backend, so cases are stored two ways:
 *   1. A LOCAL list in the browser (localStorage) for quick reuse on
 *      the same machine.
 *   2. EXPORT / IMPORT of a portable .json file, so a case can be
 *      moved between machines (e.g. via a synced cloud folder). This
 *      is what makes work-at-office → continue-at-home possible
 *      without a server.
 *
 * The draft state is a plain object of FieldStates, so it serialises
 * to JSON directly. We wrap it with light metadata (id, name, dates,
 * schema version) for the saved-cases list.
 *
 * Pure data layer — no React, no engine, no calculation. All browser
 * access is guarded so this module is safe to import in tests/Node.
 */
import type { LoanAuditDraftState } from './loanAuditDraftState';

const STORAGE_KEY = 'loanAuditPro.savedCases.v1';
const SCHEMA_VERSION = 1;
const FILE_KIND = 'loan-audit-pro/case';

export interface SavedCaseMeta {
  readonly id: string;
  readonly name: string;
  readonly createdAtISO: string;
  readonly updatedAtISO: string;
}

export interface SavedCase extends SavedCaseMeta {
  readonly schemaVersion: number;
  readonly draft: LoanAuditDraftState;
}

/** The shape written to / read from an exported .json file. */
export interface CaseFile {
  readonly kind: typeof FILE_KIND;
  readonly schemaVersion: number;
  readonly name: string;
  readonly exportedAtISO: string;
  readonly draft: LoanAuditDraftState;
}

function hasLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function nowISO(): string {
  return new Date().toISOString();
}

function makeId(): string {
  // Stable-enough unique id without external deps.
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Reads all saved cases (newest first). Returns [] on any problem. */
export function listSavedCases(): SavedCase[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const cases = parsed.filter(
      (c): c is SavedCase =>
        typeof c === 'object' && c !== null && 'id' in c && 'draft' in c && 'name' in c,
    );
    return [...cases].sort((a, b) => (a.updatedAtISO < b.updatedAtISO ? 1 : -1));
  } catch {
    return [];
  }
}

function writeAll(cases: readonly SavedCase[]): boolean {
  if (!hasLocalStorage()) return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves a case to the local list. If `existingId` is provided and
 * matches, that case is updated in place; otherwise a new case is
 * created. Returns the saved case (with id/timestamps) or null on
 * failure.
 */
export function saveCase(
  name: string,
  draft: LoanAuditDraftState,
  existingId?: string,
): SavedCase | null {
  const cases = listSavedCases();
  const trimmedName = name.trim() === '' ? 'Χωρίς όνομα' : name.trim();
  const now = nowISO();

  if (existingId !== undefined) {
    const idx = cases.findIndex((c) => c.id === existingId);
    if (idx !== -1) {
      const updated: SavedCase = {
        ...cases[idx]!,
        name: trimmedName,
        draft,
        updatedAtISO: now,
      };
      const next = [...cases];
      next[idx] = updated;
      return writeAll(next) ? updated : null;
    }
  }

  const created: SavedCase = {
    id: makeId(),
    name: trimmedName,
    createdAtISO: now,
    updatedAtISO: now,
    schemaVersion: SCHEMA_VERSION,
    draft,
  };
  return writeAll([created, ...cases]) ? created : null;
}

/** Returns one saved case by id, or null. */
export function getSavedCase(id: string): SavedCase | null {
  return listSavedCases().find((c) => c.id === id) ?? null;
}

/** Removes a case from the local list. Returns true if it changed. */
export function deleteSavedCase(id: string): boolean {
  const cases = listSavedCases();
  const next = cases.filter((c) => c.id !== id);
  if (next.length === cases.length) return false;
  return writeAll(next);
}

/** Serialises a case to the portable file JSON string. */
export function serialiseCaseFile(name: string, draft: LoanAuditDraftState): string {
  const file: CaseFile = {
    kind: FILE_KIND,
    schemaVersion: SCHEMA_VERSION,
    name: name.trim() === '' ? 'Χωρίς όνομα' : name.trim(),
    exportedAtISO: nowISO(),
    draft,
  };
  return JSON.stringify(file, null, 2);
}

export interface ParsedCaseFile {
  readonly ok: boolean;
  readonly name?: string;
  readonly draft?: LoanAuditDraftState;
  readonly error?: string;
}

/**
 * Parses an imported file's text into a draft. Validates the wrapper
 * shape and schema version, but does not deeply validate the draft —
 * the adapter/validation layer already handles malformed fields.
 */
export function parseCaseFile(text: string): ParsedCaseFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Το αρχείο δεν είναι έγκυρο JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, error: 'Το αρχείο δεν έχει τη σωστή μορφή.' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.kind !== FILE_KIND) {
    return { ok: false, error: 'Το αρχείο δεν είναι αποθηκευμένη υπόθεση Loan Audit PRO.' };
  }
  if (typeof obj.draft !== 'object' || obj.draft === null) {
    return { ok: false, error: 'Το αρχείο δεν περιέχει δεδομένα υπόθεσης.' };
  }
  const name = typeof obj.name === 'string' ? obj.name : 'Εισαγόμενη υπόθεση';
  return { ok: true, name, draft: obj.draft as LoanAuditDraftState };
}
