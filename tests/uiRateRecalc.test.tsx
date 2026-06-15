/**
 * Tests: RateConfig + RecalculationSettings forms (Step 11-D).
 * Covers the 20 required scenarios.
 *
 * Rendering via react-dom/server (renderToStaticMarkup); select and
 * numeric behaviour is also checked against the pure FieldState
 * helpers — the exact code the controls call. No jsdom needed.
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
import { RateConfigSection } from '../src/components/sections/RateConfigSection';
import { RecalculationSettingsSection } from '../src/components/sections/RecalculationSettingsSection';
import { SelectFieldStateControl } from '../src/components/fields/SelectFieldStateControl';
import {
  parseNumberToField,
  parseMoneyToField,
  fieldValue,
  fieldUnknown,
  type FieldState,
} from '../src/ui-state/fieldState';
import {
  createEmptyDraftState,
  REGIME_KIND_OPTIONS,
  LAW128_STATUS_OPTIONS,
  SCHEDULE_MODE_OPTIONS,
  ROUNDING_MODE_OPTIONS,
} from '../src/ui-state/loanAuditDraftState';
import { updateDraftField } from '../src/ui-state/draftUpdates';

const draft = createEmptyDraftState();
const noSel = (_f: never, _n: FieldState<string>): void => {};
const noNum = (_f: never, _n: FieldState<number>): void => {};

const renderRate = (): string =>
  renderToStaticMarkup(
    React.createElement(RateConfigSection, {
      draft: draft.rateConfigDraft,
      onSelectChange: noSel as never,
      onNumberChange: noNum as never,
    }),
  );
const renderRecalc = (): string =>
  renderToStaticMarkup(
    React.createElement(RecalculationSettingsSection, {
      draft: draft.recalculationSettingsDraft,
      onSelectChange: noSel as never,
      onMoneyChange: noNum as never,
    }),
  );

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

describe('rateRecalc: labels', () => {
  it('RateConfigSection renders real field labels (test 1)', () => {
    const html = renderRate();
    for (const label of ['Καθεστώς επιτοκίου', 'Σταθερό ετήσιο επιτόκιο %', 'Περιθώριο %', 'Καθεστώς εισφοράς Ν.128/75']) {
      assert.ok(html.includes(label), `missing label: ${label}`);
    }
  });

  it('RecalculationSettingsSection renders real field labels (test 2)', () => {
    const html = renderRecalc();
    for (const label of ['Τύπος επανυπολογισμού', 'Πολιτική στρογγυλοποίησης', 'Έξοδα / ασφάλιστρα ανά περίοδο']) {
      assert.ok(html.includes(label), `missing label: ${label}`);
    }
  });
});

/* ------------------------------------------------------------------ */
/* select options                                                      */
/* ------------------------------------------------------------------ */

describe('rateRecalc: select options', () => {
  it('regimeKind supports fixed/floating/unknown (test 3)', () => {
    const html = renderRate();
    for (const label of ['Σταθερό', 'Κυμαινόμενο', 'Άγνωστο']) assert.ok(html.includes(label));
    assert.equal(REGIME_KIND_OPTIONS.filter((o) => o.unknown).length, 1);
  });

  it('law128Status supports included/separate/unknown (test 4)', () => {
    const html = renderRate();
    for (const label of ['Περιλαμβάνεται στο επιτόκιο', 'Προστίθεται χωριστά', 'Άγνωστο / απαιτείται έλεγχος']) {
      assert.ok(html.includes(label));
    }
  });

  it('scheduleMode supports equal principal/equal installment/unknown (test 5)', () => {
    const html = renderRecalc();
    for (const label of ['Ίση δόση κεφαλαίου', 'Σταθερή τοκοχρεολυτική δόση', 'Άγνωστο']) {
      assert.ok(html.includes(label));
    }
  });

  it('roundingMode supports half up/floor/ceil/unknown (test 6)', () => {
    const html = renderRecalc();
    for (const label of ['Εμπορική στρογγυλοποίηση', 'Προς τα κάτω', 'Προς τα πάνω', 'Άγνωστο']) {
      assert.ok(html.includes(label));
    }
  });

  it('select unknown option maps to FieldState unknown; real option maps to value', () => {
    const captured: FieldState<string>[] = [];
    // render with a real value selected so the select reflects it:
    const html = renderToStaticMarkup(
      React.createElement(SelectFieldStateControl, {
        id: 's1',
        label: 'Καθεστώς επιτοκίου',
        options: REGIME_KIND_OPTIONS,
        field: fieldValue<string>('fixed'),
        onChange: (n: FieldState<string>) => captured.push(n),
      }),
    );
    assert.ok(html.includes('Σταθερό'));
    assert.ok(html.includes('Τιμή')); // value-state label
    // unknown field renders the «Άγνωστο» state label:
    const htmlUnknown = renderToStaticMarkup(
      React.createElement(SelectFieldStateControl, {
        id: 's2',
        label: 'Καθεστώς επιτοκίου',
        options: REGIME_KIND_OPTIONS,
        field: fieldUnknown<string>(),
        onChange: () => {},
      }),
    );
    assert.ok(htmlUnknown.includes('Άγνωστο'));
  });
});

/* ------------------------------------------------------------------ */
/* numeric discipline                                                  */
/* ------------------------------------------------------------------ */

