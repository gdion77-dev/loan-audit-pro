/**
 * Loan Audit PRO — src/components/sections/LoanTermsSection.tsx
 * ------------------------------------------------------------------
 * Second connected section: «Όροι Δανείου / Ρύθμισης». Renders a money
 * control (principal, stored as integer cents), the term in months, and
 * two date controls. Dates are PRESENTED as dd/mm/yyyy while stored as
 * ISO. When both dates are complete the term in months is derived
 * automatically and shown read-only. Stateless — receives the draft
 * section and onChange callbacks from AppShell. No engine call.
 */
import React from 'react';
import { MoneyFieldStateControl } from '../fields/MoneyFieldStateControl';
import { NumberFieldStateControl } from '../fields/NumberFieldStateControl';
import { DateFieldStateControl } from '../fields/DateFieldStateControl';
import { SECTIONS, CONNECT_LATER_NOTE } from './sectionDefinitions';
import type { LoanTermsDraft } from '../../ui-state/loanAuditDraftState';
import { fieldValue, type FieldState } from '../../ui-state/fieldState';
import { monthsBetweenIso } from '../../ui-state/dateDisplay';

const def = SECTIONS.find((s) => s.id === 'loan_terms')!;

export interface LoanTermsSectionProps {
  readonly draft: LoanTermsDraft;
  readonly onNumberFieldChange: (
    field: 'principalCents' | 'termMonths',
    next: FieldState<number>,
  ) => void;
  readonly onTextFieldChange: (
    field: 'startDate' | 'endDate',
    next: FieldState<string>,
  ) => void;
}

export const LoanTermsSection: React.FC<LoanTermsSectionProps> = ({
  draft,
  onNumberFieldChange,
  onTextFieldChange,
}) => {
  const startIso = draft.startDate.status === 'value' ? (draft.startDate.value ?? '') : '';
  const endIso = draft.endDate.status === 'value' ? (draft.endDate.value ?? '') : '';
  const derivedMonths = monthsBetweenIso(startIso, endIso);

  // When both dates are present, the duration is derived. We push the
  // derived value upward so the rest of the app uses the same number, and
  // show the field read-only to avoid conflicting manual entries.
  const termAutoDerived = derivedMonths !== null;

  const handleStartDate = (next: FieldState<string>): void => {
    onTextFieldChange('startDate', next);
    const nIso = next.status === 'value' ? (next.value ?? '') : '';
    const months = monthsBetweenIso(nIso, endIso);
    if (months !== null) onNumberFieldChange('termMonths', fieldValue<number>(months, 'derived'));
  };
  const handleEndDate = (next: FieldState<string>): void => {
    onTextFieldChange('endDate', next);
    const nIso = next.status === 'value' ? (next.value ?? '') : '';
    const months = monthsBetweenIso(startIso, nIso);
    if (months !== null) onNumberFieldChange('termMonths', fieldValue<number>(months, 'derived'));
  };

  return (
    <section className="lap-card" aria-label={def.title}>
      <h2 className="lap-card__title">{def.title}</h2>
      <p className="lap-card__explanation">{def.explanation}</p>

      <div className="lap-form-grid">
        <MoneyFieldStateControl
          id="terms-principal"
          label="Κεφάλαιο αναφοράς"
          field={draft.principalCents}
          onChange={(next) => onNumberFieldChange('principalCents', next)}
          placeholder="π.χ. 10.000,00"
        />
        <DateFieldStateControl
          id="terms-startDate"
          label="Ημερομηνία έναρξης (ηη/μμ/εεεε)"
          field={draft.startDate}
          onChange={handleStartDate}
          placeholder="01/01/2024"
        />
        <DateFieldStateControl
          id="terms-endDate"
          label="Ημερομηνία λήξης (ηη/μμ/εεεε)"
          field={draft.endDate}
          onChange={handleEndDate}
          placeholder="01/01/2034"
        />
        {termAutoDerived ? (
          <div className="lap-field">
            <label className="lap-field__label" htmlFor="terms-termMonths-derived">
              Διάρκεια (μήνες) — αυτόματα
            </label>
            <input
              id="terms-termMonths-derived"
              type="text"
              className="lap-field__input"
              value={String(derivedMonths)}
              readOnly
            />
            <span className="lap-field__state lap-field__state--value">
              Υπολογισμένο από έναρξη/λήξη
            </span>
          </div>
        ) : (
          <NumberFieldStateControl
            id="terms-termMonths"
            label="Διάρκεια (μήνες)"
            field={draft.termMonths}
            onChange={(next) => onNumberFieldChange('termMonths', next)}
            placeholder="π.χ. 120"
          />
        )}
      </div>

      <p className="lap-card__note">{CONNECT_LATER_NOTE}</p>
      <p className="lap-card__note">
        Συμπληρώστε έναρξη και λήξη (ηη/μμ/εεεε) και η διάρκεια σε μήνες υπολογίζεται αυτόματα.
      </p>
    </section>
  );
};
