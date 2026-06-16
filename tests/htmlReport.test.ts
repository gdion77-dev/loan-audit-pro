/**
 * tests/htmlReport.test.ts
 * ------------------------------------------------------------------
 * Tests for the professional client report builder. It injects real
 * pipeline data into the approved design template (REPORT_DATA) and
 * recomputes nothing. We assert the document is produced, the injection
 * marker is replaced with real case data, and neutral wording holds.
 *
 * Runner: node:test via tsx (registry unavailable; vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildAslanisCepalDraft } from './fixtures/aslanisCepalFixture';
import { executePipelineFromDraft } from '../src/ui-state/pipelineExecutor';
import { buildHtmlReport } from '../src/ui-state/htmlReport';
import { getReportTemplateHtml } from '../src/report-template/reportTemplate';

function buildReport(): string {
  const outcome = executePipelineFromDraft(buildAslanisCepalDraft(), { renderPdf: false });
  const r = buildHtmlReport(outcome.result);
  assert.equal(r.status, 'ok');
  return r.html;
}

describe('htmlReport: template', () => {
  it('decodes the embedded design template', () => {
    const t = getReportTemplateHtml();
    assert.ok(t.includes('<!doctype html>') || t.includes('<!DOCTYPE html>'));
    assert.ok(t.includes('REPORT_DATA'));
  });

  it('embeds the office details (author block)', () => {
    const t = getReportTemplateHtml();
    assert.ok(t.includes('Διονυσίου Φ. Γεώργιος'));
    assert.ok(t.includes('Οικονομολόγος'));
    assert.ok(t.includes('Αγίου Νικολάου 1, Σάμος 83100'));
  });

  it('inlines the logo as a data-URI (no external file)', () => {
    const t = getReportTemplateHtml();
    assert.ok(t.includes('data:image/png;base64,'));
    assert.equal(t.includes('src="bizboost-logo.png"'), false);
  });
});

describe('htmlReport: data injection', () => {
  const html = buildReport();

  it('produces a complete HTML document', () => {
    assert.ok(html.includes('</html>'));
  });

  it('injects REPORT_DATA with the real case figures', () => {
    assert.ok(html.includes('window.REPORT_DATA ='));
    // injected JSON should carry the debtor name from the fixture
    assert.ok(/"debtor":/.test(html));
    assert.ok(/"comparedPeriods":/.test(html));
    assert.ok(/"findings":/.test(html));
  });

  it('includes the analytic schedule (amortization rows with dates)', () => {
    assert.ok(/"amortization":\[/.test(html));
    assert.ok(/"date":/.test(html));
    assert.ok(/"balance":/.test(html));
    assert.ok(html.includes('schedule-rows'));
  });

  it('replaces the injection marker', () => {
    assert.equal(html.includes('<!--REPORT_DATA_INJECTION-->'), false);
  });
});

describe('htmlReport: safety', () => {
  it('returns no_data when there is no pipeline result', () => {
    const r = buildHtmlReport(null);
    assert.equal(r.status, 'no_data');
    assert.equal(r.html, '');
  });

  it('uses neutral wording in the injected data', () => {
    const html = buildReport();
    // extract just the injected JSON block to avoid template sample text
    const m = /window\.REPORT_DATA = (\{[\s\S]*?\});<\/script>/.exec(html);
    assert.ok(m && m[1] !== undefined);
    const json = m[1];
    assert.equal(
      /αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα|ΕΦΚΑ|σύνταξ/i.test(
        json,
      ),
      false,
    );
  });
});
