/**
 * tests/fixtures/aslanisCepalFixture.ts
 * ------------------------------------------------------------------
 * Manually-extracted, SMALL real-case fixture for the Aslanis / Cepal
 * / Galaxy II loan audit. This is NOT PDF parsing and NOT a full
 * schedule — it is a hand-entered subset used to exercise the
 * existing draft → domain → pipeline flow end-to-end.
 *
 * Case context (manually extracted, technical financial audit only):
 *   - Case: Aslanis / Cepal / Galaxy II
 *   - Agreement date: 2024-07-04
 *   - Contractual rate in schedule: 5.50% + Ν.128/75 0.60% = 6.10%
 *     (modelled as fixed 6.10% for the tested fixed-rate window).
 *
 * No legal logic, no Ν.3869, no ΑΠ 6/2026 — a purely technical
 * financial fixture. Amounts are an illustrative subset and the test
 * asserts STRUCTURAL correctness, not final economic conclusions.
 */

import {
  createEmptyDraftState,
  type LoanAuditDraftState,
} from '../../src/ui-state/loanAuditDraftState';
import {
  addBankScheduleDraftRow,
  updateBankScheduleDraftRowField,
} from '../../src/ui-state/draftUpdates';
import {
  fieldValue,
  fieldExplicitZero,
  fieldUnknown,
  parseTextToField,
  parseMoneyToField,
} from '../../src/ui-state/fieldState';

/** One hand-extracted schedule row (euro major-unit strings as a user types). */
export interface FixtureScheduleRow {
  readonly rowId: string;
  readonly dueDate: string;
  readonly installment: string;
  readonly principal: string;
  readonly interest: string;
  readonly balance: string;
}

/**
 * A small, realistic subset of the schedule. Values are illustrative
 * (manually entered), chosen so each row is internally plausible
 * (installment ≈ principal + interest) without claiming to be the
 * audited totals.
 */
export const ASLANIS_CEPAL_ROWS: readonly FixtureScheduleRow[] = [
  // a normal early installment (interest-heavy)
  { rowId: 'r1', dueDate: '2024-08-04', installment: '1.085,00', principal: '575,00', interest: '510,00', balance: '99.425,00' },
  // a normal mid installment
  { rowId: 'r2', dueDate: '2024-09-04', installment: '1.085,00', principal: '578,00', interest: '507,00', balance: '98.847,00' },
  // a normal installment with full principal/interest/balance
  { rowId: 'r3', dueDate: '2024-10-04', installment: '1.085,00', principal: '581,00', interest: '504,00', balance: '98.266,00' },
  // a final/cleanup-style row (clearly larger principal portion)
  { rowId: 'r4', dueDate: '2024-11-04', installment: '1.085,00', principal: '584,00', interest: '501,00', balance: '97.682,00' },
] as const;

/** Principal of the modelled loan (illustrative): 100.000,00 €. */
export const ASLANIS_CEPAL_PRINCIPAL_CENTS = 10_000_000;

/**
 * Builds the complete draft through the existing UI draft path. Every
 * critical field is supplied so the draft can reach `ready`.
 */
export function buildAslanisCepalDraft(): LoanAuditDraftState {
  let d: LoanAuditDraftState = {
    ...createEmptyDraftState(),
    caseInfoDraft: {
      debtorName: fieldValue<string>('Ασλάνης'),
      contractNumber: fieldValue<string>('Galaxy-II/Cepal'),
      institution: fieldValue<string>('Cepal / Galaxy II'),
      servicer: fieldValue<string>('Cepal'),
    },
    loanTermsDraft: {
      principalCents: fieldValue<number>(ASLANIS_CEPAL_PRINCIPAL_CENTS),
      termMonths: fieldValue<number>(120),
      startDate: fieldValue<string>('2024-07-04'),
      endDate: fieldValue<string>('2034-07-04'),
    },
    rateConfigDraft: {
      // fixed 6.10% (5.50% base + 0.60% Ν.128/75) for the tested window
      regimeKind: fieldValue<string>('fixed'),
      annualRatePercent: fieldValue<number>(6.1),
      spreadPercent: fieldUnknown<number>(),
      law128Status: fieldValue<string>('included_in_rate'),
    },
    recalculationSettingsDraft: {
      scheduleMode: fieldValue<string>('equal_installment'),
      roundingMode: fieldValue<string>('half_up'),
      feesAndPremiumsPerPeriodCents: fieldExplicitZero(),
    },
  };

  // day-count convention (ACT/365 Fixed) on the bank schedule draft
  d = {
    ...d,
    bankScheduleDraft: {
      ...d.bankScheduleDraft,
      dayCountConvention: fieldValue<string>('ACT_365'),
    },
  };

  // bank/fund schedule rows, entered the way the UI table would
  ASLANIS_CEPAL_ROWS.forEach((r, index) => {
    d = addBankScheduleDraftRow(d, r.rowId);
    d = updateBankScheduleDraftRowField(d, index, 'dueDate', parseTextToField(r.dueDate));
    d = updateBankScheduleDraftRowField(d, index, 'installmentCents', parseMoneyToField(r.installment).field);
    d = updateBankScheduleDraftRowField(d, index, 'principalCents', parseMoneyToField(r.principal).field);
    d = updateBankScheduleDraftRowField(d, index, 'interestCents', parseMoneyToField(r.interest).field);
    d = updateBankScheduleDraftRowField(d, index, 'balanceCents', parseMoneyToField(r.balance).field);
  });

  return d;
}
