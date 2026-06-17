/**
 * Loan Audit PRO — src/App.tsx
 * ------------------------------------------------------------------
 * Application root. Renders the AppShell. Created fresh in Step 11-A
 * (no prior App.tsx existed). The lightweight stylesheet string is
 * exported so a future host page can inject it; the shell itself
 * uses plain class names and needs no external UI library.
 */
import React from 'react';
import { AppShell } from './components/layout/AppShell';
import type { SectionId } from './components/sections/sectionDefinitions';
import type { LoanAuditDraftState } from './ui-state/loanAuditDraftState';

export interface AppProps {
  readonly initialSection?: SectionId;
  readonly initialDraftState?: LoanAuditDraftState;
}

export const App: React.FC<AppProps> = ({ initialSection, initialDraftState }) => (
  <div className="lap-app">
    <AppShell
      {...(initialSection !== undefined ? { initialSection } : {})}
      {...(initialDraftState !== undefined ? { initialDraftState } : {})}
    />
  </div>
);

export default App;

/** Minimal professional styling; no design-system dependency. */
export const APP_STYLES = `
.lap-app { font-family: system-ui, sans-serif; color: #1d1d1f; }
.lap-shell { display: flex; gap: 12px; align-items: stretch; min-height: 100vh; padding: 12px; box-sizing: border-box; background: #f5f5f7; }
.lap-sidebar { flex: 0 0 220px; background: #fff; border: 0.5px solid #d2d2d7; border-radius: 10px; padding: 12px; }
.lap-sidebar__brand { margin: 0; font-size: 15px; font-weight: 600; }
.lap-sidebar__subtitle { margin: 2px 0 12px; font-size: 11px; color: #6e6e73; }
.lap-sidebar__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.lap-nav-item { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: none; border-radius: 8px; background: transparent; font-size: 13px; text-align: left; cursor: pointer; color: #1d1d1f; }
.lap-nav-item:hover { background: #f0f0f3; }
.lap-nav-item--active { background: #e6f1fb; font-weight: 500; }
.lap-nav-item__index { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #e8e8ed; font-size: 11px; flex: none; }
.lap-main { flex: 1; min-width: 0; }
.lap-draft-indicator { margin: 0 0 10px; font-size: 12px; padding: 6px 10px; background: #eef6ff; color: #0c447c; border-radius: 8px; display: inline-block; }
.lap-card { background: #fff; border: 0.5px solid #d2d2d7; border-radius: 10px; padding: 18px; }
.lap-card__title { margin: 0 0 6px; font-size: 18px; }
.lap-card__explanation { margin: 0 0 14px; font-size: 13px; color: #424245; }
.lap-card__note { margin: 14px 0 0; font-size: 12px; color: #6e6e73; font-style: italic; }
.lap-card__subtitle { margin: 22px 0 4px; font-size: 14px; font-weight: 600; color: #1d1d1f; }
.lap-form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin: 6px 0 4px; }
.lap-field { display: flex; flex-direction: column; gap: 4px; }
.lap-field__label { font-size: 12px; color: #424245; }
.lap-field__input { font-size: 13px; padding: 8px 10px; border: 0.5px solid #d2d2d7; border-radius: 8px; background: #fff; }
.lap-field__input:focus { outline: 2px solid #b9d8f7; border-color: #87b8e8; }
.lap-field select.lap-field__input { appearance: none; background-image: linear-gradient(45deg, transparent 50%, #6e6e73 50%), linear-gradient(135deg, #6e6e73 50%, transparent 50%); background-position: calc(100% - 16px) center, calc(100% - 11px) center; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; padding-right: 28px; }
.lap-field__state { font-size: 11px; padding: 1px 7px; border-radius: 999px; align-self: flex-start; }
.lap-field__state--value { background: #e3f2e8; color: #1d6b38; }
.lap-field__state--explicit_zero { background: #fdf1d6; color: #7a5300; }
.lap-field__state--unknown { background: #ececed; color: #6e6e73; }
.lap-field__euro { font-size: 12px; color: #1d1d1f; }
.lap-field__hint { font-size: 11px; color: #8a4b00; }
.lap-report-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.lap-report-card { border: 0.5px solid #d2d2d7; border-radius: 8px; padding: 12px; }
.lap-report-card__title { margin: 0 0 4px; font-size: 14px; }
.lap-report-card__hint { margin: 0 0 10px; font-size: 12px; color: #6e6e73; }
.lap-btn { font-size: 13px; padding: 7px 12px; border-radius: 8px; border: 0.5px solid #d2d2d7; background: #fff; cursor: pointer; }
.lap-btn:disabled { color: #aeaeb2; cursor: not-allowed; }
.lap-btn--danger { color: #8a2018; border-color: #e7c3bf; }
.lap-empty-state { margin: 14px 0 0; font-size: 13px; color: #6e6e73; padding: 16px; background: #f5f5f7; border-radius: 8px; text-align: center; }
.lap-table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
.lap-table th { text-align: left; font-weight: 600; color: #424245; padding: 6px 8px; border-bottom: 1px solid #d2d2d7; white-space: nowrap; }
.lap-table td { padding: 6px 8px; vertical-align: top; border-bottom: 0.5px solid #e8e8ed; }
.lap-table .lap-field__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.lap-status { margin: 14px 0 0; font-size: 13px; padding: 8px 10px; background: #faeeda; color: #633806; border-radius: 8px; }
.lap-audit-panel { flex: 0 0 240px; background: #fff; border: 0.5px solid #d2d2d7; border-radius: 10px; padding: 12px; }
.lap-audit-panel__title { margin: 0 0 4px; font-size: 14px; }
.lap-audit-panel__hint { margin: 0 0 12px; font-size: 11px; color: #6e6e73; }
.lap-audit-group { margin-bottom: 12px; }
.lap-audit-group__label { margin: 0 0 4px; font-size: 12px; letter-spacing: 0.03em; color: #6e6e73; text-transform: uppercase; }
.lap-audit-group__list { list-style: none; margin: 0; padding: 0; }
.lap-audit-group__entry { font-size: 11.5px; line-height: 1.4; padding: 6px 8px; border-radius: 6px; background: #f5f5f7; margin-bottom: 4px; }
.lap-draft-status { font-size: 12px; font-weight: 600; padding: 7px 10px; border-radius: 8px; margin: 0 0 10px; }
.lap-draft-status--ready { background: #e3f2e8; color: #1d6b38; }
.lap-draft-status--requires-review { background: #fdf1d6; color: #7a5300; }
.lap-draft-status--missing-data { background: #f7e2df; color: #8a2018; }
.lap-audit-empty { font-size: 12px; color: #1d6b38; padding: 8px 10px; background: #e3f2e8; border-radius: 8px; }
.lap-audit-issue { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; line-height: 1.35; padding: 7px 8px; border-radius: 6px; background: #f5f5f7; margin-bottom: 5px; }
.lap-audit-issue__level { font-size: 10px; letter-spacing: 0.03em; text-transform: uppercase; font-weight: 600; color: #6e6e73; }
.lap-audit-issue--missing_data .lap-audit-issue__level { color: #8a2018; }
.lap-audit-issue--requires_review .lap-audit-issue__level { color: #7a5300; }
.lap-audit-issue--warning .lap-audit-issue__level { color: #7a5300; }
.lap-audit-issue--info .lap-audit-issue__level { color: #0c447c; }
.lap-audit-issue__field { font-weight: 600; }
.lap-audit-issue__row { font-size: 10.5px; color: #6e6e73; }
.lap-audit-pipeline { margin-top: 14px; border-top: 1px solid #d2d2d7; padding-top: 10px; }
.lap-audit-panel__subtitle { margin: 0 0 8px; font-size: 13px; }
.lap-report-pdf-flag { margin: 8px 0 0; font-size: 12px; color: #424245; }
.lap-result-status { margin: 8px 0 0; font-size: 13px; }
.lap-result-grid { margin: 12px 0 0; display: flex; flex-direction: column; gap: 0; }
.lap-result-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 0.5px solid #e8e8ed; font-size: 13px; }
.lap-result-row dt { color: #424245; margin: 0; }
.lap-result-row dd { margin: 0; font-weight: 600; text-align: right; }
.lap-sign-convention { margin: 14px 0 0; font-size: 12px; color: #6e6e73; font-style: italic; }
.lap-comparison-table { margin-top: 14px; }
.lap-comparison-table td { white-space: nowrap; }
.lap-btn-row { display: flex; flex-wrap: wrap; gap: 8px; }
.lap-btn--secondary { background: #e8e8ed; color: #1d1d1f; }
.lap-field-help { margin: 4px 0 10px; font-size: 11.5px; color: #6e6e73; }
.lap-findings-list { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.lap-finding { display: flex; flex-direction: column; gap: 2px; padding: 10px; border: 0.5px solid #d2d2d7; border-radius: 8px; font-size: 12.5px; }
.lap-finding__id { font-size: 11px; color: #6e6e73; }
.lap-finding__level { font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; color: #7a5300; }
.lap-finding__title { font-weight: 600; }
.lap-finding__periods { font-size: 11.5px; color: #6e6e73; }
.lap-finding__safe { font-size: 11px; color: #6e6e73; }
.lap-report-preview { margin-top: 14px; }
.lap-report-preview__box { margin: 8px 0 0; padding: 12px; background: #f5f5f7; border: 0.5px solid #d2d2d7; border-radius: 8px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; }
.lap-report-preview__note { margin: 8px 0 0; font-size: 12px; color: #6e6e73; font-style: italic; }
@media (max-width: 820px) { .lap-shell { flex-direction: column; } .lap-sidebar, .lap-audit-panel { flex: 1 1 auto; } }
`;
