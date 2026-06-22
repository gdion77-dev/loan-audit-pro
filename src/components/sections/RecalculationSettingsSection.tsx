/**
 * Loan Audit PRO — src/components/sections/RecalculationSettingsSection.tsx
 * ------------------------------------------------------------------
 * Connected section: «Ρυθμίσεις Επανυπολογισμού». Schedule mode,
 * rounding policy, fees per period, and — for the re-amortizing mode —
 * the installment reset frequency. Plain-language help is shown for the
 * schedule-type choice. Stateless; no engine call.
 */
import React from 'react';
import { SelectFieldStateControl } from '../fields/SelectFieldStateControl';
import { MoneyFieldStateControl } from '../fields/MoneyFieldStateControl';
import { SECTIONS, CONNECT_LATER_NOTE } from './sectionDefinitions';
import {
  SCHEDULE_MODE_OPTIONS,
  ROUNDING_MODE_OPTIONS,
  INSTALLMENT_RESET_FREQUENCY_OPTIONS,
  type RecalculationSettingsDraft,
} from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';
import { fieldValue } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'recalc_settings')!;

export interface RecalculationSettingsSectionProps {
  readonly draft: RecalculationSettingsDraft;
  readonly onSelectChange: (
    field: 'scheduleMode' | 'roundingMode' | 'installmentResetFrequency',
    next: FieldState<string>,
  ) => void;
  readonly onMoneyChange: (
    field: 'feesAndPremiumsPerPeriodCents' | 'balloonAmountCents',
    next: FieldState<number>,
  ) => void;
}

export const RecalculationSettingsSection: React.FC<RecalculationSettingsSectionProps> = ({
  draft,
  onSelectChange,
  onMoneyChange,
}) => {
  const mode = draft.scheduleMode.status === 'value' ? draft.scheduleMode.value : null;
  const isReamortizing = mode === 'reamortizing';
  const isBalloon = mode === 'balloon';
  return (
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
        {isReamortizing ? (
          <SelectFieldStateControl
            id="recalc-resetFrequency"
            label="Συχνότητα αναπροσαρμογής δόσης"
            options={INSTALLMENT_RESET_FREQUENCY_OPTIONS}
            field={draft.installmentResetFrequency}
            onChange={(next) => onSelectChange('installmentResetFrequency', next)}
          />
        ) : null}
        {isBalloon ? (
          <MoneyFieldStateControl
            id="recalc-balloon"
            label="Ποσό εφάπαξ καταβολής (balloon)"
            field={draft.balloonAmountCents}
            onChange={(next) => onMoneyChange('balloonAmountCents', next)}
            placeholder="π.χ. 3.246,82"
          />
        ) : null}
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
        <div style={{ marginTop: '6px' }}>
          <button
            type="button"
            className="lap-btn lap-btn--secondary"
            onClick={() => onMoneyChange('feesAndPremiumsPerPeriodCents', fieldValue<number>(0, 'manual'))}
          >
            Χωρίς έξοδα (μηδέν)
          </button>
          <p className="lap-field-help" style={{ marginTop: '4px' }}>
            Αν δεν υπάρχουν έξοδα/ασφάλιστρα ανά δόση, πατήστε «Χωρίς έξοδα» για να οριστεί ρητά
            το μηδέν. <strong>Μην βάζετε 1€</strong>: κάθε ποσό εδώ προστίθεται σε κάθε δόση και
            μεταβάλλει τον υπολογισμό (ιδίως την τελευταία δόση).
          </p>
        </div>
      </div>

      <div className="lap-help-block" style={{ marginTop: '12px' }}>
        <p className="lap-field-help">
          <strong>Σταθερή τοκοχρεολυτική δόση:</strong> ίδιο συνολικό ποσό δόσης σε όλη τη
          διάρκεια (η συνήθης μορφή σε δάνεια σταθερού επιτοκίου). Επιλέξτε την όταν η σύμβαση
          ορίζει αμετάβλητη μηνιαία δόση.
        </p>
        <p className="lap-field-help">
          <strong>Κυμαινόμενη τοκοχρεολυτική δόση (αναπροσαρμοζόμενη):</strong> η δόση
          επανυπολογίζεται σε κάθε αλλαγή του δείκτη (π.χ. Euribor), στο τρέχον υπόλοιπο και τις
          εναπομείνασες δόσεις, με σταθερή λήξη. Αυτή είναι η σωστή επιλογή για τα περισσότερα
          δάνεια κυμαινόμενου επιτοκίου, όπου η δόση μεταβάλλεται.
        </p>
        <p className="lap-field-help">
          <strong>Ίση δόση κεφαλαίου:</strong> σταθερό κεφάλαιο κάθε περίοδο συν τους τρέχοντες
          τόκους· η συνολική δόση μειώνεται σταδιακά. Επιλέξτε την όταν η σύμβαση ορίζει σταθερό
          χρεολύσιο.
        </p>
        <p className="lap-field-help">
          <strong>Δόση με υπόλοιπο (balloon):</strong> ένα μέρος της οφειλής αποπληρώνεται σε
          κανονικές δόσεις και ένα υπόλοιπο ποσό καταβάλλεται εφάπαξ στη λήξη. Δηλώνετε ως
          «Κεφάλαιο» το σύνολο (επ’ αυτού τρέχουν οι τόκοι) και ως «Ποσό εφάπαξ καταβολής» το
          υπόλοιπο που πληρώνεται στο τέλος. Οι κανονικές δόσεις απομειώνουν το υπόλοιπο μέχρι το
          ποσό αυτό· η τελευταία δόση το περιλαμβάνει.
        </p>
        {isBalloon ? (
          <p className="lap-field-help">
            Παράδειγμα: οφειλή 36.401 € με 3.246,82 € εφάπαξ στη λήξη σε 61 δόσεις → 60 σταθερές
            δόσεις και μια τελευταία αυξημένη που περιλαμβάνει τις 3.246,82 €.
          </p>
        ) : null}
        {isReamortizing ? (
          <p className="lap-field-help">
            Η <strong>συχνότητα αναπροσαρμογής</strong> ορίζει κάθε πότε η τράπεζα ξαναϋπολογίζει
            τη δόση. Συχνά συμπίπτει με τον δείκτη (Euribor 3M → ανά 3 μήνες), αλλά πολλές τράπεζες
            αναπροσαρμόζουν μηνιαία ακόμη και με δείκτη τριμήνου — δείτε τη σύμβασή σας.
          </p>
        ) : null}
      </div>

      <p className="lap-card__note">{CONNECT_LATER_NOTE}</p>
    </section>
  );
};
