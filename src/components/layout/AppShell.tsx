/**
 * Loan Audit PRO — src/components/layout/AppShell.tsx
 * ------------------------------------------------------------------
 * The three-zone application shell: left sidebar navigation, central
 * active section, right audit panel. Owns the active-section state
 * and the LoanAuditDraftState. The first two sections are connected
 * to the draft via immutable update callbacks; the rest remain
 * placeholders. Purely presentational — no engine, PDF, pipeline,
 * backend, persistence or auth.
 */
import React from 'react';
import { useState, useMemo } from 'react';
import { SidebarNavigation } from './SidebarNavigation';
import { AuditPanel } from './AuditPanel';
import { type SectionId } from '../sections/sectionDefinitions';
import { adaptDraftToDomain } from '../../ui-state/draftToDomainAdapter';
import { buildDraftValidationSummary } from '../../ui-state/draftValidationSummary';
import {
  executePipelineFromDraft,
  type PipelineRunStatus,
} from '../../ui-state/pipelineExecutor';
import { downloadPdfBytes, browserDownloadEnvironment } from '../../ui-state/pdfDownload';
import { generateScheduleRows } from '../../ui-state/scheduleGenerator';
import { generatePdfInBrowser } from '../../ui-state/browserPdf';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';
import {
  createEmptyDraftState,
  type LoanAuditDraftState,
  type CaseInfoDraft,
  type RateConfigDraft,
  type RecalculationSettingsDraft,
} from '../../ui-state/loanAuditDraftState';
import { updateDraftField } from '../../ui-state/draftUpdates';
import {
  addBankScheduleDraftRow,
  removeBankScheduleDraftRow,
  updateBankScheduleDraftRowField,
  addActualPaymentDraftRow,
  removeActualPaymentDraftRow,
  updateActualPaymentDraftRowField,
} from '../../ui-state/draftUpdates';
import type { FieldState } from '../../ui-state/fieldState';
import { CaseInfoSection } from '../sections/CaseInfoSection';
import { LoanTermsSection } from '../sections/LoanTermsSection';
import { RateConfigSection } from '../sections/RateConfigSection';
import { BankScheduleSection } from '../sections/BankScheduleSection';
import { ActualPaymentsSection } from '../sections/ActualPaymentsSection';
import { RecalculationSettingsSection } from '../sections/RecalculationSettingsSection';
import { ComparisonSection } from '../sections/ComparisonSection';
import { FindingsSection } from '../sections/FindingsSection';
import { ReportSection } from '../sections/ReportSection';

export interface AppShellProps {
  /** Optional initial section (used by tests). */
  readonly initialSection?: SectionId;
  /** Optional initial draft state; defaults to an all-unknown draft. */
  readonly initialDraftState?: LoanAuditDraftState;
}

