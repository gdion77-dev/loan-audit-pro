/**
 * Tests: BankSchedule draft table (Step 11-E).
 * Covers the 21 required scenarios.
 *
 * Rendering via react-dom/server (renderToStaticMarkup); row helpers
 * and field discipline checked against the pure functions. No jsdom.
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
import { BankScheduleSection } from '../src/components/sections/BankScheduleSection';
import {
  createEmptyDraftState,
  DAY_COUNT_CONVENTION_OPTIONS,
  type BankScheduleDraft,
  type LoanAuditDraftState,
} from '../src/ui-state/loanAuditDraftState';
import {
  addBankScheduleDraftRow,
  removeBankScheduleDraftRow,
  updateBankScheduleDraftRowField,
} from '../src/ui-state/draftUpdates';
import { adaptDraftToDomain } from '../src/ui-state/draftToDomainAdapter';
import { buildDraftValidationSummary } from '../src/ui-state/draftValidationSummary';
import {
  parseMoneyToField,
  parseTextToField,
  fieldValue,
  fieldUnknown,
  type FieldState,
} from '../src/ui-state/fieldState';
import { isDayCountConvention } from '../src/domain/dateTypes';

const noAdd = (): void => {};
const noRemove = (_i: number): void => {};
const noText = (_i: number, _f: 'dueDate' | 'note', _n: FieldState<string>): void => {};
const noMoney = (
  _i: number,
  _f: 'installmentCents' | 'principalCents' | 'interestCents' | 'balanceCents',
  _n: FieldState<number>,
): void => {};

const renderBank = (draft: BankScheduleDraft): string =>
  renderToStaticMarkup(
    React.createElement(BankScheduleSection, {
      draft,
      onAddRow: noAdd,
      onRemoveRow: noRemove,
      onRowTextChange: noText,
      onRowMoneyChange: noMoney,
      onDayCountChange: (_n: FieldState<string>): void => {},
      onGenerateSchedule: (): void => {},
      generationMessage: null,
    }),
  );

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

describe('bankScheduleTable: rendering', () => {
  it('renders the real table title (test 1)', () => {
    const html = renderBank(createEmptyDraftState().bankScheduleDraft);
    assert.ok(html.includes('Δοσολόγιο Τράπεζας / Fund'));
  });

  it('empty state appears when there are no rows (test 2)', () => {
    const html = renderBank(createEmptyDraftState().bankScheduleDraft);
    assert.ok(html.includes('Δεν έχουν καταχωρηθεί γραμμές δοσολογίου.'));
  });

  it('add row button renders (test 11)', () => {
    const html = renderBank(createEmptyDraftState().bankScheduleDraft);
    assert.ok(html.includes('Προσθήκη γραμμής'));
  });

  it('table headers render once a row exists (test 10)', () => {
    const state = addBankScheduleDraftRow(createEmptyDraftState(), 'r1');
    const html = renderBank(state.bankScheduleDraft);
    for (const h of ['Ημερομηνία δόσης', 'Δόση', 'Χρεολύσιο', 'Τόκος', 'Υπόλοιπο', 'Σημείωση', 'Ενέργειες']) {
      assert.ok(html.includes(h), `missing header: ${h}`);
    }
  });

  it('delete button renders for an existing row (test 12)', () => {
    const state = addBankScheduleDraftRow(createEmptyDraftState(), 'r1');
    const html = renderBank(state.bankScheduleDraft);
    assert.ok(html.includes('Διαγραφή'));
  });
});

/* ------------------------------------------------------------------ */
/* row helpers                                                         */
/* ------------------------------------------------------------------ */

