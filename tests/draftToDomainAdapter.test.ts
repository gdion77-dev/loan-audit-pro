/**
 * Tests: draft-to-domain adapter (Step 12-A).
 * Covers the mapping/discipline scenarios (1–14, 17) and scope guards.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { adaptDraftToDomain } from '../src/ui-state/draftToDomainAdapter';
import {
  createEmptyDraftState,
  type LoanAuditDraftState,
} from '../src/ui-state/loanAuditDraftState';
import {
  addBankScheduleDraftRow,
  removeBankScheduleDraftRow,
  updateBankScheduleDraftRowField,
  addActualPaymentDraftRow,
  updateActualPaymentDraftRowField,
} from '../src/ui-state/draftUpdates';
import {
  fieldValue,
  fieldExplicitZero,
  fieldUnknown,
  parseMoneyToField,
  parseTextToField,
} from '../src/ui-state/fieldState';

/** Builds a fully-complete, ready draft. */
function completeDraft(): LoanAuditDraftState {
  const base = createEmptyDraftState();
  return {
    ...base,
    caseInfoDraft: {
      debtorName: fieldValue<string>('Δοκιμαστικός Οφειλέτης'),
      contractNumber: fieldValue<string>('4500-1'),
      institution: fieldValue<string>('Τράπεζα Α'),
      servicer: fieldValue<string>('Servicer Β'),
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
      law128Percent: fieldUnknown<number>("manual"),
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

/* ------------------------------------------------------------------ */
/* complete mappings                                                   */
/* ------------------------------------------------------------------ */

describe('draftToDomainAdapter: complete mappings', () => {
  it('complete draft maps to caseInfo (test 1)', () => {
    const r = adaptDraftToDomain(completeDraft());
    assert.ok(r.caseInfo);
    assert.equal(r.caseInfo.debtorName, 'Δοκιμαστικός Οφειλέτης');
    assert.equal(r.caseInfo.institution, 'Τράπεζα Α');
    assert.equal(r.caseInfo.servicer, 'Servicer Β');
    assert.equal(r.caseInfo.principal.cents, 1_000_000);
    assert.equal(r.caseInfo.termMonths, 120);
  });

  it('complete draft maps to loanTerms (test 2)', () => {
    const r = adaptDraftToDomain(completeDraft());
    assert.ok(r.loanTerms);
    assert.equal(r.loanTerms.principalCents, 1_000_000);
    assert.equal(r.loanTerms.termMonths, 120);
    assert.equal(r.loanTerms.startDate, '2024-01-01');
    assert.equal(r.loanTerms.endDate, '2034-01-01');
  });

  it('complete draft maps to fixed rate config (test 3)', () => {
    const r = adaptDraftToDomain(completeDraft());
    assert.ok(r.rateConfig);
    assert.equal(r.rateConfig.regime.kind, 'fixed');
    assert.equal(r.rateConfig.regime.kind === 'fixed' ? r.rateConfig.regime.annualRatePercent : null, 6);
    assert.equal(r.rateConfig.law128.kind, 'included_in_rate');
  });

  it('complete draft maps to recalculation settings (test 4)', () => {
    const r = adaptDraftToDomain(completeDraft());
    assert.ok(r.recalculationSettings);
    assert.equal(r.recalculationSettings.scheduleMode, 'equal_principal');
    assert.equal(r.recalculationSettings.roundingMode, 'half_up');
    assert.equal(r.recalculationSettings.feesAndPremiumsPerPeriodCents, 0); // explicit_zero → 0
  });

  it('ready status only when critical data is complete (test 17)', () => {
    assert.equal(adaptDraftToDomain(completeDraft()).status, 'ready');
    assert.equal(adaptDraftToDomain(createEmptyDraftState()).status, 'missing_data');
  });
});

/* ------------------------------------------------------------------ */
/* row mappings                                                        */
/* ------------------------------------------------------------------ */

describe('draftToDomainAdapter: row mappings', () => {
  it('bank schedule draft row maps to BankScheduleRow (test 5)', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b1');
    d = updateBankScheduleDraftRowField(d, 0, 'dueDate', parseTextToField('2024-01-31'));
    d = updateBankScheduleDraftRowField(d, 0, 'installmentCents', fieldValue<number>(64_708));
    d = updateBankScheduleDraftRowField(d, 0, 'interestCents', fieldExplicitZero());
    const r = adaptDraftToDomain(d);
    assert.equal(r.bankRows.length, 1);
    const row = r.bankRows[0]!;
    assert.equal(row.rowId, 'b1');
    assert.equal(row.dueDate, '2024-01-31');
    assert.equal(row.installmentAmount?.cents, 64_708);
    assert.equal(row.interestPortion?.cents, 0); // explicit_zero → 0
    assert.equal(row.principalPortion, null); // unknown → null
    assert.equal(row.balanceAfter, null);
  });

  it('actual payment draft row maps to ActualPayment (test 6)', () => {
    let d = completeDraft();
    d = addActualPaymentDraftRow(d, 'p1');
    d = updateActualPaymentDraftRowField(d, 0, 'paymentDate', parseTextToField('2024-01-31'));
    d = updateActualPaymentDraftRowField(d, 0, 'amountCents', fieldValue<number>(64_708));
    d = updateActualPaymentDraftRowField(d, 0, 'matchedScheduleRowId', parseTextToField('b1'));
    const r = adaptDraftToDomain(d);
    assert.equal(r.actualPayments.length, 1);
    const p = r.actualPayments[0]!;
    assert.equal(p.paymentId, 'p1');
    assert.equal(p.date, '2024-01-31');
    assert.equal(p.amount.cents, 64_708);
    assert.equal(p.matchedScheduleRowId, 'b1');
    assert.equal(p.matchConfidence, 'manual');
  });
});

/* ------------------------------------------------------------------ */
/* no silent zero                                                      */
/* ------------------------------------------------------------------ */

describe('draftToDomainAdapter: no silent zero', () => {
  it('unknown money value never becomes 0 (test 7)', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b1');
    d = updateBankScheduleDraftRowField(d, 0, 'dueDate', parseTextToField('2024-01-31'));
    d = updateBankScheduleDraftRowField(d, 0, 'installmentCents', fieldUnknown<number>());
    const r = adaptDraftToDomain(d);
    assert.equal(r.bankRows[0]!.installmentAmount, null);
    assert.notEqual(r.bankRows[0]!.installmentAmount as unknown, 0);
  });

  it('explicit_zero money value becomes 0 (test 8)', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b1');
    d = updateBankScheduleDraftRowField(d, 0, 'dueDate', parseTextToField('2024-01-31'));
    d = updateBankScheduleDraftRowField(d, 0, 'installmentCents', parseMoneyToField('0,00').field);
    const r = adaptDraftToDomain(d);
    assert.equal(r.bankRows[0]!.installmentAmount?.cents, 0);
  });

  it('invalid/unknown required field creates missingData (test 9)', () => {
    const d = createEmptyDraftState();
    const r = adaptDraftToDomain(d);
    assert.equal(r.status, 'missing_data');
    assert.ok(r.missingData.some((m) => m.fieldLabel === 'Κεφάλαιο αναφοράς'));
    assert.ok(r.missingData.some((m) => m.fieldLabel === 'Τύπος επανυπολογισμού'));
    // none of these "missing" became a zero value:
    assert.equal(r.loanTerms, null);
    assert.equal(r.recalculationSettings, null);
  });

  it('unknown law128Status creates requires_review (test 10)', () => {
    const base = completeDraft();
    const d: LoanAuditDraftState = {
      ...base,
      rateConfigDraft: { ...base.rateConfigDraft, law128Status: fieldUnknown<string>() },
    };
    const r = adaptDraftToDomain(d);
    assert.ok(r.warnings.some((w) => w.level === 'requires_review' && w.fieldLabel.includes('Ν.128/75')));
    assert.equal(r.rateConfig?.law128.kind, 'unknown');
  });
});