describe('rateRecalc: numeric discipline', () => {
  it('annualRatePercent blank remains unknown (test 7)', () => {
    assert.equal(parseNumberToField('').field.status, 'unknown');
    assert.equal(parseNumberToField('').field.value, null);
  });

  it('annualRatePercent 0 becomes explicit_zero (test 8)', () => {
    const f = parseNumberToField('0').field;
    assert.equal(f.status, 'explicit_zero');
    assert.equal(f.value, 0);
  });

  it('spreadPercent invalid input does not become zero (test 9)', () => {
    const r = parseNumberToField('abc');
    assert.equal(r.invalid, true);
    assert.equal(r.field.status, 'unknown');
    assert.equal(r.field.value, null);
    assert.notEqual(r.field.value as unknown, 0);
  });

  it('feesAndPremiumsPerPeriodCents displays euro-style value when value exists (test 10)', () => {
    const html = renderToStaticMarkup(
      React.createElement(RecalculationSettingsSection, {
        draft: {
          ...draft.recalculationSettingsDraft,
          feesAndPremiumsPerPeriodCents: fieldValue<number>(1_500), // 15,00 €
        },
        onSelectChange: noSel as never,
        onMoneyChange: noNum as never,
      }),
    );
    assert.ok(html.includes('15,00'));
    assert.ok(html.includes('Τιμή'));
  });

  it('money parsing for fees: blank→unknown, 0→explicit_zero, value→cents', () => {
    assert.equal(parseMoneyToField('').field.status, 'unknown');
    assert.equal(parseMoneyToField('0,00').field.status, 'explicit_zero');
    assert.equal(parseMoneyToField('15,00').field.value, 1_500);
  });
});

/* ------------------------------------------------------------------ */
/* immutable updates                                                   */
/* ------------------------------------------------------------------ */

describe('rateRecalc: immutable updates', () => {
  it('rateConfigDraft updates immutably (test 11)', () => {
    const before = createEmptyDraftState();
    const after = updateDraftField(before, 'rateConfigDraft', 'regimeKind', fieldValue<string>('fixed'));
    assert.equal(before.rateConfigDraft.regimeKind.status, 'unknown'); // original intact
    assert.equal(after.rateConfigDraft.regimeKind.status, 'value');
    assert.equal(after.rateConfigDraft.regimeKind.value, 'fixed');
    assert.notEqual(before.rateConfigDraft, after.rateConfigDraft);
    assert.equal(before.recalculationSettingsDraft, after.recalculationSettingsDraft); // sibling shared
  });

  it('recalculationSettingsDraft updates immutably (test 12)', () => {
    const before = createEmptyDraftState();
    const fees = parseMoneyToField('15,00').field;
    const after = updateDraftField(before, 'recalculationSettingsDraft', 'feesAndPremiumsPerPeriodCents', fees);
    assert.equal(after.recalculationSettingsDraft.feesAndPremiumsPerPeriodCents.value, 1_500);
    assert.equal(before.recalculationSettingsDraft.feesAndPremiumsPerPeriodCents.status, 'unknown');
    assert.notEqual(before.recalculationSettingsDraft, after.recalculationSettingsDraft);
  });
});

/* ------------------------------------------------------------------ */
/* shell integrity                                                     */
/* ------------------------------------------------------------------ */

describe('rateRecalc: shell integrity', () => {
  it('UI still renders all 9 sections (test 13)', () => {
    const needles: { id: string; needle: string }[] = [
      { id: 'case_info', needle: 'Οφειλέτης' },
      { id: 'loan_terms', needle: 'Κεφάλαιο αναφοράς' },
      { id: 'rate_config', needle: 'Καθεστώς επιτοκίου' },
      { id: 'bank_schedule', needle: 'Δοσολόγιο Τράπεζας / Fund' },
      { id: 'actual_payments', needle: 'Πραγματικές Καταβολές' },
      { id: 'recalc_settings', needle: 'Τύπος επανυπολογισμού' },
      { id: 'comparison', needle: 'Σύγκριση' },
      { id: 'findings', needle: 'Ευρήματα' },
      { id: 'report', needle: 'Παραγωγή PDF' },
    ];
    for (const n of needles) {
      const html = renderToStaticMarkup(React.createElement(AppShell, { initialSection: n.id as never }));
      assert.ok(html.includes(n.needle), `section ${n.id} missing «${n.needle}»`);
    }
  });

  it('AuditPanel remains placeholder (test 14)', () => {
    const html = renderToStaticMarkup(React.createElement(App, {}));
    assert.ok(html.includes('Φάκελος Ελέγχου'));
    assert.ok(html.includes('Η σύνδεση με πραγματικά AuditEntry θα γίνει σε επόμενο βήμα.'));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('rateRecalc: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, '../src');
  const uiFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && entry.name !== 'pipelineExecutor.ts' && entry.name !== 'browserPdf.ts') uiFiles.push(full);
    }
  };
  walk(join(srcRoot, 'components'));
  walk(join(srcRoot, 'ui-state'));
  uiFiles.push(join(srcRoot, 'App.tsx'));
  const allSource = uiFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const codeOnly = allSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no runLoanAuditPipeline call in UI (test 15)', () => {
    assert.equal(/runLoanAuditPipeline/.test(codeOnly), false);
  });

  it('no renderLoanAuditPdf call in UI (test 16)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(codeOnly), false);
  });

  it('no backend/persistence/auth code (test 17)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|process\.env|writeFileSync/i.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no EFKA/pension/insurance wording (test 18)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|ΟΑΕΕ|OAEE|\bΙΚΑ\b|\bIKA\b/i.test(
        allSource,
      ),
      false,
    );
  });

  it('no Ν.3869 or ΑΠ 6/2026 wording (test 19)', () => {
    assert.equal(/3869/.test(allSource), false);
    assert.equal(/6\s*\/\s*2026/.test(allSource), false);
  });

  it('no forbidden legal/conclusion wording (test 20)', () => {
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        allSource,
      ),
      false,
    );
  });
});
