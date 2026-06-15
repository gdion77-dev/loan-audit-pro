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
import { SECTIONS } from './sectionDefinitions';
import type { ActualPaymentsDraft, ActualPaymentDraftRow } from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'actual_payments')!;

export interface ActualPaymentsSectionProps {
  readonly draft: ActualPaymentsDraft;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (index: number) => void;
  readonly onRowTextChange: (
    index: number,
    field: 'paymentDate' | 'matchedScheduleRowId' | 'note',
    next: FieldState<string>,
  ) => void;
  readonly onRowMoneyChange: (index: number, field: 'amountCents', next: FieldState<number>) => void;
}

export const ActualPaymentsSection: React.FC<ActualPaymentsSectionProps> = ({
  draft,
  onAddRow,
  onRemoveRow,
  onRowTextChange,
  onRowMoneyChange,
}) => (
  <section className="lap-card" aria-label={def.title}>
    <h2 className="lap-card__title">{def.title}</h2>
    <p className="lap-card__explanation">{def.explanation}</p>
    <p className="lap-card__note">
      Χειροκίνητη καταχώριση πραγματικών καταβολών — η εισαγωγή από Excel θα προστεθεί σε επόμενο βήμα.
    </p>

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
                  <TextFieldStateControl
                    id={`pay-${key}-match`}
                    label="Αντιστοίχιση με γραμμή δοσολογίου"
                    field={row.matchedScheduleRowId}
                    onChange={(next) => onRowTextChange(index, 'matchedScheduleRowId', next)}
                    placeholder="π.χ. draft-row-1"
                  />
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
