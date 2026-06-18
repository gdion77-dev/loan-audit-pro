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
  CAPITALIZE_LATE_INTEREST_OPTIONS,
  FLOATING_INDEX_TYPE_OPTIONS,
  RATE_SOURCE_RULE_OPTIONS,
  type RateConfigDraft,
} from '../../ui-state/loanAuditDraftState';
import type { FieldState } from '../../ui-state/fieldState';

const def = SECTIONS.find((s) => s.id === 'rate_config')!;

export interface RateConfigSectionProps {
  readonly draft: RateConfigDraft;
  readonly onSelectChange: (
    field:
      | 'regimeKind'
      | 'law128Status'
      | 'capitalizeLateInterestSemiAnnually'
      | 'floatingIndexType'
      | 'rateSourceRule',
    next: FieldState<string>,
  ) => void;
  readonly onNumberChange: (
    field:
      | 'annualRatePercent'
      | 'spreadPercent'
      | 'law128Percent'
      | 'lateInterestSurchargePercent'
      | 'businessDaysBeforeReset',
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
  const isFixed = draft.regimeKind.status === 'value' && draft.regimeKind.value === 'fixed';
  const isFloating = draft.regimeKind.status === 'value' && draft.regimeKind.value === 'floating';
  const rateSourceRule =
    draft.rateSourceRule.status === 'value' ? draft.rateSourceRule.value : null;
  const showBusinessDays = isFloating && rateSourceRule === 'BUSINESS_DAYS_BEFORE_RESET';
  const isMonthlyAverage = isFloating && rateSourceRule === 'MONTHLY_AVERAGE';
  const isManualRate = isFloating && rateSourceRule === 'MANUAL_RATE';
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
      {isFixed ? (
        <p className="lap-field-help">
          Σε καθεστώς «Σταθερό», αυτό το πεδίο πρέπει να περιέχει το ΣΥΝΟΛΙΚΟ σταθερό
          επιτόκιο (π.χ. βάση + περιθώριο αν υπήρχαν κατά την υπογραφή, ήδη αθροισμένα) —
          όχι μόνο ένα τμήμα του. Παράδειγμα: σταθερό 2,50% + περιθώριο 3,00% →
          καταχωρήστε 5.50 εδώ. Η εισφορά Ν.128/75 καταχωρείται ξεχωριστά παρακάτω και
          προστίθεται αυτόματα στο τελικό επιτόκιο.
        </p>
      ) : (
        <p className="lap-field-help">Παράδειγμα: για 6,10% καταχωρήστε 6.10 — όχι 610.</p>
      )}
      {isFloating ? (
        <NumberFieldStateControl
          id="rate-spreadPercent"
          label="Περιθώριο %"
          field={draft.spreadPercent}
          onChange={(next) => onNumberChange('spreadPercent', next)}
          placeholder="π.χ. 2,50"
        />
      ) : null}
      {isFloating ? (
        <SelectFieldStateControl
          id="rate-floatingIndexType"
          label="Είδος δείκτη"
          options={FLOATING_INDEX_TYPE_OPTIONS}
          field={draft.floatingIndexType}
          onChange={(next) => onSelectChange('floatingIndexType', next)}
        />
      ) : null}
      {isFloating ? (
        <SelectFieldStateControl
          id="rate-rateSourceRule"
          label="Κανόνας πηγής επιτοκίου"
          options={RATE_SOURCE_RULE_OPTIONS}
          field={draft.rateSourceRule}
          onChange={(next) => onSelectChange('rateSourceRule', next)}
        />
      ) : null}
      {isFloating && rateSourceRule === 'CONTRACT_DEFINED' ? (
        <p className="lap-field-help">
          Audit-safe προεπιλογή: χρησιμοποιείται η τιμή δείκτη που προβλέπει ρητά η σύμβαση
          (π.χ. ημερομηνία fixing / αναπροσαρμογής). Αν ο συμβατικός κανόνας δεν είναι σαφής,
          το αποτέλεσμα επισημαίνεται ως «απαιτείται έλεγχος» και δεν αναπαράγεται ως οριστικό.
        </p>
      ) : null}
      {showBusinessDays ? (
        <NumberFieldStateControl
          id="rate-businessDaysBeforeReset"
          label="Εργάσιμες ημέρες πριν την έναρξη περιόδου"
          field={draft.businessDaysBeforeReset}
          onChange={(next) => onNumberChange('businessDaysBeforeReset', next)}
          placeholder="π.χ. 2"
        />
      ) : null}
      {isMonthlyAverage ? (
        <p className="lap-field-help">
          Προσοχή: η μέση μηνιαία τιμή είναι τεχνική εκτίμηση και δεν αναπαράγει κατ’ ανάγκη
          την τραπεζική καρτέλα. Χρησιμοποιήστε την μόνο αν η σύμβαση το προβλέπει ρητά ή ως
          ενδεικτικό υπολογισμό — επισημαίνεται αναλόγως στη μελέτη.
        </p>
      ) : null}
      {isManualRate ? (
        <p className="lap-field-help">
          Οι τιμές δείκτη θα καταχωρηθούν χειροκίνητα ανά περίοδο. Χρήσιμο όταν δεν είναι
          δυνατή η αυτόματη άντληση ή όταν διαθέτετε επίσημες τιμές από τη σύμβαση / καρτέλα.
        </p>
      ) : null}
      {isFloating ? (
        <p className="lap-field-help">
          Αρνητικός δείκτης λαμβάνεται πάντα ως μηδέν: το εφαρμοζόμενο επιτόκιο δεν πέφτει
          κάτω από το περιθώριο (μηδενισμός αρνητικής τιμής δείκτη).
        </p>
      ) : null}
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

    <h3 className="lap-card__subtitle">Τόκος υπερημερίας (πραγματικές καταβολές)</h3>
    <p className="lap-card__explanation">
      Αφορά μόνο τον παράλληλο υπολογισμό βάσει πραγματικών καταβολών (καρτέλα
      «Πραγματικές Καταβολές» / «Σύγκριση»). Δεν επηρεάζει το θεωρητικό δοσολόγιο.
    </p>
    <div className="lap-form-grid">
      <NumberFieldStateControl
        id="rate-lateInterestSurchargePercent"
        label="Προσαύξηση τόκου υπερημερίας (ποσοστιαίες μονάδες)"
        field={draft.lateInterestSurchargePercent}
        onChange={(next) => onNumberChange('lateInterestSurchargePercent', next)}
        placeholder="π.χ. 2,5"
      />
      <p className="lap-field-help">
        Το 2,5 αποτελεί το ανώτατο νόμιμο όριο (ΠΔ/ΤΕ 2393/96) — όχι προεπιλογή. Καταχωρήστε
        την προσαύξηση που προβλέπει ρητά η συγκεκριμένη σύμβαση. Αν παραμείνει άγνωστο, δεν
        υπολογίζεται τόκος υπερημερίας πουθενά στον έλεγχο.
      </p>
      <SelectFieldStateControl
        id="rate-capitalizeLateInterestSemiAnnually"
        label="Εξαμηνιαία κεφαλαιοποίηση τόκου υπερημερίας"
        options={CAPITALIZE_LATE_INTEREST_OPTIONS}
        field={draft.capitalizeLateInterestSemiAnnually}
        onChange={(next) => onSelectChange('capitalizeLateInterestSemiAnnually', next)}
      />
      <p className="lap-field-help">
        Επιλέξτε «Ναι» μόνο αν η σύμβαση προβλέπει ρητά ανατοκισμό (Ν.2601/1998 άρθρο 12).
        Χωρίς ρητή πρόβλεψη, ισχύει «Όχι» — ο ανεξόφλητος τόκος δεν προστίθεται ποτέ
        αυτόματα στο κεφάλαιο (ΑΚ 296).
      </p>
    </div>
  </section>
  );
};
