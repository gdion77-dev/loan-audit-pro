/**
 * Loan Audit PRO — src/components/sections/LoanTermsSection.tsx
 * ------------------------------------------------------------------
 * Second connected section: «Όροι Δανείου / Ρύθμισης». Renders a
 * money control (principal, stored as integer cents), a numeric
 * control (term in months) and two text controls (start/end dates).
 * Stateless — receives the draft section and an onChange callback
 * from AppShell. No engine call, no calculation.
 */
import React from 'react';
import { MoneyFieldStateControl } from '../fields/MoneyFieldStateControl';
import { NumberFieldStateControl } from '../fields/NumberFieldStateControl';
import { TextFieldStateControl } from '../fields/TextFieldStateControl';
import { SECTIONS, CONNECT_LATER_NOTE } from './sectionDefinitions';
import type { LoanTermsDraft } from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';

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
}) => (
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
      <NumberFieldStateControl
        id="terms-termMonths"
        label="Διάρκεια (μήνες)"
        field={draft.termMonths}
        onChange={(next) => onNumberFieldChange('termMonths', next)}
        placeholder="π.χ. 120"
      />
      <TextFieldStateControl
        id="terms-startDate"
        label="Ημερομηνία έναρξης (ΕΕΕΕ-ΜΜ-ΗΗ)"
        field={draft.startDate}
        onChange={(next) => onTextFieldChange('startDate', next)}
        placeholder="2024-01-01"
      />
      <TextFieldStateControl
        id="terms-endDate"
        label="Ημερομηνία λήξης (ΕΕΕΕ-ΜΜ-ΗΗ)"
        field={draft.endDate}
        onChange={(next) => onTextFieldChange('endDate', next)}
        placeholder="2034-01-01"
      />
    </div>

    <p className="lap-card__note">{CONNECT_LATER_NOTE}</p>
  </section>
);
