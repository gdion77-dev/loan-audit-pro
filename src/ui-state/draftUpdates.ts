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
