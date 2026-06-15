/**
 * Loan Audit PRO — src/components/sections/RecalculationSettingsSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Ρυθμίσεις Επανυπολογισμού». Two select fields
 * (schedule mode, rounding policy) and one money field (fees /
 * premiums per period, stored as integer cents), bound to the
 * RecalculationSettingsDraft. Stateless — receives the draft section
 * and onChange callbacks from AppShell. No engine call.
 */
import React from 'react';
import { SelectFieldStateControl } from '../fields/SelectFieldStateControl';
import { MoneyFieldStateControl } from '../fields/MoneyFieldStateControl';
import { SECTIONS, CONNECT_LATER_NOTE } from './sectionDefinitions';
import {
  SCHEDULE_MODE_OPTIONS,
  ROUNDING_MODE_OPTIONS,
  type RecalculationSettingsDraft,
} from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'recalc_settings')!;

export interface RecalculationSettingsSectionProps {
  readonly draft: RecalculationSettingsDraft;
  readonly onSelectChange: (
    field: 'scheduleMode' | 'roundingMode',
    next: FieldState<string>,
  ) => void;
  readonly onMoneyChange: (
    field: 'feesAndPremiumsPerPeriodCents',
    next: FieldState<number>,
  ) => void;
}

export const RecalculationSettingsSection: React.FC<RecalculationSettingsSectionProps> = ({
  draft,
  onSelectChange,
  onMoneyChange,
}) => (
  <section className="lap-card" aria-label={def.title}>
    <h2 className="lap-card__title">{def.title}</h2>
    <p className="lap-card__explanation">{def.explanation}</p>

    <div className="lap-form-grid">
      <SelectFieldStateControl
        id="recalc-scheduleMode"
        label="Τύπος επανυπολογισμού"
        options={SCHEDULE_MODE_OPTIONS}
        field={draft.scheduleMode}
        onChange={(next) => onSelectChange('scheduleMode', next)}
      />
      <SelectFieldStateControl
        id="recalc-roundingMode"
        label="Πολιτική στρογγυλοποίησης"
        options={ROUNDING_MODE_OPTIONS}
        field={draft.roundingMode}
        onChange={(next) => onSelectChange('roundingMode', next)}
      />
      <MoneyFieldStateControl
        id="recalc-fees"
        label="Έξοδα / ασφάλιστρα ανά περίοδο"
        field={draft.feesAndPremiumsPerPeriodCents}
        onChange={(next) => onMoneyChange('feesAndPremiumsPerPeriodCents', next)}
        placeholder="π.χ. 15,00"
      />
    </div>

    <p className="lap-card__note">{CONNECT_LATER_NOTE}</p>
  </section>
);
