/**
 * tests/fontFsResolution.test.ts
 * ------------------------------------------------------------------
 * Static assertions for the browser-runtime font-fs wiring (run/start
 * fix only — no product logic). Proves:
 *   - pdfReportRenderer imports the font-fs provider and it loads,
 *   - nodeFontFs.ts (Node) and nodeFontFs.browser.ts (stub) both exist,
 *   - the Vite config redirects the provider to the browser stub,
 *   - the ONLY static `node:fs` import lives in nodeFontFs.ts, so no
 *     node:fs import can reach the browser bundle.
 *
 * Runner: node:test via tsx (registry unavailable in this
 * environment; structure is vitest-compatible).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const renderersDir = join(root, 'src/renderers');

/* ------------------------------------------------------------------ */
/* file presence                                                       */
/* ------------------------------------------------------------------ */

describe('fontFsResolution: files', () => {
  it('nodeFontFs.ts (Node provider) exists', () => {
    assert.ok(existsSync(join(renderersDir, 'nodeFontFs.ts')));
  });

  it('nodeFontFs.browser.ts (browser stub) exists', () => {
    assert.ok(existsSync(join(renderersDir, 'nodeFontFs.browser.ts')));
  });
});

/* ------------------------------------------------------------------ */
/* import resolves at runtime (Node)                                   */
/* ------------------------------------------------------------------ */

describe('fontFsResolution: provider import', () => {
  it('pdfReportRenderer imports the provider and the module loads', async () => {
    const renderer = await import('../src/renderers/pdfReportRenderer');
    assert.equal(typeof renderer.renderLoanAuditPdf, 'function');
  });

  it('the Node provider returns a usable fs accessor', async () => {
    const { getFontFs } = await import('../src/renderers/nodeFontFs');
    const fs = getFontFs();
    assert.ok(fs);
    assert.equal(typeof fs.existsSync, 'function');
    assert.equal(typeof fs.readFileSync, 'function');
  });

  it('the browser stub exposes a font provider backed by the browser cache', async () => {
    const stub = await import('../src/renderers/nodeFontFs.browser');
    const fs = stub.getFontFs();
    // The provider object exists; before any preload its existsSync is false
    // (cache empty) — it does NOT touch node:fs.
    assert.ok(fs);
    assert.equal(fs.existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'), false);
  });

  it('pdfReportRenderer imports from the relative provider specifier', () => {
    const src = readFileSync(join(renderersDir, 'pdfReportRenderer.ts'), 'utf8');
    assert.ok(/import\s+\{[^}]*getFontFs[^}]*\}\s+from\s+'\.\/nodeFontFs'/.test(src));
  });
});

/* ------------------------------------------------------------------ */
/* vite redirection                                                    */
/* ------------------------------------------------------------------ */

describe('fontFsResolution: vite redirection', () => {
  const viteConfig = readFileSync(join(root, 'vite.config.ts'), 'utf8');

  it('vite config redirects the provider to the browser stub', () => {
    assert.ok(viteConfig.includes('nodeFontFs.browser.ts'));
    // a resolveId redirect (or alias) keyed on the provider module:
    assert.ok(/nodeFontFs/.test(viteConfig));
    assert.ok(/resolveId|alias/.test(viteConfig));
  });
});

/* ------------------------------------------------------------------ */
/* no node:fs reaches the browser bundle                               */
/* ------------------------------------------------------------------ */

describe('fontFsResolution: node:fs containment', () => {
  /** All .ts/.tsx files under src/. */
  const srcFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) srcFiles.push(full);
    }
  };
  walk(join(root, 'src'));

  it('the ONLY static node:fs import is in nodeFontFs.ts', () => {
    const importers = srcFiles.filter((f) => {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      return /from\s+'node:fs'|from\s+"node:fs"|require\(\s*'node:fs'\s*\)/.test(code);
    });
    assert.deepEqual(
      importers.map((f) => f.replace(root + '/', '')),
      ['src/renderers/nodeFontFs.ts'],
    );
  });

  it('the browser stub contains no node:fs import', () => {
    const code = readFileSync(join(renderersDir, 'nodeFontFs.browser.ts'), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/.*/g,
      '',
    );
    assert.equal(/node:fs|require\(\s*['"]fs['"]\s*\)/.test(code), false);
  });

  it('main.tsx (browser entry) does not statically import node:fs', () => {
    const code = readFileSync(join(root, 'src/main.tsx'), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/.*/g,
      '',
    );
    assert.equal(/node:fs/.test(code), false);
  });
});
