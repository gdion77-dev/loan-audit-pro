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
import { useState } from 'react';
import { TextFieldStateControl } from '../fields/TextFieldStateControl';
import { DateFieldStateControl } from '../fields/DateFieldStateControl';
import { MoneyFieldStateControl } from '../fields/MoneyFieldStateControl';
import { SelectFieldStateControl, type SelectOption } from '../fields/SelectFieldStateControl';
import { SECTIONS } from './sectionDefinitions';
import { isoToDisplay } from '../../ui-state/dateDisplay';
import { formatMoneyGreek } from '../../domain/money';
import type {
  ActualPaymentsDraft,
  ActualPaymentDraftRow,
  BankScheduleDraft,
  ExtraChargesDraft,
} from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';
import { fieldValue, fieldUnknown } from '../../ui-state/fieldState';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';

const def = SECTIONS.find((s) => s.id === 'actual_payments')!;

export interface ActualPaymentsSectionProps {
  readonly draft: ActualPaymentsDraft;
  readonly bankScheduleDraft?: BankScheduleDraft;
  readonly pipelineResult?: LoanAuditPipelineResult | null;
  readonly onAddRow: () => void;
  readonly onBulkAdd: (spec: {
    count: number;
    amountCents: number;
    firstDateISO: string;
    stepMonths: number;
  }) => void;
  readonly onRemoveRow: (index: number) => void;
  readonly onRowTextChange: (
    index: number,
    field: 'paymentDate' | 'matchedScheduleRowId' | 'note',
    next: FieldState<string>,
  ) => void;
  readonly onRowMoneyChange: (index: number, field: 'amountCents', next: FieldState<number>) => void;
  /** Extra charges (insurance/legal) editing. */
  readonly extraCharges?: ExtraChargesDraft;
  readonly onExtraChargeAdd?: () => void;
  readonly onExtraChargeRemove?: (index: number) => void;
  readonly onExtraChargeTextChange?: (
    index: number,
    field: 'chargeDate' | 'description',
    next: FieldState<string>,
  ) => void;
  readonly onExtraChargeMoneyChange?: (index: number, field: 'amountCents', next: FieldState<number>) => void;
  /** Toggle: whether unpaid extra charges accrue default interest. */
  readonly onExtraChargeAccrualChange?: (next: FieldState<string>) => void;
  /** Toggle: allocation order of charges vs current principal. */
  readonly onExtraChargeOrderChange?: (next: FieldState<string>) => void;
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
  onBulkAdd,
  onRemoveRow,
  onRowTextChange,
  onRowMoneyChange,
  extraCharges,
  onExtraChargeAdd,
  onExtraChargeRemove,
  onExtraChargeTextChange,
  onExtraChargeMoneyChange,
  onExtraChargeAccrualChange,
  onExtraChargeOrderChange,
}) => {
  const scheduleOptions = buildScheduleOptions(bankScheduleDraft, pipelineResult);
  const hasSchedule = scheduleOptions.length > 1;

  // Local state for the bulk-add mini form (not part of the draft).
  const [bulkCount, setBulkCount] = useState('');
  const [bulkAmount, setBulkAmount] = useState('');
  const [bulkFirstDate, setBulkFirstDate] = useState('');
  const [bulkStep, setBulkStep] = useState('1');

  const parseAmountToCents = (s: string): number | null => {
    const cleaned = s.replace(/\./g, '').replace(',', '.').trim();
    if (cleaned === '' || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
    return Math.round(Number(cleaned) * 100);
  };

  const bulkCountN = Number(bulkCount);
  const bulkAmountCents = parseAmountToCents(bulkAmount);
  const bulkStepN = Number(bulkStep);
  const bulkValid =
    Number.isInteger(bulkCountN) && bulkCountN > 0 && bulkCountN <= 600 &&
    bulkAmountCents !== null && bulkAmountCents > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(bulkFirstDate) &&
    Number.isInteger(bulkStepN) && bulkStepN > 0;

  const doBulkAdd = (): void => {
    if (!bulkValid || bulkAmountCents === null) return;
    onBulkAdd({
      count: bulkCountN,
      amountCents: bulkAmountCents,
      firstDateISO: bulkFirstDate,
      stepMonths: bulkStepN,
    });
    setBulkCount('');
    setBulkAmount('');
    setBulkFirstDate('');
    setBulkStep('1');
  };

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

    <div className="lap-bulk-add" style={{ marginTop: '14px', padding: '12px', border: '1px solid var(--hair, #e2e2e2)', borderRadius: '8px' }}>
      <h3 className="lap-card__subtitle" style={{ marginTop: 0 }}>Μαζική προσθήκη ίδιων καταβολών</h3>
      <p className="lap-field-help">
        Προσθέτει πολλές ίδιες καταβολές μονομιάς (ίδιο ποσό, μηνιαία βήματα). Αν έχει παραχθεί
        δοσολόγιο, κάθε καταβολή αντιστοιχίζεται αυτόματα στη δόση με την ίδια ημερομηνία.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', gap: '3px' }}>
          Πλήθος
          <input type="text" inputMode="numeric" value={bulkCount}
            onChange={(e: { target: { value: string } }) => setBulkCount(e.target.value)}
            placeholder="π.χ. 24" style={{ width: '80px', padding: '6px' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', gap: '3px' }}>
          Ποσό (€)
          <input type="text" inputMode="decimal" value={bulkAmount}
            onChange={(e: { target: { value: string } }) => setBulkAmount(e.target.value)}
            placeholder="π.χ. 650,00" style={{ width: '110px', padding: '6px' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', gap: '3px' }}>
          Ημ/νία 1ης
          <input type="date" value={bulkFirstDate}
            onChange={(e: { target: { value: string } }) => setBulkFirstDate(e.target.value)}
            style={{ padding: '6px' }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', gap: '3px' }}>
          Βήμα (μήνες)
          <input type="text" inputMode="numeric" value={bulkStep}
            onChange={(e: { target: { value: string } }) => setBulkStep(e.target.value)}
            style={{ width: '80px', padding: '6px' }} />
        </label>
        <button type="button" className="lap-btn lap-btn--secondary" onClick={doBulkAdd} disabled={!bulkValid}>
          Προσθήκη {bulkValid ? `${bulkCountN} καταβολών` : ''}
        </button>
      </div>
    </div>

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
                  <DateFieldStateControl
                    id={`pay-${key}-date`}
                    label="Ημερομηνία καταβολής"
                    field={row.paymentDate}
                    onChange={(next) => onRowTextChange(index, 'paymentDate', next)}
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

    {onExtraChargeAdd ? (
      <div style={{ marginTop: '22px', borderTop: '1px solid var(--hair, #e2e2e2)', paddingTop: '16px' }}>
        <h3 className="lap-card__subtitle" style={{ marginTop: 0 }}>Πρόσθετες χρεώσεις (ασφάλιστρα, νομικά, έξοδα)</h3>
        <p className="lap-field-help" style={{ marginTop: 0 }}>
          Χρεώσεις σε συγκεκριμένες ημερομηνίες που αυξάνουν το οφειλόμενο της περιόδου. Μπορεί να
          συμπίπτουν με ημερομηνία δόσης. Αν δεν εξοφληθούν, μεταφέρονται ως ληξιπρόθεσμες και τοκίζονται
          με τόκο υπερημερίας όπως το κεφάλαιο.
        </p>

        {(extraCharges?.rows.length ?? 0) > 0 ? (
          <table className="lap-table" style={{ marginTop: '10px' }}>
            <thead>
              <tr>
                <th>Ημερομηνία</th>
                <th>Ποσό</th>
                <th>Περιγραφή</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {extraCharges!.rows.map((row, index) => {
                const key = row.chargeId.status === 'value' ? row.chargeId.value : `charge-${index}`;
                return (
                  <tr key={key}>
                    <td>
                      <input
                        type="date"
                        value={row.chargeDate.status === 'value' ? row.chargeDate.value : ''}
                        onChange={(e: { target: { value: string } }) =>
                          onExtraChargeTextChange?.(
                            index,
                            'chargeDate',
                            e.target.value === '' ? fieldUnknown<string>('manual') : fieldValue<string>(e.target.value, 'manual'),
                          )
                        }
                        style={{ padding: '6px' }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="π.χ. 100,00"
                        defaultValue={
                          row.amountCents.status === 'value' && row.amountCents.value !== null
                            ? formatMoneyGreek({ cents: row.amountCents.value, currency: 'EUR' })
                            : ''
                        }
                        onBlur={(e: { target: { value: string } }) => {
                          const cents = parseAmountToCents(e.target.value);
                          onExtraChargeMoneyChange?.(
                            index,
                            'amountCents',
                            cents === null ? fieldUnknown<number>('manual') : fieldValue<number>(cents, 'manual'),
                          );
                        }}
                        style={{ padding: '6px', width: '110px' }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        placeholder="π.χ. ασφάλιστρα"
                        value={row.description.status === 'value' ? row.description.value : ''}
                        onChange={(e: { target: { value: string } }) =>
                          onExtraChargeTextChange?.(
                            index,
                            'description',
                            e.target.value === '' ? fieldUnknown<string>('manual') : fieldValue<string>(e.target.value, 'manual'),
                          )
                        }
                        style={{ padding: '6px', width: '160px' }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="lap-btn lap-btn--danger"
                        onClick={() => onExtraChargeRemove?.(index)}
                      >
                        Διαγραφή
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="lap-field-help">Δεν έχουν καταχωρηθεί πρόσθετες χρεώσεις.</p>
        )}

        <button type="button" className="lap-btn" style={{ marginTop: '10px' }} onClick={() => onExtraChargeAdd()}>
          Προσθήκη χρέωσης
        </button>

        {onExtraChargeAccrualChange ? (
          <div style={{ marginTop: '14px' }}>
            <label htmlFor="charge-accrual" style={{ display: 'block', fontWeight: 600, marginBottom: '4px', fontSize: '13px' }}>
              Τόκος υπερημερίας στις πρόσθετες χρεώσεις
            </label>
            <select
              id="charge-accrual"
              value={extraCharges?.accrueInterestOnCharges.status === 'value' ? extraCharges.accrueInterestOnCharges.value : 'yes'}
              onChange={(e: { target: { value: string } }) =>
                onExtraChargeAccrualChange(fieldValue<string>(e.target.value, 'manual'))
              }
              style={{ padding: '8px', minWidth: '320px' }}
            >
              <option value="yes">Ναι — οι χρεώσεις τοκίζονται όπως το κεφάλαιο</option>
              <option value="no">Όχι — οφείλονται αλλά χωρίς τόκο υπερημερίας (συντηρητικό)</option>
            </select>
            <p className="lap-field-help" style={{ marginTop: '6px' }}>
              Επιλέξτε «Όχι» για τη συντηρητική εκδοχή, όταν δεν τεκμηριώνεται συμβατικά ότι τα
              έξοδα/ασφάλιστρα τοκίζονται αυτοτελώς. Τρέξτε και τις δύο εκδοχές για να δείτε τη
              διαφορά στους τόκους υπερημερίας.
            </p>
          </div>
        ) : null}

        {onExtraChargeOrderChange ? (
          <div style={{ marginTop: '14px' }}>
            <label htmlFor="charge-order" style={{ display: 'block', fontWeight: 600, marginBottom: '4px', fontSize: '13px' }}>
              Σειρά καταλογισμού χρεώσεων
            </label>
            <select
              id="charge-order"
              value={extraCharges?.chargesOrder.status === 'value' ? extraCharges.chargesOrder.value : 'capital_first'}
              onChange={(e: { target: { value: string } }) =>
                onExtraChargeOrderChange(fieldValue<string>(e.target.value, 'manual'))
              }
              style={{ padding: '8px', minWidth: '320px' }}
            >
              <option value="capital_first">Πρώτα κεφάλαιο, μετά χρεώσεις (αυστηρό ΑΚ 423)</option>
              <option value="charges_first">Πρώτα χρεώσεις, μετά κεφάλαιο (μέθοδος servicer/Cepal)</option>
            </select>
            <p className="lap-field-help" style={{ marginTop: '6px' }}>
              Η μέθοδος «servicer/Cepal» εξοφλεί πρώτα τα ασφάλιστρα/έξοδα και αφήνει ακάλυπτο
              κεφάλαιο. Χρησιμοποιήστε την για να αναπαραγάγετε τον υπολογισμό της τράπεζας.
            </p>
          </div>
        ) : null}
      </div>
    ) : null}
  </section>
  );
};
