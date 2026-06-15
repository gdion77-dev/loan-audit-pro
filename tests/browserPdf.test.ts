/**
 * tests/browserPdf.test.ts
 * ------------------------------------------------------------------
 * Tests for browser-native, on-demand PDF generation. The browser path
 * reuses the stored report text and the LOCKED renderer with fonts
 * fetched into the browser cache. We simulate the browser by backing
 * fetch with the on-disk public fonts and supplying the Buffer
 * polyfill — no formula or rendering logic is exercised differently.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer as PolyBuffer } from 'buffer';

import { buildAslanisCepalDraft } from './fixtures/aslanisCepalFixture';
import { executePipelineFromDraft } from '../src/ui-state/pipelineExecutor';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/* ------------------------------------------------------------------ */
/* font assets exist                                                   */
/* ------------------------------------------------------------------ */

describe('browserPdf: font assets', () => {
  it('public/fonts contains the DejaVu fonts served to the browser', () => {
    assert.ok(existsSync(join(root, 'public/fonts/DejaVuSans.ttf')));
    assert.ok(existsSync(join(root, 'public/fonts/DejaVuSans-Bold.ttf')));
  });
});

/* ------------------------------------------------------------------ */
/* on-demand generation (simulated browser)                            */
/* ------------------------------------------------------------------ */

describe('browserPdf: on-demand generation', () => {
  before(() => {
    // Back fetch() with the on-disk public fonts and supply Buffer, as a
    // browser would have after the buffer polyfill loads in main.tsx.
    const reg = readFileSync(join(root, 'public/fonts/DejaVuSans.ttf'));
    const bold = readFileSync(join(root, 'public/fonts/DejaVuSans-Bold.ttf'));
    (globalThis as { fetch?: unknown }).fetch = async (url: string) => ({
      arrayBuffer: async () => {
        const b = url.includes('Bold') ? bold : reg;
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
    });
    (globalThis as { Buffer?: unknown }).Buffer = PolyBuffer;
  });

  it('preloads fonts into the browser cache', async () => {
    const { preloadBrowserFonts, browserFontsReady } = await import('../src/renderers/browserFontCache');
    assert.equal(browserFontsReady(), false);
    await preloadBrowserFonts();
    assert.equal(browserFontsReady(), true);
  });

  it('generates a non-empty PDF from stored report text (no pipeline PDF)', async () => {
    const outcome = executePipelineFromDraft(buildAslanisCepalDraft(), { renderPdf: false });
    assert.equal(outcome.result?.pdfResult, null); // pipeline produced no PDF
    assert.ok(outcome.result?.reportTextResult); // but report text exists

    const { generatePdfInBrowser } = await import('../src/ui-state/browserPdf');
    const res = await generatePdfInBrowser(outcome.result);
    assert.equal(res.status, 'ok');
    assert.ok(res.pdfBytes && res.pdfBytes.length > 0);
  });

  it('reports no_report_text when there is nothing to render', async () => {
    const { generatePdfInBrowser } = await import('../src/ui-state/browserPdf');
    const res = await generatePdfInBrowser(null);
    assert.equal(res.status, 'no_report_text');
    assert.equal(res.pdfBytes, null);
  });
});

/* ------------------------------------------------------------------ */
/* scope guards                                                        */
/* ------------------------------------------------------------------ */

describe('browserPdf: scope guards (source scan)', () => {
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
  const bpdf = readFileSync(join(root, 'src/ui-state/browserPdf.ts'), 'utf8');
  const cache = readFileSync(join(root, 'src/renderers/browserFontCache.ts'), 'utf8');

  it('browserPdf has no node:fs and no backend/persistence', () => {
    const code = strip(bpdf) + '\n' + strip(cache);
    assert.equal(/node:fs|localStorage|sessionStorage|indexedDB|XMLHttpRequest|express/i.test(code), false);
  });

  it('browserPdf reuses the locked renderer (no duplicated formula)', () => {
    const code = strip(bpdf);
    assert.ok(/renderLoanAuditPdf/.test(code));
    assert.equal(/Math\.pow|annuity|readUInt|parseTtf/i.test(code), false);
  });

  it('no forbidden wording', () => {
    const all = bpdf + '\n' + cache;
    assert.equal(
      /ΕΦΚΑ|EFKA|ασφαλιστικ|συνταξιοδοτικ|σ[ύυ]νταξ|\bpension\b|3869|6\/2026|αχρεωστήτως|προς επιστροφή|διεκδίκηση|παράνομο|άκυρο|δικαιούται|οφείλει η τράπεζα/i.test(
        all,
      ),
      false,
    );
  });
});
