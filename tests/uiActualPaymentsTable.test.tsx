/**
 * Tests: ActualPayments draft table (Step 11-F).
 * Covers the 23 required scenarios.
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
import { ActualPaymentsSection } from '../src/components/sections/ActualPaymentsSection';
import {
  createEmptyDraftState,
  type ActualPaymentsDraft,
} from '../src/ui-state/loanAuditDraftState';
import {
  addActualPaymentDraftRow,
  removeActualPaymentDraftRow,
  updateActualPaymentDraftRowField,
} from '../src/ui-state/draftUpdates';
import { parseMoneyToField, parseTextToField, fieldValue, type FieldState } from '../src/ui-state/fieldState';

const noAdd = (): void => {};
const noRemove = (_i: number): void => {};
const noText = (
  _i: number,
  _f: 'paymentDate' | 'matchedScheduleRowId' | 'note',
  _n: FieldState<string>,
): void => {};
const noMoney = (_i: number, _f: 'amountCents', _n: FieldState<number>): void => {};

const renderPayments = (draft: ActualPaymentsDraft): string =>
  renderToStaticMarkup(
    React.createElement(ActualPaymentsSection, {
      draft,
      onAddRow: noAdd,
      onRemoveRow: noRemove,
      onRowTextChange: noText,
      onRowMoneyChange: noMoney,
    }),
  );

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */

describe('actualPaymentsTable: rendering', () => {
  it('renders the real table title (test 1)', () => {
    const html = renderPayments(createEmptyDraftState().actualPaymentsDraft);
    assert.ok(html.includes('Πραγματικές Καταβολές'));
  });

  it('empty state appears when there are no rows (test 2)', () => {
    const html = renderPayments(createEmptyDraftState().actualPaymentsDraft);
    assert.ok(html.includes('Δεν έχουν καταχωρηθεί πραγματικές καταβολές.'));
  });

  it('add payment button renders (test 12)', () => {
    const html = renderPayments(createEmptyDraftState().actualPaymentsDraft);
    assert.ok(html.includes('Προσθήκη καταβολής'));
  });

  it('table headers render once a row exists (test 11)', () => {
    const state = addActualPaymentDraftRow(createEmptyDraftState(), 'p1');
    const html = renderPayments(state.actualPaymentsDraft);
    for (const h of [
      'Ημερομηνία καταβολής',
      'Ποσό καταβολής',
      'Αντιστοίχιση με γραμμή δοσολογίου',
      'Σημείωση',
      'Ενέργειες',
    ]) {
      assert.ok(html.includes(h), `missing header: ${h}`);
    }
  });

  it('delete button renders for an existing row (test 13)', () => {
    const state = addActualPaymentDraftRow(createEmptyDraftState(), 'p1');
    const html = renderPayments(state.actualPaymentsDraft);
    assert.ok(html.includes('Διαγραφή'));
  });
});

/* ------------------------------------------------------------------ */
/* row helpers                                                         */
/* ------------------------------------------------------------------ */

describe('actualPaymentsTable: row helpers', () => {
  it('add payment creates one row with unknown FieldState values (test 3)', () => {
    const before = createEmptyDraftState();
    const after = addActualPaymentDraftRow(before, 'p1');
    assert.equal(before.actualPaymentsDraft.rows.length, 0);
    assert.equal(after.actualPaymentsDraft.rows.length, 1);
    const row = after.actualPaymentsDraft.rows[0]!;
    assert.equal(row.paymentId.status, 'value'); // addressable
    assert.equal(row.paymentId.value, 'p1');
    for (const f of [row.paymentDate, row.amountCents, row.matchedScheduleRowId, row.note]) {
      assert.equal(f.status, 'unknown');
      assert.equal(f.value, null);
    }
  });

  it('remove payment removes only the selected row (test 4)', () => {
    let state = createEmptyDraftState();
    state = addActualPaymentDraftRow(state, 'p1');
    state = addActualPaymentDraftRow(state, 'p2');
    state = addActualPaymentDraftRow(state, 'p3');
    const removed = removeActualPaymentDraftRow(state, 1);
    assert.deepEqual(
      removed.actualPaymentsDraft.rows.map((r) => r.paymentId.value),
      ['p1', 'p3'],
    );
    assert.equal(state.actualPaymentsDraft.rows.length, 3); // original intact
  });

  it('remove payment out of range is a no-op', () => {
    const state = addActualPaymentDraftRow(createEmptyDraftState(), 'p1');
    assert.equal(removeActualPaymentDraftRow(state, 9).actualPaymentsDraft.rows.length, 1);
    assert.equal(removeActualPaymentDraftRow(state, -1).actualPaymentsDraft.rows.length, 1);
  });

  it('update payment helper updates one field immutably (test 5)', () => {
    let state = createEmptyDraftState();
    state = addActualPaymentDraftRow(state, 'p1');
    state = addActualPaymentDraftRow(state, 'p2');
    const updated = updateActualPaymentDraftRowField(
      state,
      0,
      'amountCents',
      parseMoneyToField('304,50').field,
    );
    assert.equal(updated.actualPaymentsDraft.rows[0]!.amountCents.value, 30_450);
    assert.equal(updated.actualPaymentsDraft.rows[1], state.actualPaymentsDraft.rows[1]); // sibling shared
    assert.equal(state.actualPaymentsDraft.rows[0]!.amountCents.status, 'unknown'); // original intact
    assert.notEqual(updated.actualPaymentsDraft, state.actualPaymentsDraft);
  });
});

