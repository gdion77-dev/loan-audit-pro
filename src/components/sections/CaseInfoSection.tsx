/**
 * Loan Audit PRO — src/components/sections/CaseInfoSection.tsx
 * ------------------------------------------------------------------
 * First connected section: «Στοιχεία Υπόθεσης». Renders four text
 * field controls bound to the CaseInfoDraft. It owns no state — it
 * receives the draft section and an onChange callback from AppShell
 * and reports field updates upward. No engine call, no calculation.
 */
import React from 'react';
import { TextFieldStateControl } from '../fields/TextFieldStateControl';
import { SECTIONS, CONNECT_LATER_NOTE } from './sectionDefinitions';
import type { CaseInfoDraft } from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'case_info')!;

export interface CaseInfoSectionProps {
  readonly draft: CaseInfoDraft;
  readonly onFieldChange: (field: keyof CaseInfoDraft, next: FieldState<string>) => void;
}

export const CaseInfoSection: React.FC<CaseInfoSectionProps> = ({ draft, onFieldChange }) => (
  <section className="lap-card" aria-label={def.title}>
    <h2 className="lap-card__title">{def.title}</h2>
    <p className="lap-card__explanation">{def.explanation}</p>

    <div className="lap-form-grid">
      <TextFieldStateControl
        id="case-debtorName"
        label="Οφειλέτης"
        field={draft.debtorName}
        onChange={(next) => onFieldChange('debtorName', next)}
      />
      <TextFieldStateControl
        id="case-contractNumber"
        label="Αριθμός σύμβασης"
        field={draft.contractNumber}
        onChange={(next) => onFieldChange('contractNumber', next)}
      />
      <TextFieldStateControl
        id="case-institution"
        label="Τράπεζα / Fund"
        field={draft.institution}
        onChange={(next) => onFieldChange('institution', next)}
      />
      <TextFieldStateControl
        id="case-servicer"
        label="Servicer"
        field={draft.servicer}
        onChange={(next) => onFieldChange('servicer', next)}
      />
    </div>

    <p className="lap-card__note">{CONNECT_LATER_NOTE}</p>
  </section>
);
