/**
 * Loan Audit PRO — src/renderers/browserFontCache.ts
 * ------------------------------------------------------------------
 * Browser-side font support for PDF generation. The locked PDF
 * renderer asks for fonts by absolute path via getFontFs().readFileSync.
 * In a browser there is no filesystem, so we pre-fetch the DejaVu fonts
 * (served from /fonts by Vite) into an in-memory cache keyed by those
 * same default paths, then serve them synchronously.
 *
 * This adds NO rendering logic and changes NO formula — it only feeds
 * the same font bytes the Node path reads from disk.
 */

// The default paths the renderer requests (see pdfReportRenderer.ts).
const REGULAR_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const BOLD_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// Where Vite serves them in the browser. BASE_URL respects the
// configured base (e.g. "/loan-audit-pro/" on GitHub Pages, "/" in dev),
// so the fonts resolve correctly in both environments.
const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/+$/, '');
const REGULAR_URL = `${BASE}/fonts/DejaVuSans.ttf`;
const BOLD_URL = `${BASE}/fonts/DejaVuSans-Bold.ttf`;

const cache = new Map<string, Uint8Array>();

/** True once both fonts are cached and synchronous reads will succeed. */
export function browserFontsReady(): boolean {
  return cache.has(REGULAR_PATH) && cache.has(BOLD_PATH);
}

/**
 * Pre-fetches the DejaVu fonts into the cache. Call once (await) before
 * invoking the synchronous renderer in the browser. Safe to call again;
 * it no-ops when already loaded.
 */
export async function preloadBrowserFonts(): Promise<void> {
  if (browserFontsReady()) return;
  const [regular, bold] = await Promise.all([
    fetch(REGULAR_URL).then((r) => r.arrayBuffer()),
    fetch(BOLD_URL).then((r) => r.arrayBuffer()),
  ]);
  cache.set(REGULAR_PATH, new Uint8Array(regular));
  cache.set(BOLD_PATH, new Uint8Array(bold));
}

/** Synchronous accessor used by the browser getFontFs() stub. */
export function readCachedFont(path: string): Uint8Array | null {
  return cache.get(path) ?? null;
}