/* ------------------------------------------------------------------ */
/* field discipline                                                    */
/* ------------------------------------------------------------------ */

describe('actualPaymentsTable: field discipline', () => {
  it('amount blank remains unknown (test 6)', () => {
    const r = parseMoneyToField('');
    assert.equal(r.field.status, 'unknown');
    assert.equal(r.field.value, null);
  });

  it('amount 0 becomes explicit_zero (test 7)', () => {
    const r = parseMoneyToField('0,00');
    assert.equal(r.field.status, 'explicit_zero');
    assert.equal(r.field.value, 0);
  });

  it('amount invalid input does not become 0 (test 8)', () => {
    const r = parseMoneyToField('xyz');
    assert.equal(r.invalid, true);
    assert.equal(r.field.status, 'unknown');
    assert.equal(r.field.value, null);
    assert.notEqual(r.field.value as unknown, 0);
  });

  it('paymentDate blank remains unknown (test 9)', () => {
    const f = parseTextToField('');
    assert.equal(f.status, 'unknown');
    assert.equal(f.value, null);
  });

  it('matchedScheduleRowId blank remains unknown (test 10)', () => {
    const f = parseTextToField('   ');
    assert.equal(f.status, 'unknown');
    assert.equal(f.value, null);
  });

  it('an amount value renders euro display; explicit zero shows «Ρητό μηδέν»', () => {
    let state = addActualPaymentDraftRow(createEmptyDraftState(), 'p1');
    state = updateActualPaymentDraftRowField(state, 0, 'amountCents', fieldValue<number>(30_450));
    const htmlValue = renderPayments(state.actualPaymentsDraft);
    assert.ok(htmlValue.includes('304,50'));
    let zeroState = addActualPaymentDraftRow(createEmptyDraftState(), 'p2');
    zeroState = updateActualPaymentDraftRowField(zeroState, 0, 'amountCents', parseMoneyToField('0,00').field);
    const htmlZero = renderPayments(zeroState.actualPaymentsDraft);
    assert.ok(htmlZero.includes('Ρητό μηδέν'));
  });
});

/* ------------------------------------------------------------------ */
/* shell integrity                                                     */
/* ------------------------------------------------------------------ */

describe('actualPaymentsTable: shell integrity', () => {
  it('AppShell can hold actualPaymentsDraft rows without calling engines (test 14)', () => {
    let state = createEmptyDraftState();
    state = addActualPaymentDraftRow(state, 'p1');
    state = updateActualPaymentDraftRowField(state, 0, 'paymentDate', parseTextToField('2024-01-31'));
    const html = renderToStaticMarkup(
      React.createElement(AppShell, { initialSection: 'actual_payments', initialDraftState: state }),
    );
    // The payment date is stored as ISO internally but DISPLAYED as
    // dd/mm/yyyy (DateFieldStateControl), matching every other date
    // field in the app.
    assert.ok(html.includes('31/01/2024'));
    assert.ok(html.includes('Διαγραφή'));
  });

  it('UI still renders all 9 sections (test 15)', () => {
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

  it('AuditPanel remains placeholder (test 16)', () => {
    const html = renderToStaticMarkup(React.createElement(App, {}));
    assert.ok(html.includes('Φάκελος Ελέγχου'));
    assert.ok(html.includes('Η σύνδεση με πραγματικά AuditEntry θα γίνει σε επόμενο βήμα.'));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('actualPaymentsTable: scope guards (source scan)', () => {
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

  it('no runLoanAuditPipeline call in UI (test 17)', () => {
    assert.equal(/runLoanAuditPipeline/.test(codeOnly), false);
  });

  it('no reconcileActualPayments call in UI (test 18)', () => {
    assert.equal(/reconcileActualPayments/.test(codeOnly), false);
  });

  it('no renderLoanAuditPdf call in UI (test 19)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(codeOnly), false);
  });

  it('no backend/persistence/auth code (test 20)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|process\.env|writeFileSync/i.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no EFKA/pension/insurance wording (test 21)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|ΟΑΕΕ|OAEE|\bΙΚΑ\b|\bIKA\b/i.test(
        allSource,
      ),
      false,
    );
  });

  it('no Ν.3869 or ΑΠ 6/2026 wording (test 22)', () => {
    assert.equal(/3869/.test(allSource), false);
    assert.equal(/6\s*\/\s*2026/.test(allSource), false);
  });

  it('no forbidden legal/conclusion wording (test 23)', () => {
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        allSource,
      ),
      false,
    );
  });
});
