/**
 * Loan Audit PRO — src/main.tsx
 * ------------------------------------------------------------------
 * Browser entry point. Mounts the existing <App/> into #root and
 * injects the exported APP_STYLES stylesheet. This is run scaffolding
 * only — it adds no product feature and changes no engine, renderer,
 * pipeline, comparison, findings or report logic.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Buffer } from 'buffer';
import App, { APP_STYLES } from './App';

// The locked PDF renderer parses TrueType fonts using Node's Buffer API.
// Provide a Buffer polyfill in the browser so browser-native PDF works.
// This adds no rendering logic — it only supplies the Buffer the
// renderer already expects.
if (typeof (globalThis as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}

// inject the component stylesheet once
const styleEl = document.createElement('style');
styleEl.textContent = APP_STYLES;
document.head.appendChild(styleEl);

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root not found');
}
createRoot(container).render(React.createElement(App, {}));
