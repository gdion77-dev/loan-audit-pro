/**
 * Loan Audit PRO — src/components/sections/RateConfigSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Επιτόκιο». Two select fields (regime kind,
 * Ν.128/75 status) and two numeric fields (annual rate %, spread %),
 * all bound to the RateConfigDraft. Stateless — receives the draft
 * section and onChange callbacks from AppShell. No engine call.
 */
import React from 'react';
import { SelectFieldStateControl } from '../fields/SelectFieldStateControl';
import { NumberFieldStateControl } from '../fields/NumberFieldStateControl';
import { SECTIONS, CONNECT_LATER_NOTE } from './sectionDefinitions';
import {
  REGIME_KIND_OPTIONS,
  LAW128_STATUS_OPTIONS,
  type RateConfigDraft,
} from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'rate_config')!;

export interface RateConfigSectionProps {
  readonly draft: RateConfigDraft;
  readonly onSelectChange: (
    field: 'regimeKind' | 'law128Status',
    next: FieldState<string>,
  ) => void;
  readonly onNumberChange: (
    field: 'annualRatePercent' | 'spreadPercent' | 'law128Percent',
    next: FieldState<number>,
  ) => void;
}

export const RateConfigSection: React.FC<RateConfigSectionProps> = ({
  draft,
  onSelectChange,
  onNumberChange,
}) => {
  const law128AddedSeparately =
    draft.law128Status.status === 'value' && draft.law128Status.value === 'added_separately';
  return (
  <section className="lap-card" aria-label={def.title}>
    <h2 className="lap-card__title">{def.title}</h2>
    <p className="lap-card__explanation">{def.explanation}</p>

    <div className="lap-form-grid">
      <SelectFieldStateControl
        id="rate-regimeKind"
        label="Καθεστώς επιτοκίου"
        options={REGIME_KIND_OPTIONS}
        field={draft.regimeKind}
        onChange={(next) => onSelectChange('regimeKind', next)}
      />
      <NumberFieldStateControl
        id="rate-annualRatePercent"
        label="Σταθερό ετήσιο επιτόκιο %"
        field={draft.annualRatePercent}
        onChange={(next) => onNumberChange('annualRatePercent', next)}
        placeholder="π.χ. 6,00"
      />
      <p className="lap-field-help">
        Παράδειγμα: για 6,10% καταχωρήστε 6.10 — όχι 610.
      </p>
      <NumberFieldStateControl
        id="rate-spreadPercent"
        label="Περιθώριο %"
        field={draft.spreadPercent}
        onChange={(next) => onNumberChange('spreadPercent', next)}
        placeholder="π.χ. 2,50"
      />
      <SelectFieldStateControl
        id="rate-law128Status"
        label="Καθεστώς εισφοράς Ν.128/75"
        options={LAW128_STATUS_OPTIONS}
        field={draft.law128Status}
        onChange={(next) => onSelectChange('law128Status', next)}
      />
      {law128AddedSeparately ? (
        <NumberFieldStateControl
          id="rate-law128Percent"
          label="Εισφορά Ν.128/75 %"
          field={draft.law128Percent}
          onChange={(next) => onNumberChange('law128Percent', next)}
          placeholder="π.χ. 0,60"
        />
      ) : null}
    </div>

    <p className="lap-card__note">{CONNECT_LATER_NOTE}</p>
    <p className="lap-card__note">
      Σε σταθερό επιτόκιο, το εφαρμοζόμενο επιτόκιο του δοσολογίου = σταθερό επιτόκιο
      {' '}+ εισφορά Ν.128/75 (όταν προστίθεται χωριστά). Το περιθώριο αφορά μόνο το κυμαινόμενο
      καθεστώς (δείκτης + περιθώριο).
    </p>
  </section>
  );
};
