/**
 * tests/dateDisplay.test.ts
 * ------------------------------------------------------------------
 * Tests for the date presentation helpers (dd/mm/yyyy ↔ ISO) and the
 * derived month count, plus that LoanTermsSection shows dates in
 * dd/mm/yyyy and auto-derives the term from start/end. No engine logic
 * is exercised; storage stays ISO.
 *
 * Runner: node:test via tsx (registry unavailable; vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import { isoToDisplay, displayToIso, monthsBetweenIso, isCompleteIso } from '../src/ui-state/dateDisplay';
import { LoanTermsSection } from '../src/components/sections/LoanTermsSection';
import { createEmptyDraftState } from '../src/ui-state/loanAuditDraftState';
import { fieldValue } from '../src/ui-state/fieldState';

describe('dateDisplay: conversions', () => {
  it('ISO → dd/mm/yyyy', () => {
    assert.equal(isoToDisplay('2024-01-01'), '01/01/2024');
    assert.equal(isoToDisplay('2034-12-31'), '31/12/2034');
  });

  it('dd/mm/yyyy → ISO (and tolerant of d/m/yyyy)', () => {
    assert.equal(displayToIso('01/01/2024'), '2024-01-01');
    assert.equal(displayToIso('1/1/2024'), '2024-01-01');
    assert.equal(displayToIso('31-12-2034'), '2034-12-31');
  });

  it('keeps already-ISO and partial input as-is', () => {
    assert.equal(displayToIso('2024-01-01'), '2024-01-01');
    assert.equal(displayToIso('01/01'), '01/01'); // still typing
  });

  it('isCompleteIso recognises full ISO dates only', () => {
    assert.equal(isCompleteIso('2024-01-01'), true);
    assert.equal(isCompleteIso('01/01/2024'), false);
  });
});

describe('dateDisplay: month derivation', () => {
  it('counts whole months between two ISO dates', () => {
    assert.equal(monthsBetweenIso('2024-01-01', '2034-01-01'), 120);
    assert.equal(monthsBetweenIso('2024-01-01', '2029-02-01'), 61);
    assert.equal(monthsBetweenIso('2024-08-01', '2030-08-01'), 72);
  });

  it('returns null for missing/invalid/inverted ranges', () => {
    assert.equal(monthsBetweenIso('2024-01-01', ''), null);
    assert.equal(monthsBetweenIso('2030-01-01', '2024-01-01'), null);
  });
});

describe('LoanTermsSection: presentation', () => {
  const render = (start?: string, end?: string): string => {
    let draft = createEmptyDraftState().loanTermsDraft;
    if (start) draft = { ...draft, startDate: fieldValue<string>(start, 'manual') };
    if (end) draft = { ...draft, endDate: fieldValue<string>(end, 'manual') };
    return renderToStaticMarkup(
      React.createElement(LoanTermsSection, {
        draft,
        onNumberFieldChange: () => {},
        onTextFieldChange: () => {},
      }),
    );
  };

  it('shows date labels in dd/mm/yyyy form', () => {
    const html = render();
    assert.ok(html.includes('Ημερομηνία έναρξης (ηη/μμ/εεεε)'));
    assert.ok(html.includes('Ημερομηνία λήξης (ηη/μμ/εεεε)'));
  });

  it('renders stored ISO dates as dd/mm/yyyy in the inputs', () => {
    const html = render('2024-01-01', '2034-01-01');
    assert.ok(html.includes('01/01/2024'));
    assert.ok(html.includes('01/01/2034'));
  });

  it('auto-derives and shows the term in months when both dates are set', () => {
    const html = render('2024-01-01', '2034-01-01');
    assert.ok(html.includes('Διάρκεια (μήνες) — αυτόματα'));
    assert.ok(html.includes('120'));
  });

  it('shows the manual term field when dates are not both set', () => {
    const html = render('2024-01-01');
    assert.ok(html.includes('Διάρκεια (μήνες)'));
    assert.equal(html.includes('— αυτόματα'), false);
  });
});
