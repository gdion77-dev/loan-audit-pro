/**
 * Loan Audit PRO — src/components/sections/SavedCasesSection.tsx
 * ------------------------------------------------------------------
 * «Αποθηκευμένες Υποθέσεις». Save the current case to the local list,
 * reopen or delete saved cases, and export/import a portable .json
 * file for moving a case between computers (e.g. via a synced cloud
 * folder). No backend; storage is local + file.
 */
import React from 'react';
import { useState } from 'react';
import { SECTIONS } from './sectionDefinitions';
import type { LoanAuditDraftState } from '../../ui-state/loanAuditDraftState';
import {
  listSavedCases,
  saveCase,
  deleteSavedCase,
  getSavedCase,
  serialiseCaseFile,
  parseCaseFile,
  type SavedCase,
} from '../../ui-state/caseStorage';

const def = SECTIONS.find((s) => s.id === 'saved_cases')!;

export interface SavedCasesSectionProps {
  readonly currentDraft: LoanAuditDraftState;
  readonly currentCaseId: string | null;
  readonly onLoadCase: (draft: LoanAuditDraftState, caseId: string | null) => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('el-GR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export const SavedCasesSection: React.FC<SavedCasesSectionProps> = ({
  currentDraft,
  currentCaseId,
  onLoadCase,
}) => {
  const [cases, setCases] = useState<SavedCase[]>(() => listSavedCases());
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const refresh = (): void => setCases(listSavedCases());

  const onSave = (): void => {
    const saved = saveCase(name, currentDraft, currentCaseId ?? undefined);
    if (saved === null) {
      setMessage('Δεν ήταν δυνατή η αποθήκευση σε αυτόν τον browser.');
      return;
    }
    setName('');
    setMessage(`Αποθηκεύτηκε: «${saved.name}».`);
    refresh();
    onLoadCase(saved.draft, saved.id);
  };

  const onOpen = (id: string): void => {
    const c = getSavedCase(id);
    if (c === null) {
      setMessage('Η υπόθεση δεν βρέθηκε.');
      return;
    }
    onLoadCase(c.draft, c.id);
    setMessage(`Άνοιξε: «${c.name}».`);
  };

  const onDelete = (id: string, caseName: string): void => {
    if (typeof window !== 'undefined' && !window.confirm(`Διαγραφή της υπόθεσης «${caseName}»;`)) {
      return;
    }
    deleteSavedCase(id);
    setMessage(`Διαγράφηκε: «${caseName}».`);
    refresh();
  };

  const onExport = (caseName: string, draft: LoanAuditDraftState): void => {
    const text = serialiseCaseFile(caseName, draft);
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = caseName.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'case';
    a.href = url;
    a.download = `loan-audit-${safe}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMessage(`Έγινε εξαγωγή αρχείου για «${caseName}». Αποθηκεύστε το σε φάκελο cloud για μεταφορά.`);
  };

  const onImportFile = (e: { target: { files: FileList | null; value: string } }): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (): void => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseCaseFile(text);
      if (!parsed.ok || parsed.draft === undefined) {
        setMessage(parsed.error ?? 'Το αρχείο δεν μπόρεσε να εισαχθεί.');
        return;
      }
      const saved = saveCase(parsed.name ?? 'Εισαγόμενη υπόθεση', parsed.draft);
      refresh();
      if (saved !== null) {
        onLoadCase(saved.draft, saved.id);
        setMessage(`Εισήχθη και άνοιξε: «${saved.name}».`);
      } else {
        onLoadCase(parsed.draft, null);
        setMessage(`Εισήχθη: «${parsed.name}» (χωρίς τοπική αποθήκευση).`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <section className="lap-card" aria-label={def.title}>
      <h2 className="lap-card__title">{def.title}</h2>
      <p className="lap-card__explanation">{def.explanation}</p>

      {/* Save current case */}
      <div style={{ marginTop: '14px', padding: '12px', border: '1px solid var(--hair, #e2e2e2)', borderRadius: '8px' }}>
        <h3 className="lap-card__subtitle" style={{ marginTop: 0 }}>Αποθήκευση τρέχουσας υπόθεσης</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', fontSize: '12px', gap: '3px', flex: '1 1 240px' }}>
            Όνομα υπόθεσης
            <input
              type="text"
              value={name}
              onChange={(ev: { target: { value: string } }) => setName(ev.target.value)}
              placeholder={currentCaseId ? 'Ενημέρωση τρέχουσας ή νέο όνομα…' : 'π.χ. ΑΣΛΑΝΗΣ / CEPAL 2024'}
              style={{ padding: '8px' }}
            />
          </label>
          <button type="button" className="lap-btn" onClick={onSave}>
            {currentCaseId ? 'Αποθήκευση / Ενημέρωση' : 'Αποθήκευση'}
          </button>
          <button type="button" className="lap-btn lap-btn--secondary" onClick={() => onExport(name || 'υπόθεση', currentDraft)}>
            Εξαγωγή τρέχουσας σε αρχείο
          </button>
        </div>
      </div>

      {/* Import file */}
      <div style={{ marginTop: '12px', padding: '12px', border: '1px solid var(--hair, #e2e2e2)', borderRadius: '8px' }}>
        <h3 className="lap-card__subtitle" style={{ marginTop: 0 }}>Εισαγωγή υπόθεσης από αρχείο</h3>
        <p className="lap-field-help" style={{ marginTop: 0 }}>
          Επιλέξτε ένα αρχείο .json που εξαγάγατε σε άλλον υπολογιστή (π.χ. από φάκελο cloud).
        </p>
        <input type="file" accept="application/json,.json" onChange={onImportFile} />
      </div>

      {message !== null ? (
        <p className="lap-status" role="status" style={{ marginTop: '12px' }}>{message}</p>
      ) : null}

      {/* Saved list */}
      <div style={{ marginTop: '16px' }}>
        <h3 className="lap-card__subtitle">Αποθηκευμένες υποθέσεις σε αυτόν τον υπολογιστή</h3>
        {cases.length === 0 ? (
          <p className="lap-field-help">Δεν υπάρχουν αποθηκευμένες υποθέσεις ακόμη.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {cases.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
                  justifyContent: 'space-between', padding: '10px 12px',
                  border: '1px solid var(--hair, #e2e2e2)', borderRadius: '8px',
                  background: c.id === currentCaseId ? '#F3F8FB' : '#fff',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--ink, #1a1a1a)' }}>
                    {c.name}{c.id === currentCaseId ? ' — (τρέχουσα)' : ''}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted, #888)' }}>
                    Ενημερώθηκε: {formatDate(c.updatedAtISO)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button type="button" className="lap-btn" onClick={() => onOpen(c.id)}>Άνοιγμα</button>
                  <button type="button" className="lap-btn lap-btn--secondary" onClick={() => onExport(c.name, c.draft)}>Εξαγωγή</button>
                  <button type="button" className="lap-btn lap-btn--secondary" onClick={() => onDelete(c.id, c.name)}>Διαγραφή</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
