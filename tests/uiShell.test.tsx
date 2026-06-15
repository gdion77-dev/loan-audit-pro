/**
 * Tests: UI shell (Step 11-A).
 * Covers the 12 required scenarios.
 *
 * Rendering strategy: the offline environment has the React 19
 * runtime and react-dom/server but no jsdom, so these are static
 * render smoke tests via renderToStaticMarkup. Navigation (a state
 * change) is exercised by rendering the shell at different
 * initialSection values, which drives the exact same
 * section-selection code path the click handler sets.
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
import { AUDIT_PANEL_TITLE } from '../src/components/layout/AuditPanel';
import { SECTIONS, type SectionId } from '../src/components/sections/sectionDefinitions';
import { createEmptyDraftState } from '../src/ui-state/loanAuditDraftState';

const renderApp = (props: { initialSection?: SectionId } = {}): string =>
  renderToStaticMarkup(React.createElement(App, props));
const renderShell = (props: { initialSection?: SectionId } = {}): string =>
  renderToStaticMarkup(React.createElement(AppShell, props));

/* ------------------------------------------------------------------ */
/* rendering & structure                                               */
/* ------------------------------------------------------------------ */

describe('uiShell: rendering & structure', () => {
  it('app shell renders (test 1)', () => {
    const html = renderApp();
    assert.ok(html.length > 0);
    assert.ok(html.includes('Loan Audit PRO'));
    assert.ok(html.includes('lap-shell'));
  });

  it('sidebar contains all 9 sections (test 2)', () => {
    const html = renderApp();
    assert.equal(SECTIONS.length, 9);
    for (const section of SECTIONS) {
      assert.ok(html.includes(section.title), `missing sidebar item: ${section.title}`);
    }
  });

  it('clicking each sidebar section changes the active section (test 3)', () => {
    // The click handler calls setActiveSection(id); rendering at each
    // initialSection drives the identical selection path. The active
    // section's explanation must appear in the central main area.
    for (const section of SECTIONS) {
      const html = renderShell({ initialSection: section.id });
      assert.ok(
        html.includes(section.explanation),
        `active section ${section.id} did not render its explanation`,
      );
      // exactly one nav item is marked current:
      const currentCount = (html.match(/aria-current="page"/g) ?? []).length;
      assert.equal(currentCount, 1, `expected 1 active nav item for ${section.id}`);
    }
  });

  it('default active section is the first (Στοιχεία Υπόθεσης)', () => {
    const html = renderApp();
    assert.ok(html.includes(SECTIONS[0]!.explanation));
  });
});

/* ------------------------------------------------------------------ */
/* audit panel                                                         */
/* ------------------------------------------------------------------ */

describe('uiShell: audit panel', () => {
  it('audit panel renders with the title «Φάκελος Ελέγχου» (test 4)', () => {
    const html = renderApp();
    assert.equal(AUDIT_PANEL_TITLE, 'Φάκελος Ελέγχου');
    assert.ok(html.includes('Φάκελος Ελέγχου'));
  });

  it('audit panel shows the draft status (placeholder categories replaced) (test 5)', () => {
    // The panel now shows the DRAFT validation summary instead of the
    // old demo categories: an empty draft is «Ελλιπή δεδομένα».
    const html = renderApp();
    assert.ok(html.includes('Κατάσταση προσχεδίου: Ελλιπή δεδομένα'));
    // the old demo category sentences are gone:
    assert.equal(html.includes('Δείγμα: ο επανυπολογισμός θα καλύπτει'), false);
  });
});

/* ------------------------------------------------------------------ */
/* report section                                                      */
/* ------------------------------------------------------------------ */

describe('uiShell: report section', () => {
  it('report section contains «Προεπισκόπηση μελέτης» and «Παραγωγή PDF» (test 6)', () => {
    const html = renderShell({ initialSection: 'report' });
    assert.ok(html.includes('Προεπισκόπηση μελέτης'));
    assert.ok(html.includes('Παραγωγή PDF'));
    assert.ok(html.includes('Δεν έχει εκτελεστεί ακόμη υπολογισμός'));
  });
});

