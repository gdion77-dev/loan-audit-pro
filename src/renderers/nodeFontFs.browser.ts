/**
 * Loan Audit PRO — src/renderers/nodeFontFs.browser.ts
 * ------------------------------------------------------------------
 * Browser font provider (Vite aliases nodeFontFs → this file, so
 * node:fs never enters the client bundle). Instead of a filesystem, it
 * serves the DejaVu font bytes that were pre-fetched into the in-memory
 * browser cache (see browserFontCache.ts). If the fonts have not been
 * preloaded yet, it reports "not found" and the renderer degrades
 * gracefully — exactly as it does for a missing font on Node.
 *
 * No rendering logic or formula lives here; it only hands the same font
 * bytes to the locked renderer that the Node path reads from disk.
 */
import { readCachedFont } from './browserFontCache';

export interface FontFs {
  readonly existsSync: (path: string) => boolean;
  readonly readFileSync: (path: string) => Buffer;
}

export function getFontFs(): FontFs | null {
  return {
    existsSync: (path: string): boolean => readCachedFont(path) !== null,
    readFileSync: (path: string): Buffer => {
      const bytes = readCachedFont(path);
      if (bytes === null) {
        throw new Error('Font not preloaded in browser cache: ' + path);
      }
      // Buffer is available in the browser via Vite/rollup polyfill only if
      // imported; the renderer's parseTtf uses Buffer methods, so we wrap
      // the bytes in a Buffer view. In the browser bundle, Buffer is
      // provided by the 'buffer' polyfill (added as a dependency).
      return Buffer.from(bytes);
    },
  };
}