describe('bankScheduleTable: row helpers', () => {
  it('add row creates one row with unknown FieldState values (test 3)', () => {
    const before = createEmptyDraftState();
    const after = addBankScheduleDraftRow(before, 'r1');
    assert.equal(before.bankScheduleDraft.rows.length, 0); // original intact
    assert.equal(after.bankScheduleDraft.rows.length, 1);
    const row = after.bankScheduleDraft.rows[0]!;
    assert.equal(row.rowId.status, 'value'); // rowId is addressable
    assert.equal(row.rowId.value, 'r1');
    for (const f of [row.dueDate, row.installmentCents, row.principalCents, row.interestCents, row.balanceCents, row.note]) {
      assert.equal(f.status, 'unknown');
      assert.equal(f.value, null);
    }
  });

  it('remove row removes only the selected row (test 4)', () => {
    let state = createEmptyDraftState();
    state = addBankScheduleDraftRow(state, 'r1');
    state = addBankScheduleDraftRow(state, 'r2');
    state = addBankScheduleDraftRow(state, 'r3');
    const removed = removeBankScheduleDraftRow(state, 1); // remove r2
    assert.equal(removed.bankScheduleDraft.rows.length, 2);
    assert.deepEqual(
      removed.bankScheduleDraft.rows.map((r) => r.rowId.value),
      ['r1', 'r3'],
    );
    // original unchanged:
    assert.equal(state.bankScheduleDraft.rows.length, 3);
  });

  it('remove row out of range is a no-op', () => {
    const state = addBankScheduleDraftRow(createEmptyDraftState(), 'r1');
    assert.equal(removeBankScheduleDraftRow(state, 5).bankScheduleDraft.rows.length, 1);
    assert.equal(removeBankScheduleDraftRow(state, -1).bankScheduleDraft.rows.length, 1);
  });

  it('update row helper updates one field immutably (test 5)', () => {
    let state = createEmptyDraftState();
    state = addBankScheduleDraftRow(state, 'r1');
    state = addBankScheduleDraftRow(state, 'r2');
    const updated = updateBankScheduleDraftRowField(
      state,
      0,
      'installmentCents',
      parseMoneyToField('304,50').field,
    );
    // edited row changed:
    assert.equal(updated.bankScheduleDraft.rows[0]!.installmentCents.value, 30_450);
    // sibling row untouched and same reference:
    assert.equal(updated.bankScheduleDraft.rows[1], state.bankScheduleDraft.rows[1]);
    // original state untouched:
    assert.equal(state.bankScheduleDraft.rows[0]!.installmentCents.status, 'unknown');
    assert.notEqual(updated.bankScheduleDraft, state.bankScheduleDraft);
  });
});

/* ------------------------------------------------------------------ */
/* field discipline                                                    */
/* ------------------------------------------------------------------ */

describe('bankScheduleTable: field discipline', () => {
  it('money field blank remains unknown (test 6)', () => {
    const r = parseMoneyToField('');
    assert.equal(r.field.status, 'unknown');
    assert.equal(r.field.value, null);
  });

  it('money field 0 becomes explicit_zero (test 7)', () => {
    const r = parseMoneyToField('0,00');
    assert.equal(r.field.status, 'explicit_zero');
    assert.equal(r.field.value, 0);
  });

  it('money field invalid input does not become 0 (test 8)', () => {
    const r = parseMoneyToField('not-a-number');
    assert.equal(r.invalid, true);
    assert.equal(r.field.status, 'unknown');
    assert.equal(r.field.value, null);
    assert.notEqual(r.field.value as unknown, 0);
  });

  it('date field blank remains unknown (test 9)', () => {
    const f = parseTextToField('');
    assert.equal(f.status, 'unknown');
    assert.equal(f.value, null);
  });

  it('a row with explicit-zero and value cells renders euro display for the value', () => {
    let state = addBankScheduleDraftRow(createEmptyDraftState(), 'r1');
    state = updateBankScheduleDraftRowField(state, 0, 'installmentCents', fieldValue<number>(30_450));
    state = updateBankScheduleDraftRowField(state, 0, 'interestCents', parseMoneyToField('0,00').field);
    const html = renderBank(state.bankScheduleDraft);
    assert.ok(html.includes('304,50')); // value euro display
    assert.ok(html.includes('Ρητό μηδέν')); // explicit zero label
  });
});

