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
import type { ActualPaymentsAmortizationResult } from '../../engines/actualPaymentsAmortizationEngine';
import { downloadPdfBytes, browserDownloadEnvironment } from '../../ui-state/pdfDownload';
import { generateScheduleRows } from '../../ui-state/scheduleGenerator';
import { generatePdfInBrowser } from '../../ui-state/browserPdf';
import { openHtmlReport } from '../../ui-state/htmlReport';
import type { LoanAuditPipelineResult } from '../../engines/loanAuditPipelineRunner';
import {
  createEmptyDraftState,
  type LoanAuditDraftState,
  type CaseInfoDraft,
  type RateConfigDraft,
  type RecalculationSettingsDraft,
  type FloatingRateObservation,
  type FloatingRateLockMeta,
} from '../../ui-state/loanAuditDraftState';
import { updateDraftField } from '../../ui-state/draftUpdates';
import { fetchEcbIndex, type EcbIndexCode, type EcbFetchStatus } from '../../services/ecbRateService';import {
  addBankScheduleDraftRow,
  removeBankScheduleDraftRow,
  updateBankScheduleDraftRowField,
  addActualPaymentDraftRow,
  addManyActualPaymentDraftRows,
  removeActualPaymentDraftRow,
  updateActualPaymentDraftRowField,
  addExtraChargeDraftRow,
  removeExtraChargeDraftRow,
  updateExtraChargeDraftRowField,
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
import { SavedCasesSection } from '../sections/SavedCasesSection';

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
  // Id of the saved case currently loaded (null = unsaved/new case).
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null);

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
  const [actualPaymentsAmortization, setActualPaymentsAmortization] =
    useState<ActualPaymentsAmortizationResult | null>(null);
  const [pdfBrowserMessage, setPdfBrowserMessage] = useState<string | null>(null);
  const [ecbFetchStatus, setEcbFetchStatus] = useState<EcbFetchStatus | 'idle' | 'loading'>('idle');
  const [ecbFetchMessage, setEcbFetchMessage] = useState<string | null>(null);

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
    setActualPaymentsAmortization(outcome.actualPaymentsAmortization);
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

  // Builds the cover/methodology rate label. For floating rate, returns a
  // DESCRIPTION (index + spread + Ν.128) rather than a single number, since
  // a floating rate changes per period and one figure would mislead.
  const buildRateLabel = (): string | undefined => {
    const rc = draftState.rateConfigDraft;
    const regime = rc.regimeKind.status === 'value' ? rc.regimeKind.value : null;
    if (regime !== 'floating') return undefined; // fixed: keep existing numeric label
    const INDEX: Record<string, string> = {
      EURIBOR_1M: 'Euribor 1M',
      EURIBOR_3M: 'Euribor 3M',
      EURIBOR_6M: 'Euribor 6M',
      EURIBOR_12M: 'Euribor 12M',
      ECB: 'Επιτόκιο ΕΚΤ',
      other: 'Δείκτης',
    };
    const idx = rc.floatingIndexType.status === 'value' && rc.floatingIndexType.value
      ? (INDEX[rc.floatingIndexType.value] ?? 'Δείκτης')
      : 'Δείκτης';
    const fmt = (n: number) => n.toLocaleString('el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const spread = rc.spreadPercent.status === 'value' && rc.spreadPercent.value != null
      ? ` + ${fmt(rc.spreadPercent.value)}%`
      : '';
    const law128 =
      rc.law128Status.status === 'value' &&
      rc.law128Status.value === 'added_separately' &&
      rc.law128Percent.status === 'value' &&
      rc.law128Percent.value != null
        ? ` (+ ${fmt(rc.law128Percent.value)}% Ν.128)`
        : '';
    return `${idx}${spread}${law128} — κυμαινόμενο`;
  };

  const onAnalystNotesChange = (next: FieldState<string>): void => {
    setDraftState((prev) => updateDraftField(prev, 'reportNotesDraft', 'analystNotes', next));
  };

  const onLoadCase = (draft: LoanAuditDraftState, caseId: string | null): void => {
    // Loading a saved/imported case replaces the working draft and
    // clears any prior study results (they belong to the old case).
    setDraftState(draft);
    setCurrentCaseId(caseId);
    setPipelineResult(null);
    setPipelineRunStatus('not_run');
    setActualPaymentsAmortization(null);
    setPdfBrowserMessage(null);
  };

  const onOpenHtmlReport = (): void => {
    // Opens a professionally-formatted HTML report in a new tab for the
    // user to print to PDF. Reads stored results only; no recomputation.
    const analystNotes =
      draftState.reportNotesDraft.analystNotes.status === 'value'
        ? draftState.reportNotesDraft.analystNotes.value
        : undefined;
    const ok = openHtmlReport(
      pipelineResult,
      actualPaymentsAmortization,
      buildRateLabel(),
      analystNotes ?? undefined,
    );
    if (!ok) {
      setPdfBrowserMessage(
        'Δεν ήταν δυνατό το άνοιγμα της αναφοράς. Επιτρέψτε τα αναδυόμενα παράθυρα και εκτελέστε πρώτα τη μελέτη.',
      );
    }
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
    field:
      | 'regimeKind'
      | 'law128Status'
      | 'capitalizeLateInterestSemiAnnually'
      | 'floatingIndexType'
      | 'rateSourceRule',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'rateConfigDraft', field, next));
  };
  const onRateConfigNumberChange = (
    field:
      | 'annualRatePercent'
      | 'spreadPercent'
      | 'law128Percent'
      | 'lateInterestSurchargePercent'
      | 'businessDaysBeforeReset',
    next: FieldState<number>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'rateConfigDraft', field, next));
  };

  // Fetch index observations from the ECB and lock them into the case.
  // On any failure the UI exposes a manual-entry fallback.
  const onFetchAndLockRates = async (): Promise<void> => {
    const rc = draftState.rateConfigDraft;
    const idx = rc.floatingIndexType.status === 'value' ? rc.floatingIndexType.value : null;
    const fetchable: readonly EcbIndexCode[] = ['EURIBOR_1M', 'EURIBOR_3M', 'EURIBOR_6M', 'EURIBOR_12M', 'ECB'];
    if (idx === null || !fetchable.includes(idx as EcbIndexCode)) {
      setEcbFetchStatus('idle');
      setEcbFetchMessage('Επιλέξτε πρώτα ένα είδος δείκτη με διαθέσιμη άντληση (Euribor ή ΕΚΤ).');
      return;
    }
    setEcbFetchStatus('loading');
    setEcbFetchMessage('Άντληση τιμών από την ΕΚΤ…');
    const result = await fetchEcbIndex(idx as EcbIndexCode);
    setEcbFetchStatus(result.status);
    setEcbFetchMessage(result.message);
    if (result.status === 'success') {
      const observations: readonly FloatingRateObservation[] = result.observations.map((o) => ({ date: o.date, valuePercent: o.valuePercent }));
      const lastDate = observations.length > 0 ? observations[observations.length - 1]!.date : null;
      const meta: FloatingRateLockMeta = {
        source: 'ecb_api',
        indexCode: idx,
        lockedAt: new Date().toISOString(),
        lastPublishedDate: lastDate,
      };
      setDraftState((prev) =>
        updateDraftField(
          updateDraftField(prev, 'rateConfigDraft', 'floatingRateObservations', observations),
          'rateConfigDraft',
          'floatingRateLock',
          meta,
        ),
      );
    }
  };

  // Lock manually entered observations (used when the ECB fetch fails).
  const onLockManualRates = (observations: readonly { date: string; valuePercent: number }[]): void => {
    const lastDate = observations.length > 0 ? observations[observations.length - 1]!.date : null;
    const idxCode =
      draftState.rateConfigDraft.floatingIndexType.status === 'value'
        ? (draftState.rateConfigDraft.floatingIndexType.value ?? 'manual')
        : 'manual';
    const meta: FloatingRateLockMeta = {
      source: 'manual',
      indexCode: idxCode,
      lockedAt: new Date().toISOString(),
      lastPublishedDate: lastDate,
    };
    const obs: readonly FloatingRateObservation[] = observations;
    setDraftState((prev) =>
      updateDraftField(
        updateDraftField(prev, 'rateConfigDraft', 'floatingRateObservations', obs),
        'rateConfigDraft',
        'floatingRateLock',
        meta,
      ),
    );
    setEcbFetchStatus('success');
    setEcbFetchMessage(`Κλειδώθηκαν ${observations.length} τιμές (χειροκίνητη καταχώρηση).`);
  };

  const onRecalcSelectChange = (
    field: 'scheduleMode' | 'roundingMode' | 'installmentResetFrequency',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateDraftField(prev, 'recalculationSettingsDraft', field, next));
  };
  const onRecalcMoneyChange = (
    field: 'feesAndPremiumsPerPeriodCents' | 'balloonAmountCents',
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
  const onPaymentBulkAdd = (spec: {
    count: number;
    amountCents: number;
    firstDateISO: string;
    stepMonths: number;
  }): void => {
    // Pass the generated schedule rows so each payment auto-matches the
    // installment that shares its due date.
    const scheduleRows = draftState.bankScheduleDraft.rows.map((r) => ({
      rowId: r.rowId.status === 'value' && r.rowId.value !== null ? r.rowId.value : '',
      dueDateISO: r.dueDate.status === 'value' ? r.dueDate.value : null,
    }));
    setDraftState((prev) => addManyActualPaymentDraftRows(prev, spec, scheduleRows));
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

  const onExtraChargeAdd = (): void => {
    setDraftState((prev) => addExtraChargeDraftRow(prev));
  };
  const onExtraChargeRemove = (index: number): void => {
    setDraftState((prev) => removeExtraChargeDraftRow(prev, index));
  };
  const onExtraChargeTextChange = (
    index: number,
    field: 'chargeDate' | 'description',
    next: FieldState<string>,
  ): void => {
    setDraftState((prev) => updateExtraChargeDraftRowField(prev, index, field, next));
  };
  const onExtraChargeMoneyChange = (
    index: number,
    field: 'amountCents',
    next: FieldState<number>,
  ): void => {
    setDraftState((prev) => updateExtraChargeDraftRowField(prev, index, field, next));
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
          onFetchAndLockRates={onFetchAndLockRates}
          onLockManualRates={onLockManualRates}
          ecbFetchStatus={ecbFetchStatus}
          ecbFetchMessage={ecbFetchMessage}
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
          bankScheduleDraft={draftState.bankScheduleDraft}
          pipelineResult={pipelineResult}
          onAddRow={onPaymentAddRow}
          onBulkAdd={onPaymentBulkAdd}
          onRemoveRow={onPaymentRemoveRow}
          onRowTextChange={onPaymentRowTextChange}
          onRowMoneyChange={onPaymentRowMoneyChange}
          extraCharges={draftState.extraChargesDraft}
          onExtraChargeAdd={onExtraChargeAdd}
          onExtraChargeRemove={onExtraChargeRemove}
          onExtraChargeTextChange={onExtraChargeTextChange}
          onExtraChargeMoneyChange={onExtraChargeMoneyChange}
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
          onOpenHtmlReport={onOpenHtmlReport}
          pdfBrowserMessage={pdfBrowserMessage}
          analystNotes={draftState.reportNotesDraft.analystNotes}
          onAnalystNotesChange={onAnalystNotesChange}
        />
      );
    }
    if (activeSection === 'saved_cases') {
      return (
        <SavedCasesSection
          currentDraft={draftState}
          currentCaseId={currentCaseId}
          onLoadCase={onLoadCase}
        />
      );
    }
    if (activeSection === 'comparison') {
      return (
        <ComparisonSection
          pipelineResult={pipelineResult}
          actualPaymentsAmortization={actualPaymentsAmortization}
        />
      );
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
