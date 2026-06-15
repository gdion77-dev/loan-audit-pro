/**
 * Tests: draft validation summary (Step 12-A).
 * Covers scenarios 15–16 plus structure checks.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { adaptDraftToDomain } from '../src/ui-state/draftToDomainAdapter';
import { buildDraftValidationSummary } from '../src/ui-state/draftValidationSummary';
import {
  createEmptyDraftState,
  type LoanAuditDraftState,
} from '../src/ui-state/loanAuditDraftState';
import { addBankScheduleDraftRow } from '../src/ui-state/draftUpdates';
import { fieldValue, fieldExplicitZero, fieldUnknown } from '../src/ui-state/fieldState';

function completeDraft(): LoanAuditDraftState {
  const base = createEmptyDraftState();
  return {
    ...base,
    caseInfoDraft: {
      debtorName: fieldValue<string>('Οφειλέτης'),
      contractNumber: fieldValue<string>('4500-1'),
      institution: fieldValue<string>('Τράπεζα Α'),
      servicer: fieldUnknown<string>(),
    },
    loanTermsDraft: {
      principalCents: fieldValue<number>(1_000_000),
      termMonths: fieldValue<number>(120),
      startDate: fieldValue<string>('2024-01-01'),
      endDate: fieldValue<string>('2034-01-01'),
    },
    rateConfigDraft: {
      regimeKind: fieldValue<string>('fixed'),
      annualRatePercent: fieldValue<number>(6),
      spreadPercent: fieldUnknown<number>(),
      law128Status: fieldValue<string>('included_in_rate'),
    },
    bankScheduleDraft: {
      rows: [],
      dayCountConvention: fieldValue<string>('ACT_365'),
      sourceNote: fieldUnknown<string>(),
    },
    recalculationSettingsDraft: {
      scheduleMode: fieldValue<string>('equal_principal'),
      roundingMode: fieldValue<string>('half_up'),
      feesAndPremiumsPerPeriodCents: fieldExplicitZero(),
    },
  };
}

describe('draftValidationSummary: structure', () => {
  it('groups issues by section (test 15)', () => {
    const result = adaptDraftToDomain(createEmptyDraftState());
    const summary = buildDraftValidationSummary(result);
    assert.equal(summary.sections.length, 6);
    assert.deepEqual(
      summary.sections.map((s) => s.sectionId),
      ['case_info', 'loan_terms', 'rate_config', 'bank_schedule', 'actual_payments', 'recalc_settings'],
    );
    // case_info issues are grouped under the case_info section only:
    const caseSection = summary.sections.find((s) => s.sectionId === 'case_info')!;
    assert.ok(caseSection.issues.length >= 1);
    assert.ok(caseSection.issues.every((i) => i.section === 'case_info'));
    assert.equal(caseSection.status, 'missing_data');
  });

  it('overall status mirrors the adapter; ready when complete (test 15 cont.)', () => {
    const ready = buildDraftValidationSummary(adaptDraftToDomain(completeDraft()));
    assert.equal(ready.status, 'ready');
    for (const s of ready.sections) assert.equal(s.status, 'ready');

    const empty = buildDraftValidationSummary(adaptDraftToDomain(createEmptyDraftState()));
    assert.equal(empty.status, 'missing_data');
  });

  it('per-section status reflects the worst issue level', () => {
    // complete except an empty bank row → info under bank_schedule
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b-empty');
    const summary = buildDraftValidationSummary(adaptDraftToDomain(d));
    const bank = summary.sections.find((s) => s.sectionId === 'bank_schedule')!;
    assert.ok(bank.issues.some((i) => i.level === 'info'));
    // info-only keeps the section ready:
    assert.equal(bank.status, 'ready');
  });

  it('uses Greek neutral wording (test 16)', () => {
    const summary = buildDraftValidationSummary(adaptDraftToDomain(createEmptyDraftState()));
    const titles = summary.sections.map((s) => s.title);
    assert.ok(titles.includes('Στοιχεία Υπόθεσης'));
    assert.ok(titles.includes('Ρυθμίσεις Επανυπολογισμού'));
    // every issue message is non-empty Greek text, with no forbidden terms:
    const allMessages = summary.sections.flatMap((s) => s.issues.map((i) => i.message));
    assert.ok(allMessages.length > 0);
    for (const m of allMessages) {
      assert.ok(m.length > 0);
      assert.equal(
        /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα|ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|3869|6\/2026/i.test(m),
        false,
        m,
      );
    }
  });
});
