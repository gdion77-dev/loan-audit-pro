/**
 * Loan Audit PRO — src/ui-state/draftUpdates.ts
 * ------------------------------------------------------------------
 * Tiny immutable update helpers for LoanAuditDraftState. Each returns
 * a NEW state object with one section field replaced — the original
 * is never mutated. Pure functions, no engine/calculation.
 */
import type {
  LoanAuditDraftState,
  BankScheduleDraftRow,
  ActualPaymentDraftRow,
} from './loanAuditDraftState';
import {
  createEmptyBankScheduleDraftRow,
  createEmptyActualPaymentDraftRow,
} from './loanAuditDraftState';
import { fieldValue } from './fieldState';

/**
 * Immutably replaces one field within one draft section. Generic over
 * the section key and the field key so the value type is checked.
 */
export function updateDraftField<
  S extends keyof LoanAuditDraftState,
  F extends keyof LoanAuditDraftState[S],
>(
  state: LoanAuditDraftState,
  section: S,
  field: F,
  value: LoanAuditDraftState[S][F],
): LoanAuditDraftState {
  return {
    ...state,
    [section]: {
      ...state[section],
      [field]: value,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Bank schedule draft rows (immutable)                                */
/* ------------------------------------------------------------------ */

let bankRowSeq = 0;

/** Immutably appends one fresh (all-unknown) bank schedule draft row. */
export function addBankScheduleDraftRow(
  state: LoanAuditDraftState,
  rowId?: string,
): LoanAuditDraftState {
  const id = rowId ?? `draft-row-${++bankRowSeq}`;
  const row = createEmptyBankScheduleDraftRow(id);
  return {
    ...state,
    bankScheduleDraft: {
      ...state.bankScheduleDraft,
      rows: [...state.bankScheduleDraft.rows, row],
    },
  };
}

/** Immutably removes the row at the given index (no-op if out of range). */
export function removeBankScheduleDraftRow(
  state: LoanAuditDraftState,
  index: number,
): LoanAuditDraftState {
  if (index < 0 || index >= state.bankScheduleDraft.rows.length) return state;
  return {
    ...state,
    bankScheduleDraft: {
      ...state.bankScheduleDraft,
      rows: state.bankScheduleDraft.rows.filter((_, i) => i !== index),
    },
  };
}

/**
 * Immutably replaces one field of one row. Generic over the field key
 * so the value type is checked. The original state, the rows array and
 * the other rows keep their references; only the edited row is rebuilt.
 */
export function updateBankScheduleDraftRowField<F extends keyof BankScheduleDraftRow>(
  state: LoanAuditDraftState,
  index: number,
  field: F,
  value: BankScheduleDraftRow[F],
): LoanAuditDraftState {
  if (index < 0 || index >= state.bankScheduleDraft.rows.length) return state;
  const rows = state.bankScheduleDraft.rows.map((row, i) =>
    i === index ? { ...row, [field]: value } : row,
  );
  return {
    ...state,
    bankScheduleDraft: { ...state.bankScheduleDraft, rows },
  };
}

/* ------------------------------------------------------------------ */
/* Actual payment draft rows (immutable)                               */
/* ------------------------------------------------------------------ */

let paymentRowSeq = 0;

/** Immutably appends one fresh (all-unknown) actual payment draft row. */
export function addActualPaymentDraftRow(
  state: LoanAuditDraftState,
  paymentId?: string,
): LoanAuditDraftState {
  const id = paymentId ?? `draft-payment-${++paymentRowSeq}`;
  const row = createEmptyActualPaymentDraftRow(id);
  return {
    ...state,
    actualPaymentsDraft: {
      ...state.actualPaymentsDraft,
      rows: [...state.actualPaymentsDraft.rows, row],
    },
  };
}

/** ISO date + N months, day clamped to month length. */
function addMonthsClampedISO(isoDate: string, months: number): string {
  const y = Number(isoDate.slice(0, 4));
  const m = Number(isoDate.slice(5, 7));
  const d = Number(isoDate.slice(8, 10));
  const total = (y * 12 + (m - 1)) + months;
  const targetY = Math.floor(total / 12);
  const targetM = (total % 12) + 1;
  const daysInTarget = new Date(Date.UTC(targetY, targetM, 0)).getUTCDate();
  const clampedD = Math.min(d, daysInTarget);
  return `${targetY}-${String(targetM).padStart(2, '0')}-${String(clampedD).padStart(2, '0')}`;
}

export interface BulkActualPaymentSpec {
  readonly count: number;
  readonly amountCents: number;
  readonly firstDateISO: string;
  readonly stepMonths: number;
}

/**
 * Adds many identical actual payments at once: same amount, dates
 * stepping by `stepMonths` from `firstDateISO`. When `scheduleRows`
 * is provided, each generated payment is auto-matched to the schedule
 * row that shares its due date. Unmatched dates are left unmatched (no
 * silent assumption). Pure and immutable; no financial calculation.
 */
export function addManyActualPaymentDraftRows(
  state: LoanAuditDraftState,
  spec: BulkActualPaymentSpec,
  scheduleRows?: ReadonlyArray<{ rowId: string; dueDateISO: string | null }>,
): LoanAuditDraftState {
  const count = Math.max(0, Math.floor(spec.count));
  if (count === 0) return state;
  const step = spec.stepMonths > 0 ? Math.floor(spec.stepMonths) : 1;

  // Build two lookups: exact ISO date, and year-month (so a payment on a
  // different day of the same month still matches that month's installment).
  const byDate = new Map<string, string>();
  const byMonth = new Map<string, string>();
  for (const r of scheduleRows ?? []) {
    if (r.dueDateISO !== null) {
      if (!byDate.has(r.dueDateISO)) byDate.set(r.dueDateISO, r.rowId);
      const ym = r.dueDateISO.slice(0, 7); // yyyy-mm
      if (!byMonth.has(ym)) byMonth.set(ym, r.rowId);
    }
  }

  const newRows: ActualPaymentDraftRow[] = [];
  for (let i = 0; i < count; i++) {
    const id = `draft-payment-${++paymentRowSeq}`;
    const dateISO = addMonthsClampedISO(spec.firstDateISO, i * step);
    const base = createEmptyActualPaymentDraftRow(id);
    const matchedRowId = byDate.get(dateISO) ?? byMonth.get(dateISO.slice(0, 7)) ?? null;
    newRows.push({
      ...base,
      paymentDate: fieldValue<string>(dateISO, 'manual'),
      amountCents: fieldValue<number>(spec.amountCents, 'manual'),
      matchedScheduleRowId:
        matchedRowId !== null ? fieldValue<string>(matchedRowId, 'manual') : base.matchedScheduleRowId,
    });
  }

  return {
    ...state,
    actualPaymentsDraft: {
      ...state.actualPaymentsDraft,
      rows: [...state.actualPaymentsDraft.rows, ...newRows],
    },
  };
}

/** Immutably removes the row at the given index (no-op if out of range). */
export function removeActualPaymentDraftRow(
  state: LoanAuditDraftState,
  index: number,
): LoanAuditDraftState {
  if (index < 0 || index >= state.actualPaymentsDraft.rows.length) return state;
  return {
    ...state,
    actualPaymentsDraft: {
      ...state.actualPaymentsDraft,
      rows: state.actualPaymentsDraft.rows.filter((_, i) => i !== index),
    },
  };
}

/**
 * Immutably replaces one field of one payment row. Generic over the
 * field key so the value type is checked. Only the edited row is
 * rebuilt; the others keep their references.
 */
export function updateActualPaymentDraftRowField<F extends keyof ActualPaymentDraftRow>(
  state: LoanAuditDraftState,
  index: number,
  field: F,
  value: ActualPaymentDraftRow[F],
): LoanAuditDraftState {
  if (index < 0 || index >= state.actualPaymentsDraft.rows.length) return state;
  const rows = state.actualPaymentsDraft.rows.map((row, i) =>
    i === index ? { ...row, [field]: value } : row,
  );
  return {
    ...state,
    actualPaymentsDraft: { ...state.actualPaymentsDraft, rows },
  };
}
