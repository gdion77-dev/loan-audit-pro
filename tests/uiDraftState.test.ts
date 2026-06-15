/**
 * Tests: UI draft state (Step 11-B).
 * Covers the FieldState three-state model and LoanAuditDraftState
 * initialization (required scenarios 1–6), plus source-scan guards.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fieldValue,
  fieldExplicitZero,
  fieldUnknown,
  isValue,
  isExplicitZero,
  isUnknown,
  validateField,
  normalizeField,
  FieldStateError,
  type FieldState,
} from '../src/ui-state/fieldState';
import {
  createEmptyDraftState,
  DRAFT_SECTION_KEYS,
} from '../src/ui-state/loanAuditDraftState';

/* ------------------------------------------------------------------ */
/* FieldState three-state model                                        */
/* ------------------------------------------------------------------ */

describe('fieldState: three-state model', () => {
  it('value state preserves a numeric value (test 1)', () => {
    const f = fieldValue(1_234, 'manual');
    assert.equal(f.status, 'value');
    assert.equal(f.value, 1_234);
    assert.equal(isValue(f), true);
    assert.equal(validateField(f), null);
  });

  it('explicit_zero preserves 0 as explicit data (test 2)', () => {
    const f = fieldExplicitZero('imported', 'η πηγή αναφέρει μηδέν');
    assert.equal(f.status, 'explicit_zero');
    assert.equal(f.value, 0); // an explicit, meaningful zero
    assert.equal(isExplicitZero(f), true);
    assert.equal(isUnknown(f), false);
    assert.equal(validateField(f), null);
  });

  it('unknown stores null and never 0 (test 3)', () => {
    const f = fieldUnknown<number>('manual');
    assert.equal(f.status, 'unknown');
    assert.equal(f.value, null); // NOT 0
    assert.notEqual(f.value as unknown, 0);
    assert.equal(isUnknown(f), true);
    assert.equal(validateField(f), null);
  });

  it('value state and explicit_zero are distinct from each other', () => {
    const zero = fieldExplicitZero();
    const value = fieldValue(0); // a value that happens to be 0 numerically
    // both are non-unknown but carry different intent flags:
    assert.equal(zero.status, 'explicit_zero');
    assert.equal(value.status, 'value');
  });
});

/* ------------------------------------------------------------------ */
/* invalid states                                                      */
/* ------------------------------------------------------------------ */

describe('fieldState: invalid states', () => {
  it('constructing a value state from null is rejected (test 4)', () => {
    assert.throws(() => fieldValue<number>(null as unknown as number), FieldStateError);
  });

  it('a value state carrying null is flagged by validateField (test 4)', () => {
    const bad: FieldState<number> = { status: 'value', value: null };
    const issue = validateField(bad);
    assert.ok(issue);
    assert.equal(issue.code, 'VALUE_NULL');
  });

  it('an unknown state carrying a non-null value is flagged and normalized safely (test 5)', () => {
    const bad: FieldState<number> = { status: 'unknown', value: 5 };
    const issue = validateField(bad);
    assert.ok(issue);
    assert.equal(issue.code, 'UNKNOWN_NOT_NULL');
    // normalization drops the stray value to null — never coerces to 0:
    const fixed = normalizeField(bad);
    assert.equal(fixed.status, 'unknown');
    assert.equal(fixed.value, null);
    assert.notEqual(fixed.value as unknown, 0);
  });

  it('an explicit_zero that is not 0 is flagged', () => {
    const bad: FieldState<number> = { status: 'explicit_zero', value: 3 };
    const issue = validateField(bad);
    assert.ok(issue);
    assert.equal(issue.code, 'EXPLICIT_ZERO_NOT_ZERO');
  });

  it('normalizing a value-with-null yields unknown, not zero', () => {
    const fixed = normalizeField<number>({ status: 'value', value: null });
    assert.equal(fixed.status, 'unknown');
    assert.equal(fixed.value, null);
  });
});

/* ------------------------------------------------------------------ */
/* LoanAuditDraftState                                                 */
/* ------------------------------------------------------------------ */

describe('loanAuditDraftState: initialization', () => {
  it('initializes all six main draft sections (test 6)', () => {
    const draft = createEmptyDraftState();
    for (const key of DRAFT_SECTION_KEYS) {
      assert.ok(draft[key] !== undefined, `missing draft section: ${key}`);
    }
    assert.equal(DRAFT_SECTION_KEYS.length, 6);
  });

  it('every initial field is unknown with null value (never 0)', () => {
    const draft = createEmptyDraftState();
    const allFields: FieldState<unknown>[] = [
      ...Object.values(draft.caseInfoDraft),
      ...Object.values(draft.loanTermsDraft),
      ...Object.values(draft.rateConfigDraft),
      // bankScheduleDraft holds a rows array plus two FieldState fields:
      draft.bankScheduleDraft.dayCountConvention,
      draft.bankScheduleDraft.sourceNote,
      // actualPaymentsDraft holds a rows array plus one FieldState field:
      draft.actualPaymentsDraft.sourceNote,
      ...Object.values(draft.recalculationSettingsDraft),
    ];
    for (const f of allFields) {
      assert.equal(f.status, 'unknown');
      assert.equal(f.value, null);
      assert.notEqual(f.value as unknown, 0); // no silent zero anywhere
    }
    // both editable draft tables start with empty rows arrays:
    assert.deepEqual(draft.bankScheduleDraft.rows, []);
    assert.deepEqual(draft.actualPaymentsDraft.rows, []);
  });

  it('numeric fields start unknown, not explicit zero', () => {
    const draft = createEmptyDraftState();
    assert.equal(draft.loanTermsDraft.principalCents.status, 'unknown');
    assert.equal(draft.recalculationSettingsDraft.feesAndPremiumsPerPeriodCents.status, 'unknown');
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan over ui-state)                            */
/* ------------------------------------------------------------------ */

describe('uiDraftState: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const stateDir = join(here, '../src/ui-state');
  const files = readdirSync(stateDir).filter(
    (f) => /\.tsx?$/.test(f) && f !== 'pipelineExecutor.ts' && f !== 'scheduleGenerator.ts' && f !== 'browserPdf.ts',
  );
  const allSource = files.map((f) => readFileSync(join(stateDir, f), 'utf8')).join('\n');
  const codeOnly = allSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no engine / pipeline / PDF calls in draft state (tests 10, 11)', () => {
    assert.equal(
      /runLoanAuditPipeline|renderLoanAuditPdf|renderLoanAuditReportText|buildEqual|compareSchedules|generateFindings|reconcileActualPayments|buildLoanAuditReportModel/.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no backend/persistence/auth (test 12)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|process\.env|writeFileSync/i.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no EFKA/pension/insurance wording (test 13)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|ΟΑΕΕ|OAEE|\bΙΚΑ\b|\bIKA\b/i.test(
        allSource,
      ),
      false,
    );
  });

  it('no Ν.3869 or ΑΠ 6/2026 wording (test 14)', () => {
    assert.equal(/3869/.test(allSource), false);
    assert.equal(/6\s*\/\s*2026/.test(allSource), false);
  });

  it('no forbidden legal/conclusion wording (test 15)', () => {
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        allSource,
      ),
      false,
    );
  });
});
