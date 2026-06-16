/**
 * Loan Audit PRO — src/components/sections/ActualPaymentsSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Πραγματικές Καταβολές». A small editable draft
 * table for manual entry of actual debtor payments. The amount cell
 * is a MoneyFieldStateControl (value / explicit_zero / unknown —
 * blanks and invalid input never become 0); date, schedule-row match
 * and note are text controls. Stateless — receives the draft and
 * add/update/remove callbacks from AppShell. No engine call, no
 * conversion to domain ActualPayment (deferred to a later step).
 */
import React from 'react';
import { TextFieldStateControl } from '../fields/TextFieldStateControl';
import { MoneyFieldStateControl } from '../fields/MoneyFieldStateControl';
import { SelectFieldStateControl, type SelectOption } from '../fields/SelectFieldStateControl';
import { SECTIONS } from './sectionDefinitions';
import { isoToDisplay } from '../../ui-state/dateDisplay';
import { formatMoneyGreek } from '../../domain/money';
import type {
  ActualPaymentsDraft,
  ActualPaymentDraftRow,
  BankScheduleDraft,
} from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';

const def = SECTIONS.find((s) => s.id === 'actual_payments')!;

export interface ActualPaymentsSectionProps {
  readonly draft: ActualPaymentsDraft;
  readonly bankScheduleDraft?: BankScheduleDraft;
  readonly pipelineResult?: LoanAuditPipelineResult | null;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (index: number) => void;
  readonly onRowTextChange: (
    index: number,
    field: 'paymentDate' | 'matchedScheduleRowId' | 'note',
    next: FieldState<string>,
  ) => void;
  readonly onRowMoneyChange: (index: number, field: 'amountCents', next: FieldState<number>) => void;
}

/**
 * Build dropdown options so the user picks a readable «#3 · 04.10.2024 ·
 * 1.115,23 €» instead of typing an opaque internal row id. The stored
 * code stays the real row id (e.g. AI-003), so the locked reconciliation
 * engine is unaffected. Exactly one «unknown» option represents «δεν
 * έχει αντιστοιχιστεί».
 *
 * Primary source: the schedule generated in tab 4 («Παραγωγή
 * Δοσολογίου»), available as soon as that one step is done — no need to
 * run the full study first. Falls back to the study's own recalculated
 * schedule for users who already executed it.
 */
function buildScheduleOptions(
  bankScheduleDraft: ActualPaymentsSectionProps['bankScheduleDraft'],
  pipelineResult: ActualPaymentsSectionProps['pipelineResult'],
): readonly SelectOption[] {
  const options: SelectOption[] = [
    { code: '__unmatched__', label: '— Χωρίς αντιστοίχιση —', unknown: true },
  ];

  const draftRows = bankScheduleDraft?.rows ?? [];
  if (draftRows.length > 0) {
    draftRows.forEach((row, i) => {
      const rowId = row.rowId.value;
      if (rowId === null) return;
      const date = row.dueDate.value ? isoToDisplay(row.dueDate.value) : '';
      const amount =
        row.installmentCents.value !== null
          ? formatMoneyGreek({ cents: row.installmentCents.value, currency: 'EUR' })
          : '';
      const parts = [`#${i + 1}`];
      if (date) parts.push(date);
      if (amount) parts.push(amount);
      options.push({ code: rowId, label: parts.join(' · ') });
    });
    return options;
  }

  const recalcRows = pipelineResult?.recalcScheduleResult?.rows ?? [];
  recalcRows.forEach((row, i) => {
    const date = row.dueDate ? isoToDisplay(row.dueDate) : '';
    const amount = row.installment ? formatMoneyGreek(row.installment) : '';
    const parts = [`#${i + 1}`];
    if (date) parts.push(date);
    if (amount) parts.push(amount);
    options.push({ code: row.rowId, label: parts.join(' · ') });
  });
  return options;
}

export const ActualPaymentsSection: React.FC<ActualPaymentsSectionProps> = ({
  draft,
  bankScheduleDraft,
  pipelineResult,
  onAddRow,
  onRemoveRow,
  onRowTextChange,
  onRowMoneyChange,
}) => {
  const scheduleOptions = buildScheduleOptions(bankScheduleDraft, pipelineResult);
  const hasSchedule = scheduleOptions.length > 1;
  return (
  <section className="lap-card" aria-label={def.title}>
    <h2 className="lap-card__title">{def.title}</h2>
    <p className="lap-card__explanation">{def.explanation}</p>
    <p className="lap-card__note">
      Χειροκίνητη καταχώριση πραγματικών καταβολών — η εισαγωγή από Excel θα προστεθεί σε επόμενο βήμα.
    </p>
    {!hasSchedule ? (
      <p className="lap-card__note">
        Για να αντιστοιχίσετε μια καταβολή με συγκεκριμένη περίοδο από λίστα, παράγετε
        πρώτα το δοσολόγιο (καρτέλα «Δοσολόγιο Τράπεζας / Fund» → «Παραγωγή Δοσολογίου»).
        Μέχρι τότε μπορείτε να καταχωρίσετε τον κωδικό γραμμής χειροκίνητα.
      </p>
    ) : null}

    <button type="button" className="lap-btn" onClick={() => onAddRow()}>
      Προσθήκη καταβολής
    </button>

    {draft.rows.length === 0 ? (
      <p className="lap-empty-state">Δεν έχουν καταχωρηθεί πραγματικές καταβολές.</p>
    ) : (
      <table className="lap-table">
        <thead>
          <tr>
            <th>Ημερομηνία καταβολής</th>
            <th>Ποσό καταβολής</th>
            <th>Αντιστοίχιση με γραμμή δοσολογίου</th>
            <th>Σημείωση</th>
            <th>Ενέργειες</th>
          </tr>
        </thead>
        <tbody>
          {draft.rows.map((row: ActualPaymentDraftRow, index: number) => {
            const key = row.paymentId.value ?? String(index);
            return (
              <tr key={key}>
                <td>
                  <TextFieldStateControl
                    id={`pay-${key}-date`}
                    label="Ημερομηνία καταβολής"
                    field={row.paymentDate}
                    onChange={(next) => onRowTextChange(index, 'paymentDate', next)}
                    placeholder="2024-01-31"
                  />
                </td>
                <td>
                  <MoneyFieldStateControl
                    id={`pay-${key}-amount`}
                    label="Ποσό καταβολής"
                    field={row.amountCents}
                    onChange={(next) => onRowMoneyChange(index, 'amountCents', next)}
                  />
                </td>
                <td>
                  {hasSchedule ? (
                    <SelectFieldStateControl
                      id={`pay-${key}-match`}
                      label="Αντιστοίχιση με γραμμή δοσολογίου"
                      options={scheduleOptions}
                      field={row.matchedScheduleRowId}
                      onChange={(next) => onRowTextChange(index, 'matchedScheduleRowId', next)}
                    />
                  ) : (
                    <TextFieldStateControl
                      id={`pay-${key}-match`}
                      label="Αντιστοίχιση με γραμμή δοσολογίου"
                      field={row.matchedScheduleRowId}
                      onChange={(next) => onRowTextChange(index, 'matchedScheduleRowId', next)}
                      placeholder="π.χ. AI-001"
                    />
                  )}
                </td>
                <td>
                  <TextFieldStateControl
                    id={`pay-${key}-note`}
                    label="Σημείωση"
                    field={row.note}
                    onChange={(next) => onRowTextChange(index, 'note', next)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="lap-btn lap-btn--danger"
                    onClick={() => onRemoveRow(index)}
                  >
                    Διαγραφή
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
  </section>
  );
};
