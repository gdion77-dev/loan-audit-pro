/**
 * Tests: field controls + CaseInfo/LoanTerms forms (Step 11-C).
 * Covers the 17 required scenarios.
 *
 * Rendering strategy: static render via react-dom/server
 * (renderToStaticMarkup) — the environment has the React 19 runtime
 * but no jsdom. Field PARSING (the heart of the three-state
 * discipline) is tested directly against the pure helpers, which is
 * exactly the code the controls call in their onChange handlers.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { App } from '../src/App';
import { AppShell } from '../src/components/layout/AppShell';
import { CaseInfoSection } from '../src/components/sections/CaseInfoSection';
import { LoanTermsSection } from '../src/components/sections/LoanTermsSection';
import { TextFieldStateControl } from '../src/components/fields/TextFieldStateControl';
import { MoneyFieldStateControl } from '../src/components/fields/MoneyFieldStateControl';
import { NumberFieldStateControl } from '../src/components/fields/NumberFieldStateControl';
import {
  parseTextToField,
  parseNumberToField,
  parseMoneyToField,
  fieldValue,
  fieldExplicitZero,
  fieldUnknown,
  fieldStatusLabel,
  type FieldState,
} from '../src/ui-state/fieldState';
import {
  createEmptyDraftState,
  type CaseInfoDraft,
  type LoanTermsDraft,
} from '../src/ui-state/loanAuditDraftState';
import { updateDraftField } from '../src/ui-state/draftUpdates';

const noopText = (_f: keyof CaseInfoDraft, _n: FieldState<string>): void => {};
const draft = createEmptyDraftState();

/* ------------------------------------------------------------------ */
/* connected sections render real labels                               */
/* ------------------------------------------------------------------ */

describe('uiFieldControls: section labels', () => {
  it('CaseInfoSection renders real field labels (test 1)', () => {
    const html = renderToStaticMarkup(
      React.createElement(CaseInfoSection, {
        draft: draft.caseInfoDraft,
        onFieldChange: noopText,
      }),
    );
    for (const label of ['Οφειλέτης', 'Αριθμός σύμβασης', 'Τράπεζα / Fund', 'Servicer']) {
      assert.ok(html.includes(label), `missing label: ${label}`);
    }
  });

  it('LoanTermsSection renders real field labels (test 2)', () => {
    const html = renderToStaticMarkup(
      React.createElement(LoanTermsSection, {
        draft: draft.loanTermsDraft,
        onNumberFieldChange: (_f: 'principalCents' | 'termMonths', _n: FieldState<number>) => {},
        onTextFieldChange: (_f: 'startDate' | 'endDate', _n: FieldState<string>) => {},
      }),
    );
    assert.ok(html.includes('Κεφάλαιο αναφοράς'));
    assert.ok(html.includes('Διάρκεια (μήνες)'));
    assert.ok(html.includes('Ημερομηνία έναρξης (ηη/μμ/εεεε)'));
    assert.ok(html.includes('Ημερομηνία λήξης (ηη/μμ/εεεε)'));
  });
});

/* ------------------------------------------------------------------ */
/* control rendering of the three states                               */
/* ------------------------------------------------------------------ */

