import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Run scaffolding only: serves index.html → src/main.tsx → <App/>.
// No product feature, no engine/renderer/pipeline change.
//
// PDF generation is Node-only (system fonts via node:fs). For the
// browser build we redirect the Node-only font filesystem module to a
// stub so node:fs never enters the client bundle. We use a small
// resolveId plugin (rather than a regex alias, which mangles relative
// specifiers like "./nodeFontFs") to redirect reliably regardless of
// the importer's relative path.
const nodeFontFsBrowserPath = fileURLToPath(
  new URL('./src/renderers/nodeFontFs.browser.ts', import.meta.url),
);

function browserFontFsPlugin() {
  return {
    name: 'loan-audit-pro:browser-font-fs',
    enforce: 'pre' as const,
    resolveId(source: string) {
      // any import resolving to the Node-only provider → browser stub
      if (source === './nodeFontFs' || /(^|\/)nodeFontFs(\.ts)?$/.test(source)) {
        // do not redirect the stub onto itself
        if (source.endsWith('nodeFontFs.browser') || source.endsWith('nodeFontFs.browser.ts')) {
          return null;
        }
        return nodeFontFsBrowserPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  // GitHub Pages serves this project from /loan-audit-pro/. The base must
  // match the repository name so assets (JS, fonts) resolve correctly.
  base: '/loan-audit-pro/',
  plugins: [browserFontFsPlugin(), react()],
  server: {
    port: 5173,
    open: true,
  },
});
