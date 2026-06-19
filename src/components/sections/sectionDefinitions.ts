/**
 * Loan Audit PRO — src/components/sections/sectionDefinitions.ts
 * ------------------------------------------------------------------
 * The nine navigation sections of the application shell. Pure data
 * and string identifiers — no calculation, no engine imports. The
 * shell is presentational only and will be wired to
 * runLoanAuditPipeline in a later step.
 */

export type SectionId =
  | 'case_info'
  | 'loan_terms'
  | 'rate_config'
  | 'bank_schedule'
  | 'actual_payments'
  | 'recalc_settings'
  | 'comparison'
  | 'findings'
  | 'report'
  | 'saved_cases';

export interface SectionDefinition {
  readonly id: SectionId;
  readonly title: string;
  readonly explanation: string;
}

/** The connect-later note shown on every placeholder section. */
export const CONNECT_LATER_NOTE =
  'Θα συνδεθεί με τον υπολογιστικό πυρήνα σε επόμενο βήμα.';

export const SECTIONS: readonly SectionDefinition[] = [
  {
    id: 'case_info',
    title: 'Στοιχεία Υπόθεσης',
    explanation: 'Βασικά στοιχεία της υπόθεσης: οφειλέτης, σύμβαση, τράπεζα / fund.',
  },
  {
    id: 'loan_terms',
    title: 'Όροι Δανείου / Ρύθμισης',
    explanation: 'Κεφάλαιο, διάρκεια και όροι του δανείου ή της ρύθμισης.',
  },
  {
    id: 'rate_config',
    title: 'Επιτόκιο',
    explanation: 'Καθεστώς επιτοκίου, δείκτης, περιθώριο και ιστορικό.',
  },
  {
    id: 'bank_schedule',
    title: 'Δοσολόγιο Τράπεζας / Fund',
    explanation: 'Οι γραμμές του δοσολογίου όπως προκύπτουν από αρχεία τράπεζας / fund.',
  },
  {
    id: 'actual_payments',
    title: 'Πραγματικές Καταβολές',
    explanation: 'Καταγραφή των πραγματικών καταβολών προς συμφωνία.',
  },
  {
    id: 'recalc_settings',
    title: 'Ρυθμίσεις Επανυπολογισμού',
    explanation: 'Παράμετροι του τεχνικού οικονομικού επανυπολογισμού.',
  },
  {
    id: 'comparison',
    title: 'Σύγκριση',
    explanation: 'Σύγκριση δοσολογίου τράπεζας / fund με τον επανυπολογισμό.',
  },
  {
    id: 'findings',
    title: 'Ευρήματα',
    explanation: 'Τεχνικά οικονομικά ευρήματα και οικονομική απόκλιση όπου απαιτείται έλεγχος.',
  },
  {
    id: 'report',
    title: 'Μελέτη / PDF',
    explanation: 'Προεπισκόπηση της οικονομικής μελέτης και παραγωγή PDF.',
  },
  {
    id: 'saved_cases',
    title: 'Αποθηκευμένες Υποθέσεις',
    explanation:
      'Αποθήκευση, άνοιγμα και διαχείριση υποθέσεων. Εξαγωγή σε αρχείο για μεταφορά μεταξύ υπολογιστών (π.χ. μέσω συγχρονισμένου φακέλου cloud).',
  },
] as const;
