/**
 * Loan Audit PRO — src/renderers/nodeFontFs.ts
 * ------------------------------------------------------------------
 * Node-only filesystem access used by the PDF renderer to read system
 * font files. Isolated in its own module so the browser build can
 * alias it to a stub (see vite.config.ts → resolve.alias), keeping
 * node:fs out of the client bundle. No rendering logic lives here.
 */
import { readFileSync, existsSync } from 'node:fs';

export interface FontFs {
  readonly existsSync: (path: string) => boolean;
  readonly readFileSync: (path: string) => Buffer;
}

/** Returns the Node filesystem accessor (always available on Node). */
export function getFontFs(): FontFs | null {
  return { existsSync, readFileSync };
}
