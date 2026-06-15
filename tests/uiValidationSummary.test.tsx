/**
 * Tests: validation summary UI (Step 12-B).
 * Covers the 17 required scenarios.
 *
 * Rendering via react-dom/server (renderToStaticMarkup). The panel is
 * driven by the real adapter → summary pipeline; AppShell computes
 * the summary from its draft state. No jsdom, no engine call.
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
import { AuditPanel } from '../src/components/layout/AuditPanel';
import { adaptDraftToDomain } from '../src/ui-state/draftToDomainAdapter';
import { buildDraftValidationSummary } from '../src/ui-state/draftValidationSummary';
import {
  createEmptyDraftState,
  type LoanAuditDraftState,
} from '../src/ui-state/loanAuditDraftState';
import { addBankScheduleDraftRow, updateBankScheduleDraftRowField } from '../src/ui-state/draftUpdates';
import { fieldValue, fieldExplicitZero, fieldUnknown, parseTextToField } from '../src/ui-state/fieldState';

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

const panelFor = (draft: LoanAuditDraftState): string =>
  renderToStaticMarkup(
    React.createElement(AuditPanel, {
      summary: buildDraftValidationSummary(adaptDraftToDomain(draft)),
    }),
  );

/* ------------------------------------------------------------------ */
/* panel basics                                                        */
/* ------------------------------------------------------------------ */

describe('validationUI: panel basics', () => {
  it('AuditPanel renders «Φάκελος Ελέγχου» (test 1)', () => {
    assert.ok(panelFor(createEmptyDraftState()).includes('Φάκελος Ελέγχου'));
  });

  it('empty/unknown draft shows «Ελλιπή δεδομένα» (test 2)', () => {
    const html = panelFor(createEmptyDraftState());
    assert.ok(html.includes('Κατάσταση προσχεδίου: Ελλιπή δεδομένα'));
  });

  it('complete draft can show «Έτοιμο» (test 3)', () => {
    const html = panelFor(completeDraft());
    assert.ok(html.includes('Κατάσταση προσχεδίου: Έτοιμο'));
    assert.ok(html.includes('Δεν εντοπίστηκαν ελλείψεις στο προσχέδιο.'));
  });

  it('requires_review draft shows «Απαιτείται έλεγχος» (test 4)', () => {
    // complete but with unknown law128Status → requires_review
    const base = completeDraft();
    const draft: LoanAuditDraftState = {
      ...base,
      rateConfigDraft: { ...base.rateConfigDraft, law128Status: fieldUnknown<string>() },
    };
    const html = panelFor(draft);
    assert.ok(html.includes('Κατάσταση προσχεδίου: Απαιτείται έλεγχος'));
  });
});

/* ------------------------------------------------------------------ */
/* issue rendering                                                     */
/* ------------------------------------------------------------------ */

describe('validationUI: issues', () => {
  it('issues are grouped by section (test 5)', () => {
    const html = panelFor(createEmptyDraftState());
    // section group headers appear for sections with issues:
    assert.ok(html.includes('Στοιχεία Υπόθεσης'));
    assert.ok(html.includes('Όροι Δανείου / Ρύθμισης'));
    assert.ok(html.includes('Ρυθμίσεις Επανυπολογισμού'));
  });

  it('issue fieldLabel and message render (test 6)', () => {
    const html = panelFor(createEmptyDraftState());
    assert.ok(html.includes('Κεφάλαιο αναφοράς'));
    assert.ok(html.includes('Ελλείπει το κεφάλαιο αναφοράς· δεν τεκμαίρεται μηδενικό.'));
    // level labels are mapped to Greek:
    assert.ok(html.includes('Ελλιπή δεδομένα'));
  });

  it('rowId renders when an issue has row context (test 7)', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b-empty'); // empty row → info with rowId
    const html = panelFor(d);
    assert.ok(html.includes('Γραμμή: b-empty'));
  });

  it('no-issues state renders the clean message (test 8)', () => {
    const html = panelFor(completeDraft());
    assert.ok(html.includes('Δεν εντοπίστηκαν ελλείψεις στο προσχέδιο.'));
  });

  it('level labels map correctly (Πληροφορία/Προειδοποίηση/Απαιτείται έλεγχος/Ελλιπή δεδομένα)', () => {
    // missing_data present on empty draft:
    assert.ok(panelFor(createEmptyDraftState()).includes('Ελλιπή δεδομένα'));
    // info present when an empty bank row is added to a complete draft:
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b-empty');
    assert.ok(panelFor(d).includes('Πληροφορία'));
  });
});

/* ------------------------------------------------------------------ */
/* AppShell integration                                                */
/* ------------------------------------------------------------------ */

describe('validationUI: AppShell integration', () => {
  it('AppShell computes the validation summary from draft state (test 9)', () => {
    // empty draft → AppShell shows missing-data status in the panel
    const empty = renderToStaticMarkup(React.createElement(App, {}));
    assert.ok(empty.includes('Κατάσταση προσχεδίου: Ελλιπή δεδομένα'));
    // a complete initial draft → ready
    const ready = renderToStaticMarkup(
      React.createElement(AppShell, { initialDraftState: completeDraft() }),
    );
    assert.ok(ready.includes('Κατάσταση προσχεδίου: Έτοιμο'));
  });

  it('AppShell summary reflects a populated bank row', () => {
    let d = completeDraft();
    d = addBankScheduleDraftRow(d, 'b1');
    d = updateBankScheduleDraftRowField(d, 0, 'dueDate', parseTextToField('2024-01-31'));
    const html = renderToStaticMarkup(
      React.createElement(AppShell, { initialDraftState: d, initialSection: 'bank_schedule' }),
    );
    // a date-only row is included but warns about missing amounts:
    assert.ok(html.includes('Κατάσταση προσχεδίου: Απαιτείται έλεγχος'));
  });

  it('UI still renders all 9 sections (test 10)', () => {
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
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan)                                          */
/* ------------------------------------------------------------------ */

describe('validationUI: scope guards (source scan)', () => {
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

  it('no runLoanAuditPipeline call in UI (test 11)', () => {
    assert.equal(/runLoanAuditPipeline/.test(codeOnly), false);
  });

  it('no reconcileActualPayments call in UI (test 12)', () => {
    assert.equal(/reconcileActualPayments/.test(codeOnly), false);
  });

  it('no renderLoanAuditPdf call in UI (test 13)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(codeOnly), false);
  });

  it('no backend/persistence/auth code (test 14)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|process\.env|writeFileSync/i.test(
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
