/**
 * Loan Audit PRO — src/components/sections/BankScheduleSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Δοσολόγιο Τράπεζας / Fund». A small editable
 * draft table for manual schedule entry. Each economic cell is a
 * MoneyFieldStateControl (value / explicit_zero / unknown — blanks
 * and invalid input never become 0); the due date and note are text
 * controls. Stateless — receives the draft and add/update/remove
 * callbacks from AppShell. No engine call, no conversion to domain
 * BankScheduleRow (deferred to a later step).
 */
import React from 'react';
import { TextFieldStateControl } from '../fields/TextFieldStateControl';
import { MoneyFieldStateControl } from '../fields/MoneyFieldStateControl';
import { SelectFieldStateControl } from '../fields/SelectFieldStateControl';
import { SECTIONS } from './sectionDefinitions';
import {
  DAY_COUNT_CONVENTION_OPTIONS,
  type BankScheduleDraft,
  type BankScheduleDraftRow,
} from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'bank_schedule')!;

const MONEY_FIELDS = ['installmentCents', 'principalCents', 'interestCents', 'balanceCents'] as const;
type MoneyField = (typeof MONEY_FIELDS)[number];

export interface BankScheduleSectionProps {
  readonly draft: BankScheduleDraft;
  readonly onAddRow: () => void;
  readonly onRemoveRow: (index: number) => void;
  readonly onRowTextChange: (index: number, field: 'dueDate' | 'note', next: FieldState<string>) => void;
  readonly onRowMoneyChange: (index: number, field: MoneyField, next: FieldState<number>) => void;
  readonly onDayCountChange: (next: FieldState<string>) => void;
  readonly onGenerateSchedule: () => void;
  readonly generationMessage: string | null;
}

export const BankScheduleSection: React.FC<BankScheduleSectionProps> = ({
  draft,
  onAddRow,
  onRemoveRow,
  onRowTextChange,
  onRowMoneyChange,
  onDayCountChange,
  onGenerateSchedule,
  generationMessage,
}) => {
  const hasRows = draft.rows.length > 0;
  return (
  <section className="lap-card" aria-label={def.title}>
    <h2 className="lap-card__title">{def.title}</h2>
    <p className="lap-card__explanation">{def.explanation}</p>
    <p className="lap-card__note">
      Χειροκίνητη καταχώριση δοσολογίου — η εισαγωγή από Excel θα προστεθεί σε επόμενο βήμα.
    </p>
    <p className="lap-card__note">
      Μπορείτε να καταχωρήσετε γραμμές χειροκίνητα ή να δημιουργήσετε τεχνικό δοσολόγιο βάσει των
      δηλωμένων όρων.
    </p>

    <div className="lap-form-grid">
      <SelectFieldStateControl
        id="bank-dayCountConvention"
        label="Σύμβαση ημερομέτρησης"
        options={DAY_COUNT_CONVENTION_OPTIONS}
        field={draft.dayCountConvention}
        onChange={(next) => onDayCountChange(next)}
      />
    </div>

    <div className="lap-btn-row">
      <button type="button" className="lap-btn" onClick={() => onAddRow()}>
        Προσθήκη γραμμής
      </button>
      <button type="button" className="lap-btn lap-btn--secondary" onClick={() => onGenerateSchedule()}>
        {hasRows ? 'Αντικατάσταση υπάρχοντων γραμμών' : 'Δημιουργία δοσολογίου'}
      </button>
    </div>

    {hasRows ? (
      <p className="lap-card__note">
        Υπάρχουν ήδη καταχωρημένες γραμμές. Η δημιουργία θα τις αντικαταστήσει με τεχνικά παραγόμενο
        δοσολόγιο βάσει των δηλωμένων όρων.
      </p>
    ) : null}

    {generationMessage !== null ? (
      <p className="lap-status" role="status">
        {generationMessage}
      </p>
    ) : null}

    {draft.rows.length === 0 ? (
      <p className="lap-empty-state">Δεν έχουν καταχωρηθεί γραμμές δοσολογίου.</p>
    ) : (
      <table className="lap-table">
        <thead>
          <tr>
            <th>Ημερομηνία δόσης</th>
            <th>Δόση</th>
            <th>Χρεολύσιο</th>
            <th>Τόκος</th>
            <th>Υπόλοιπο</th>
            <th>Σημείωση</th>
            <th>Ενέργειες</th>
          </tr>
        </thead>
        <tbody>
          {draft.rows.map((row: BankScheduleDraftRow, index: number) => {
            const key = row.rowId.value ?? String(index);
            return (
              <tr key={key}>
                <td>
                  <TextFieldStateControl
                    id={`bank-${key}-dueDate`}
                    label="Ημερομηνία δόσης"
                    field={row.dueDate}
                    onChange={(next) => onRowTextChange(index, 'dueDate', next)}
                    placeholder="2024-01-31"
                  />
                </td>
                <td>
                  <MoneyFieldStateControl
                    id={`bank-${key}-installment`}
                    label="Δόση"
                    field={row.installmentCents}
                    onChange={(next) => onRowMoneyChange(index, 'installmentCents', next)}
                  />
                </td>
                <td>
                  <MoneyFieldStateControl
                    id={`bank-${key}-principal`}
                    label="Χρεολύσιο"
                    field={row.principalCents}
                    onChange={(next) => onRowMoneyChange(index, 'principalCents', next)}
                  />
                </td>
                <td>
                  <MoneyFieldStateControl
                    id={`bank-${key}-interest`}
                    label="Τόκος"
                    field={row.interestCents}
                    onChange={(next) => onRowMoneyChange(index, 'interestCents', next)}
                  />
                </td>
                <td>
                  <MoneyFieldStateControl
                    id={`bank-${key}-balance`}
                    label="Υπόλοιπο"
                    field={row.balanceCents}
                    onChange={(next) => onRowMoneyChange(index, 'balanceCents', next)}
                  />
                </td>
                <td>
                  <TextFieldStateControl
                    id={`bank-${key}-note`}
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