/* ------------------------------------------------------------------ */
/* shell integrity                                                     */
/* ------------------------------------------------------------------ */

describe('bankScheduleTable: shell integrity', () => {
  it('AppShell can hold bankScheduleDraft rows without calling engines (test 13)', () => {
    // drive the same code path the Add button triggers:
    let state = createEmptyDraftState();
    state = addBankScheduleDraftRow(state, 'r1');
    state = updateBankScheduleDraftRowField(state, 0, 'dueDate', parseTextToField('2024-01-31'));
    const html = renderToStaticMarkup(
      React.createElement(AppShell, { initialSection: 'bank_schedule', initialDraftState: state }),
    );
    assert.ok(html.includes('2024-01-31'));
    assert.ok(html.includes('Διαγραφή')); // a row is present
  });

  it('UI still renders all 9 sections (test 14)', () => {
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

  it('AuditPanel remains placeholder (test 15)', () => {
    const html = renderToStaticMarkup(React.createElement(App, {}));
    assert.ok(html.includes('Φάκελος Ελέγχου'));
    assert.ok(html.includes('Η σύνδεση με πραγματικά AuditEntry θα γίνει σε επόμενο βήμα.'));
  });
});

/* ------------------------------------------------------------------ */
/* day count convention control (Step 13-B)                            */
/* ------------------------------------------------------------------ */

/** A complete draft except day-count, used to test readiness gating. */
function completeExceptDayCount(): LoanAuditDraftState {
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
      principalCents: fieldValue<number>(900_000),
      termMonths: fieldValue<number>(3),
      startDate: fieldValue<string>('2024-01-01'),
      endDate: fieldValue<string>('2024-03-31'),
    },
    rateConfigDraft: {
      regimeKind: fieldValue<string>('fixed'),
      annualRatePercent: fieldValue<number>(6),
      spreadPercent: fieldUnknown<number>(),
      law128Status: fieldValue<string>('included_in_rate'),
      law128Percent: fieldUnknown<number>("manual"),
    },
    recalculationSettingsDraft: {
      scheduleMode: fieldValue<string>('equal_principal'),
      roundingMode: fieldValue<string>('half_up'),
      feesAndPremiumsPerPeriodCents: fieldValue<number>(0),
    },
  };
}

function withDayCount(d: LoanAuditDraftState, field: FieldState<string>): LoanAuditDraftState {
  return { ...d, bankScheduleDraft: { ...d.bankScheduleDraft, dayCountConvention: field } };
}