describe('uiFieldControls: state rendering', () => {
  it('text field value state renders the value and the «Τιμή» label (test 3)', () => {
    const html = renderToStaticMarkup(
      React.createElement(TextFieldStateControl, {
        id: 't1',
        label: 'Οφειλέτης',
        field: fieldValue<string>('Παπαδόπουλος'),
        onChange: () => {},
      }),
    );
    assert.ok(html.includes('Παπαδόπουλος'));
    assert.ok(html.includes('Τιμή'));
  });

  it('text field unknown state renders as «Άγνωστο», empty input (test 4)', () => {
    const html = renderToStaticMarkup(
      React.createElement(TextFieldStateControl, {
        id: 't2',
        label: 'Servicer',
        field: fieldUnknown<string>(),
        onChange: () => {},
      }),
    );
    assert.ok(html.includes('Άγνωστο'));
    assert.ok(html.includes('value=""')); // never a stray value
  });

  it('numeric explicit zero renders «Ρητό μηδέν» (test 5)', () => {
    const html = renderToStaticMarkup(
      React.createElement(NumberFieldStateControl, {
        id: 'n1',
        label: 'Διάρκεια (μήνες)',
        field: fieldExplicitZero(),
        onChange: () => {},
      }),
    );
    assert.ok(html.includes('Ρητό μηδέν'));
  });

  it('numeric blank/unknown does not render 0 (test 6)', () => {
    const html = renderToStaticMarkup(
      React.createElement(NumberFieldStateControl, {
        id: 'n2',
        label: 'Διάρκεια (μήνες)',
        field: fieldUnknown<number>(),
        onChange: () => {},
      }),
    );
    assert.ok(html.includes('Άγνωστο'));
    assert.ok(html.includes('value=""'));
    assert.equal(html.includes('value="0"'), false);
  });

  it('money value preserves cents and displays euro-style value (test 7)', () => {
    const html = renderToStaticMarkup(
      React.createElement(MoneyFieldStateControl, {
        id: 'm1',
        label: 'Κεφάλαιο αναφοράς',
        field: fieldValue<number>(1_000_000), // 10.000,00 €
        onChange: () => {},
      }),
    );
    assert.ok(html.includes('10.000,00'));
    assert.ok(html.includes('Τιμή'));
  });
});

/* ------------------------------------------------------------------ */
/* parsing: never coerce to zero                                       */
/* ------------------------------------------------------------------ */

describe('uiFieldControls: parsing discipline', () => {
  it('blank text → unknown; non-blank → value', () => {
    assert.equal(parseTextToField('').status, 'unknown');
    assert.equal(parseTextToField('   ').status, 'unknown');
    assert.equal(parseTextToField('Τράπεζα Α').status, 'value');
    assert.equal(parseTextToField('Τράπεζα Α').value, 'Τράπεζα Α');
  });

  it('invalid numeric input does not coerce to 0 (test 8)', () => {
    const r = parseNumberToField('abc');
    assert.equal(r.invalid, true);
    assert.equal(r.field.status, 'unknown');
    assert.equal(r.field.value, null);
    assert.notEqual(r.field.value as unknown, 0);
  });

  it('numeric blank → unknown; "0" → explicit_zero; "12" → value', () => {
    assert.equal(parseNumberToField('').field.status, 'unknown');
    assert.equal(parseNumberToField('0').field.status, 'explicit_zero');
    assert.equal(parseNumberToField('0').field.value, 0);
    assert.equal(parseNumberToField('12').field.status, 'value');
    assert.equal(parseNumberToField('-3').field.status, 'value'); // negatives allowed
  });

  it('money parses euro major units to cents; invalid stays unknown', () => {
    assert.equal(parseMoneyToField('1.234,56').field.value, 123_456);
    assert.equal(parseMoneyToField('0,00').field.status, 'explicit_zero');
    const bad = parseMoneyToField('not money');
    assert.equal(bad.invalid, true);
    assert.equal(bad.field.status, 'unknown');
    assert.equal(bad.field.value, null);
  });

  it('status labels are the required Greek strings', () => {
    assert.equal(fieldStatusLabel(fieldValue<string>('x')), 'Τιμή');
    assert.equal(fieldStatusLabel(fieldExplicitZero()), 'Ρητό μηδέν');
    assert.equal(fieldStatusLabel(fieldUnknown<number>()), 'Άγνωστο');
  });
});

/* ------------------------------------------------------------------ */
/* immutable draft updates                                             */
/* ------------------------------------------------------------------ */