/* ------------------------------------------------------------------ */
/* empty / partial rows                                                */
/* ------------------------------------------------------------------ */

describe('draftToDomainAdapter: empty/partial rows', () => {
  it('empty bank schedule row is excluded with info, not silent (test 11)', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b-empty'); // all unknown
    const r = adaptDraftToDomain(d);
    assert.equal(r.bankRows.length, 0);
    const issue = [...r.warnings, ...r.missingData].find((i) => i.rowId === 'b-empty');
    assert.ok(issue);
    assert.equal(issue.level, 'info');
    assert.ok(issue.message.includes('Κενή γραμμή'));
  });

  it('partial bank schedule row preserves row context (test 12)', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b-partial');
    // amounts but NO valid dueDate → cannot build a row, but reported with rowId
    d = updateBankScheduleDraftRowField(d, 0, 'installmentCents', fieldValue<number>(50_000));
    const r = adaptDraftToDomain(d);
    assert.equal(r.bankRows.length, 0);
    const issue = r.warnings.find((i) => i.rowId === 'b-partial');
    assert.ok(issue);
    assert.equal(issue.level, 'requires_review');
  });

  it('partial bank row WITH dueDate is included with a warning about missing amounts', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b-date-only');
    d = updateBankScheduleDraftRowField(d, 0, 'dueDate', parseTextToField('2024-02-29'));
    const r = adaptDraftToDomain(d);
    assert.equal(r.bankRows.length, 1); // included
    assert.equal(r.bankRows[0]!.installmentAmount, null);
    assert.ok(r.warnings.some((w) => w.rowId === 'b-date-only' && w.fieldLabel === 'Ποσά δόσης'));
  });

  it('empty actual payment row is excluded with info, not silent (test 13)', () => {
    let d = completeDraft();
    d = addActualPaymentDraftRow(d, 'p-empty');
    const r = adaptDraftToDomain(d);
    assert.equal(r.actualPayments.length, 0);
    const issue = r.warnings.find((i) => i.rowId === 'p-empty');
    assert.ok(issue);
    assert.equal(issue.level, 'info');
  });

  it('partial actual payment row preserves row context (test 14)', () => {
    let d = completeDraft();
    d = addActualPaymentDraftRow(d, 'p-partial');
    // a date but NO amount → not assumed zero, reported with rowId
    d = updateActualPaymentDraftRowField(d, 0, 'paymentDate', parseTextToField('2024-01-31'));
    const r = adaptDraftToDomain(d);
    assert.equal(r.actualPayments.length, 0);
    const issue = r.warnings.find((i) => i.rowId === 'p-partial');
    assert.ok(issue);
    assert.equal(issue.level, 'requires_review');
    assert.ok(issue.message.includes('δεν τεκμαίρεται μηδενικό'));
  });

  it('no row is dropped silently: removing a row leaves the rest mapped', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b1');
    d = addBankScheduleDraftRow(d, 'b2');
    d = updateBankScheduleDraftRowField(d, 0, 'dueDate', parseTextToField('2024-01-31'));
    d = updateBankScheduleDraftRowField(d, 1, 'dueDate', parseTextToField('2024-02-29'));
    d = removeBankScheduleDraftRow(d, 0);
    const r = adaptDraftToDomain(d);
    assert.equal(r.bankRows.length, 1);
    assert.equal(r.bankRows[0]!.dueDate, '2024-02-29');
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('draftToDomainAdapter: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const stateDir = join(here, '../src/ui-state');
  const files = readdirSync(stateDir).filter(
    (f) => /\.tsx?$/.test(f) && f !== 'pipelineExecutor.ts' && f !== 'scheduleGenerator.ts' && f !== 'browserPdf.ts',
  );
  const allSource = files.map((f) => readFileSync(join(stateDir, f), 'utf8')).join('\n');
  const codeOnly = allSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no runLoanAuditPipeline call (test 18)', () => {
    assert.equal(/runLoanAuditPipeline/.test(codeOnly), false);
  });

  it('no renderLoanAuditPdf call (test 19)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(codeOnly), false);
  });

  it('no reconciliation/engine calls (test 20)', () => {
    assert.equal(
      /reconcileActualPayments|compareSchedules|generateFindings|buildEqualPrincipalSchedule|buildEqualInstallmentSchedule|buildLoanAuditReportModel/.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no backend/persistence/auth code (test 21)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|process\.env|writeFileSync/i.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no EFKA/pension/insurance wording (test 22)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|ΟΑΕΕ|OAEE|\bΙΚΑ\b|\bIKA\b/i.test(
        allSource,
      ),
      false,
    );
  });

  it('no Ν.3869 or ΑΠ 6/2026 wording (test 23)', () => {
    assert.equal(/3869/.test(allSource), false);
    assert.equal(/6\s*\/\s*2026/.test(allSource), false);
  });

  it('no forbidden legal/conclusion wording (test 24)', () => {
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        allSource,
      ),
      false,
    );
  });
});