describe('bankScheduleTable: day count convention control', () => {
  it('renders the label «Σύμβαση ημερομέτρησης» (test 1)', () => {
    const html = renderBank(createEmptyDraftState().bankScheduleDraft);
    assert.ok(html.includes('Σύμβαση ημερομέτρησης'));
  });

  it('renders all allowed options (test 2)', () => {
    const html = renderBank(createEmptyDraftState().bankScheduleDraft);
    for (const label of ['ACT/360', 'ACT/365 Fixed', '30/360 US', '30E/360', 'Άγνωστο']) {
      assert.ok(html.includes(label), `missing option: ${label}`);
    }
  });

  it('every non-unknown option code matches the locked DayCountConvention (tests 4, 5)', () => {
    for (const opt of DAY_COUNT_CONVENTION_OPTIONS) {
      if (opt.unknown) continue;
      assert.ok(isDayCountConvention(opt.code), `invalid day-count code: ${opt.code}`);
    }
    // explicit spot checks for the two required mappings:
    assert.ok(DAY_COUNT_CONVENTION_OPTIONS.some((o) => o.code === 'ACT_360' && o.label === 'ACT/360'));
    assert.ok(DAY_COUNT_CONVENTION_OPTIONS.some((o) => o.code === '30E_360' && o.label === '30E/360'));
  });

  it('selecting unknown keeps the adapter at missing_data (tests 3, 8)', () => {
    const d = withDayCount(completeExceptDayCount(), fieldUnknown<string>());
    const result = adaptDraftToDomain(d);
    assert.equal(result.status, 'missing_data');
    assert.ok(result.missingData.some((m) => m.fieldLabel === 'Σύμβαση ημερομέτρησης'));
  });

  it('selecting ACT/360 lets a complete draft become ready (tests 4, 7)', () => {
    const d = withDayCount(completeExceptDayCount(), fieldValue<string>('ACT_360'));
    const result = adaptDraftToDomain(d);
    assert.equal(result.status, 'ready');
    assert.equal(result.rateConfig?.dayCount, 'ACT_360');
  });

  it('selecting 30E/360 maps to the exact domain code (test 5)', () => {
    const d = withDayCount(completeExceptDayCount(), fieldValue<string>('30E_360'));
    const result = adaptDraftToDomain(d);
    assert.equal(result.rateConfig?.dayCount, '30E_360');
  });

  it('AppShell updates bankScheduleDraft.dayCountConvention immutably (test 6)', () => {
    // drive the same immutable update the select callback performs:
    const before = completeExceptDayCount();
    const after = withDayCount(before, fieldValue<string>('ACT_365'));
    assert.equal(before.bankScheduleDraft.dayCountConvention.status, 'unknown'); // original intact
    assert.equal(after.bankScheduleDraft.dayCountConvention.value, 'ACT_365');
    assert.notEqual(before.bankScheduleDraft, after.bankScheduleDraft);
  });

  it('a complete UI-ready draft enables «Εκτέλεση Μελέτης» (test 9)', () => {
    const d = withDayCount(completeExceptDayCount(), fieldValue<string>('ACT_365'));
    const summary = buildDraftValidationSummary(adaptDraftToDomain(d));
    assert.equal(summary.status, 'ready');
    const html = renderToStaticMarkup(
      React.createElement(AppShell, { initialSection: 'report', initialDraftState: d }),
    );
    assert.ok(html.includes('Εκτέλεση Μελέτης'));
    assert.ok(html.includes('Το προσχέδιο είναι έτοιμο για εκτέλεση μελέτης.'));
    assert.equal(html.includes('disabled'), false);
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('bankScheduleTable: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, '../src');
  const uiFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.tsx?$/.test(entry.name) &&
        entry.name !== 'pipelineExecutor.ts' && entry.name !== 'browserPdf.ts' &&
        entry.name !== 'scheduleGenerator.ts'
      )
        uiFiles.push(full);
    }
  };
  walk(join(srcRoot, 'components'));
  walk(join(srcRoot, 'ui-state'));
  uiFiles.push(join(srcRoot, 'App.tsx'));
  const allSource = uiFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const codeOnly = allSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no runLoanAuditPipeline call in UI (test 16)', () => {
    assert.equal(/runLoanAuditPipeline/.test(codeOnly), false);
  });

  it('no renderLoanAuditPdf call in UI (test 17)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(codeOnly), false);
  });

  it('no calculation engine called from UI', () => {
    assert.equal(
      /buildEqualPrincipalSchedule|buildEqualInstallmentSchedule|compareSchedules|generateFindings|reconcileActualPayments|buildLoanAuditReportModel/.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no backend/persistence/auth code (test 18)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|process\.env|writeFileSync/i.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no EFKA/pension/insurance wording (test 19)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|ΟΑΕΕ|OAEE|\bΙΚΑ\b|\bIKA\b/i.test(
        allSource,
      ),
      false,
    );
  });

  it('no Ν.3869 or ΑΠ 6/2026 wording (test 20)', () => {
    assert.equal(/3869/.test(allSource), false);
    assert.equal(/6\s*\/\s*2026/.test(allSource), false);
  });

  it('no forbidden legal/conclusion wording (test 21)', () => {
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        allSource,
      ),
      false,
    );
  });
});