export const AppShell: React.FC<AppShellProps> = ({ initialSection, initialDraftState }) => {
  const [activeSection, setActiveSection] = useState<SectionId>(
    initialSection ?? 'case_info',
  );
  // Draft state lives here. Updates are immutable; no engine, pipeline
  // or PDF call is ever involved — this is UI state only.
  const [draftState, setDraftState] = useState<LoanAuditDraftState>(
    initialDraftState ?? createEmptyDraftState(),
  );

  // Draft validation summary, recomputed whenever the draft changes.
  // adaptDraftToDomain is a pure shaping/validation pass — it calls no
  // engine, no pipeline, no renderer.
  const validationSummary = useMemo(
    () => buildDraftValidationSummary(adaptDraftToDomain(draftState)),
    [draftState],
  );

  // Pipeline execution state. runLoanAuditPipeline is synchronous, so
  // 'running' is transient and not surfaced here.
  const [pipelineResult, setPipelineResult] = useState<LoanAuditPipelineResult | null>(null);
  const [pipelineRunStatus, setPipelineRunStatus] = useState<PipelineRunStatus>('not_run');
  const [pdfBrowserMessage, setPdfBrowserMessage] = useState<string | null>(null);

  const onExecutePipeline = (): void => {
    // gate again at execution time; the helper itself also re-validates
    if (validationSummary.status !== 'ready') return;
    // PDF rendering is Node-only (system fonts via node:fs). In a browser
    // there is no filesystem, so we run the pipeline without PDF and show
    // a clear "unavailable in browser preview" message instead.
    const pdfAvailable =
      typeof globalThis === 'object' &&
      typeof (globalThis as { require?: unknown }).require === 'function';
    const outcome = executePipelineFromDraft(draftState, { renderPdf: pdfAvailable });
    setPipelineResult(outcome.result);
    setPipelineRunStatus(outcome.runStatus);
  };

  const onDownloadPdf = (): void => {
    // If the pipeline already produced bytes (Node path), download them.
    // Otherwise (browser), generate the PDF on demand from the stored
    // report text using the locked renderer — no recomputation.
    if (typeof document === 'undefined' || typeof URL === 'undefined') return;
    const contractNumber =
      pipelineResult?.reportModelResult?.reportModel?.caseInfo?.contractNumber ?? null;
    const existing = pipelineResult?.pdfResult?.pdfBytes ?? null;
    if (existing !== null && existing.length > 0) {
      downloadPdfBytes(existing, contractNumber, browserDownloadEnvironment(document, URL));
      return;
    }
    setGenerationMessage(null);
    void generatePdfInBrowser(pipelineResult).then((res) => {
      if (res.status === 'ok' && res.pdfBytes !== null) {
        downloadPdfBytes(res.pdfBytes, contractNumber, browserDownloadEnvironment(document, URL));
      } else {
        setPdfBrowserMessage(res.message);
      }
    });
  };

  const onCaseInfoChange = (field: keyof CaseInfoDraft, next: FieldState<string>): void => {
    setDraftState((prev) => updateDraftField(prev, 'caseInfoDraft', field, next));
  };
  const onLoanTermsNumberChange = (
    field: 'principalCents' | 'termMonths',
    next: FieldState<number>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'loanTermsDraft', field, next));
  };
  const onLoanTermsTextChange = (
    field: 'startDate' | 'endDate',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'loanTermsDraft', field, next));
  };
  const onRateConfigSelectChange = (
    field: 'regimeKind' | 'law128Status',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'rateConfigDraft', field, next));
  };
  const onRateConfigNumberChange = (
    field: 'annualRatePercent' | 'spreadPercent',
    next: FieldState<number>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'rateConfigDraft', field, next));
  };
  const onRecalcSelectChange = (
    field: 'scheduleMode' | 'roundingMode',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'recalculationSettingsDraft', field, next));
  };
  const onRecalcMoneyChange = (
    field: 'feesAndPremiumsPerPeriodCents',
    next: FieldState<number>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'recalculationSettingsDraft', field, next));
  };
  const onBankAddRow = (): void => {
    setDraftState((prev) => addBankScheduleDraftRow(prev));
  };
  const onBankRemoveRow = (index: number): void => {
    setDraftState((prev) => removeBankScheduleDraftRow(prev, index));
  };
  const onBankRowTextChange = (
    index: number,
    field: 'dueDate' | 'note',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateBankScheduleDraftRowField(prev, index, field, next));
  };
  const onBankRowMoneyChange = (
    index: number,
    field: 'installmentCents' | 'principalCents' | 'interestCents' | 'balanceCents',
    next: FieldState<number>,
  ): void => {
    setDraftState((prev) => updateBankScheduleDraftRowField(prev, index, field, next));
  };
  const onBankDayCountChange = (next: FieldState<string>): void => {
    setDraftState((prev) => ({
      ...prev,
      bankScheduleDraft: { ...prev.bankScheduleDraft, dayCountConvention: next },
    }));
  };

  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const onGenerateSchedule = (): void => {
    // Delegates entirely to the locked engines via the sanctioned helper;
    // rows are replaced only on success (the button label/warning makes the
    // replacement explicit). On block/unsupported, existing rows are kept.
    const result = generateScheduleRows(draftState);
    // Surface the locked engine's own neutral audit/warning messages so the
    // user can see WHY no rows were produced (read-only, no recomputation).
    const composed =
      result.engineMessages.length > 0
        ? `${result.message} Λεπτομέρειες ελέγχου: ${result.engineMessages.join(' · ')}`
        : result.message;
    setGenerationMessage(composed);
    if (result.status === 'generated') {
      setDraftState((prev) => ({
        ...prev,
        bankScheduleDraft: { ...prev.bankScheduleDraft, rows: result.rows },
      }));
    }
  };
  const onPaymentAddRow = (): void => {
    setDraftState((prev) => addActualPaymentDraftRow(prev));
  };
  const onPaymentRemoveRow = (index: number): void => {
    setDraftState((prev) => removeActualPaymentDraftRow(prev, index));
  };
  const onPaymentRowTextChange = (
    index: number,
    field: 'paymentDate' | 'matchedScheduleRowId' | 'note',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateActualPaymentDraftRowField(prev, index, field, next));
  };
  const onPaymentRowMoneyChange = (
    index: number,
    field: 'amountCents',
    next: FieldState<number>,
  ): void => {
    setDraftState((prev) => updateActualPaymentDraftRowField(prev, index, field, next));
  };

  const renderActive = (): React.ReactElement => {
    if (activeSection === 'case_info') {
      return (
        <CaseInfoSection draft={draftState.caseInfoDraft} onFieldChange={onCaseInfoChange} />
      );
    }
    if (activeSection === 'loan_terms') {
      return (
        <LoanTermsSection
          draft={draftState.loanTermsDraft}
          onNumberFieldChange={onLoanTermsNumberChange}
          onTextFieldChange={onLoanTermsTextChange}
        />
      );
    }
    if (activeSection === 'rate_config') {
      return (
        <RateConfigSection
          draft={draftState.rateConfigDraft}
          onSelectChange={onRateConfigSelectChange}
          onNumberChange={onRateConfigNumberChange}
        />
      );
    }
    if (activeSection === 'recalc_settings') {
      return (
        <RecalculationSettingsSection
          draft={draftState.recalculationSettingsDraft}
          onSelectChange={onRecalcSelectChange}
          onMoneyChange={onRecalcMoneyChange}
        />
      );
    }
    if (activeSection === 'bank_schedule') {
      return (
        <BankScheduleSection
          draft={draftState.bankScheduleDraft}
          onAddRow={onBankAddRow}
          onRemoveRow={onBankRemoveRow}
          onRowTextChange={onBankRowTextChange}
          onRowMoneyChange={onBankRowMoneyChange}
          onDayCountChange={onBankDayCountChange}
          onGenerateSchedule={onGenerateSchedule}
          generationMessage={generationMessage}
        />
      );
    }
    if (activeSection === 'actual_payments') {
      return (
        <ActualPaymentsSection
          draft={draftState.actualPaymentsDraft}
          onAddRow={onPaymentAddRow}
          onRemoveRow={onPaymentRemoveRow}
          onRowTextChange={onPaymentRowTextChange}
          onRowMoneyChange={onPaymentRowMoneyChange}
        />
      );
    }
    if (activeSection === 'report') {
      return (
        <ReportSection
          draftStatus={validationSummary.status}
          pipelineRunStatus={pipelineRunStatus}
          pipelineResult={pipelineResult}
          onExecute={onExecutePipeline}
          onDownloadPdf={onDownloadPdf}
          pdfBrowserMessage={pdfBrowserMessage}
        />
      );
    }
    if (activeSection === 'comparison') {
      return <ComparisonSection pipelineResult={pipelineResult} />;
    }
    // findings is the only remaining section
    return <FindingsSection pipelineResult={pipelineResult} />;
  };

  return (
    <div className="lap-shell">
      <SidebarNavigation activeSection={activeSection} onSelect={setActiveSection} />
      <main className="lap-main" aria-label="Ενεργή ενότητα">
        <p className="lap-draft-indicator" role="status">
          Κατάσταση δεδομένων: Προσωρινό προσχέδιο
        </p>
        {renderActive()}
      </main>
      <AuditPanel summary={validationSummary} pipelineResult={pipelineResult} />
    </div>
  );
};