/* ------------------------------------------------------------------ */
/* draft state (Step 11-B)                                             */
/* ------------------------------------------------------------------ */

describe('uiShell: draft state', () => {
  it('AppShell initializes draft state without calling engines (test 7a)', () => {
    // rendering with no draft prop must succeed: the shell builds an
    // all-unknown draft internally, with no engine/pipeline call.
    const html = renderShell();
    assert.ok(html.includes('lap-shell'));
    assert.ok(html.includes('Κατάσταση δεδομένων: Προσωρινό προσχέδιο'));
  });

  it('AppShell can receive an external draft state (test 7b)', () => {
    const draft = createEmptyDraftState();
    // a provided draft renders identically (state is held, not computed):
    const html = renderToStaticMarkup(
      React.createElement(AppShell, { initialDraftState: draft }),
    );
    assert.ok(html.includes('Κατάσταση δεδομένων: Προσωρινό προσχέδιο'));
    // sanity: the provided draft is all-unknown, never zero
    assert.equal(draft.loanTermsDraft.principalCents.status, 'unknown');
    assert.equal(draft.loanTermsDraft.principalCents.value, null);
  });

  it('UI still renders all 9 sections with draft state present (test 8)', () => {
    for (const section of SECTIONS) {
      const html = renderShell({ initialSection: section.id });
      assert.ok(html.includes(section.title), `missing nav item: ${section.title}`);
      assert.ok(html.includes(section.explanation), `missing active body: ${section.id}`);
    }
  });

  it('AuditPanel still renders with its placeholder line (test 9)', () => {
    const html = renderApp();
    assert.ok(html.includes('Φάκελος Ελέγχου'));
    assert.ok(html.includes('Η σύνδεση με πραγματικά AuditEntry θα γίνει σε επόμενο βήμα.'));
  });
});

/* ------------------------------------------------------------------ */
/* scope guards (source scan over the whole UI tree)                   */
/* ------------------------------------------------------------------ */

describe('uiShell: scope guards (source scan)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcRoot = join(here, '../src');

  /** Recursively gather all .ts/.tsx files under src/components + App. */
  const uiFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) uiFiles.push(full);
    }
  };
  walk(join(srcRoot, 'components'));
  uiFiles.push(join(srcRoot, 'App.tsx'));

  const allSource = uiFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const codeOnly = allSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

  it('no calculation engine is called from the UI shell (test 7)', () => {
    assert.equal(
      /buildEqualPrincipalSchedule|buildEqualInstallmentSchedule|compareSchedules|generateFindings|reconcileActualPayments|buildLoanAuditReportModel|runLoanAuditPipeline|resolveRateForDate|calculateDayCount|calculateAccruedInterest|allocateSinglePayment/.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no PDF or report-text renderer is called from the UI shell (test 8)', () => {
    assert.equal(/renderLoanAuditPdf|renderLoanAuditReportText/.test(codeOnly), false);
  });

  it('no backend/persistence/auth code introduced (test 9)', () => {
    assert.equal(
      /fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|express|sqlite|jsonwebtoken|bcrypt|passport|writeFileSync|process\.env/i.test(
        codeOnly,
      ),
      false,
    );
  });

  it('no EFKA/pension/insurance wording (test 10)', () => {
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|\bretirement\b|ΟΑΕΕ|OAEE|\bΙΚΑ\b|\bIKA\b/i.test(
        allSource,
      ),
      false,
    );
  });

  it('no Ν.3869 or ΑΠ 6/2026 wording (test 11)', () => {
    assert.equal(/3869/.test(allSource), false);
    assert.equal(/6\s*\/\s*2026/.test(allSource), false);
  });

  it('no forbidden legal/conclusion wording (test 12)', () => {
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        allSource,
      ),
      false,
    );
  });
});