describe('uiFieldControls: immutable draft updates', () => {
  it('updateDraftField returns a new state without mutating the original (test 9)', () => {
    const before = createEmptyDraftState();
    const after = updateDraftField(
      before,
      'caseInfoDraft',
      'debtorName',
      fieldValue<string>('Νέος Οφειλέτης'),
    );
    // original untouched:
    assert.equal(before.caseInfoDraft.debtorName.status, 'unknown');
    assert.equal(before.caseInfoDraft.debtorName.value, null);
    // new state updated:
    assert.equal(after.caseInfoDraft.debtorName.status, 'value');
    assert.equal(after.caseInfoDraft.debtorName.value, 'Νέος Οφειλέτης');
    // different references at the changed levels:
    assert.notEqual(before, after);
    assert.notEqual(before.caseInfoDraft, after.caseInfoDraft);
    // untouched sibling section keeps the same reference:
    assert.equal(before.loanTermsDraft, after.loanTermsDraft);
  });

  it('money update through draft preserves cents (test 9 numeric path)', () => {
    const before = createEmptyDraftState();
    const parsed = parseMoneyToField('10.000,00');
    const after = updateDraftField(before, 'loanTermsDraft', 'principalCents', parsed.field);
    const principal: LoanTermsDraft['principalCents'] = after.loanTermsDraft.principalCents;
    assert.equal(principal.status, 'value');
    assert.equal(principal.value, 1_000_000);
    assert.equal(before.loanTermsDraft.principalCents.status, 'unknown'); // original intact
  });
});

/* ------------------------------------------------------------------ */
/* shell integrity                                                     */
/* ------------------------------------------------------------------ */

describe('uiFieldControls: shell integrity', () => {
  it('UI still renders all 9 sections (test 10)', () => {
    const sections: { id: string; needle: string }[] = [
      { id: 'case_info', needle: 'Οφειλέτης' },
      { id: 'loan_terms', needle: 'Κεφάλαιο αναφοράς' },
      { id: 'rate_config', needle: 'Επιτόκιο' },
      { id: 'bank_schedule', needle: 'Δοσολόγιο Τράπεζας / Fund' },
      { id: 'actual_payments', needle: 'Πραγματικές Καταβολές' },
      { id: 'recalc_settings', needle: 'Ρυθμίσεις Επανυπολογισμού' },
      { id: 'comparison', needle: 'Σύγκριση' },
      { id: 'findings', needle: 'Ευρήματα' },
      { id: 'report', needle: 'Παραγωγή PDF' },
    ];
    for (const s of sections) {
      const html = renderToStaticMarkup(
        React.createElement(AppShell, { initialSection: s.id as never }),
      );
      assert.ok(html.includes(s.needle), `section ${s.id} missing «${s.needle}»`);
    }
  });

  it('AuditPanel remains a placeholder (test 11)', () => {
    const html = renderToStaticMarkup(React.createElement(App, {}));
    assert.ok(html.includes('Φάκελος Ελέγχου'));
    assert.ok(html.includes('Η σύνδεση με πραγματικά AuditEntry θα γίνει σε επόμενο βήμα.'));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan over UI tree)                             */
/* ------------------------------------------------------------------ */

describe('uiFieldControls: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, '../src');
  const uiFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && entry.name !== 'pipelineExecutor.ts' && entry.name !== 'browserPdf.ts' && entry.name !== 'scheduleGenerator.ts') uiFiles.push(full);
    }
  };
  walk(join(srcRoot, 'components'));
  walk(join(srcRoot, 'ui-state'));
  uiFiles.push(join(srcRoot, 'App.tsx'));
  const allSource = uiFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const codeOnly = allSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no runLoanAuditPipeline call in UI (test 12)', () => {
    assert.equal(/runLoanAuditPipeline/.test(codeOnly), false);
  });

  it('no renderLoanAuditPdf call in UI (test 13)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(codeOnly), false);
  });

  it('no calculation engine called from UI', () => {
    assert.equal(
      /buildEqualPrincipalSchedule|buildEqualInstallmentSchedule|compareSchedules|generateFindings|reconcileActualPayments|buildLoanAuditReportModel|resolveRateForDate|calculateDayCount|calculateAccruedInterest|allocateSinglePayment/.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no backend/persistence/auth code introduced (test 14)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|bcrypt|passport|writeFileSync|process\.env/i.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no EFKA/pension/insurance wording (test 15)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|ΟΑΕΕ|OAEE|\bΙΚΑ\b|\bIKA\b/i.test(
        allSource,
      ),
      false,
    );
  });

  it('no Ν.3869 or ΑΠ 6/2026 wording (test 16)', () => {
    assert.equal(/3869/.test(allSource), false);
    assert.equal(/6\s*\/\s*2026/.test(allSource), false);
  });

  it('no forbidden legal/conclusion wording (test 17)', () => {
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        allSource,
      ),
      false,
    );
  });
});
