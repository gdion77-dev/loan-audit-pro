# Loan Audit PRO — Τεχνικός Έλεγχος Κανονικών Δανείων

**Step 1-A: Domain Model & Types only.**

Ανεξάρτητο project. ΔΕΝ αφορά τον Ν.3869/2010. ΔΕΝ αφορά την ΑΠ 6/2026 και δεν αντιγράφει καμία λογική της. Σε μεταγενέστερα βήματα, ο τόκος υπολογίζεται πάντοτε επί του ανεξόφλητου υπολοίπου κεφαλαίου με ρητή σύμβαση ημερομέτρησης — ποτέ μόνο επί μηνιαίας δόσης κεφαλαίου.

## Περιεχόμενο αυτού του βήματος

Μόνο domain types + βοηθητικές συναρτήσεις μετατροπής/επικύρωσης + unit tests.
**Δεν** περιλαμβάνει: UI, PDF, Excel import, υπολογισμούς τοκοχρεολυσίων, μηχανή σύγκρισης, συμφωνία καταβολών, OCR, backend, authentication, cloud persistence.

```
src/domain/
  money.ts            integer cents, null≠0, parsing (EL/EN formats)
  dateTypes.ts        ISODate, validation, DayCountConvention (με 'unknown')
  loanTypes.ts        CaseInfo, 5 τύποι δανείου, LoanStructure
  rateTypes.ts        RateRegime (fixed/floating), Euribor indices,
                      NegativeEuriborPolicy, Law128Status, RatePeriod
  scheduleTypes.ts    BankScheduleRow (nullable πεδία), RecalcRow, RateBreakdown
  paymentTypes.ts     ActualPayment, MatchConfidence
  comparisonTypes.ts  ComparisonRow, FindingLevel, σύμβαση προσήμου διαφοράς
  reportTypes.ts      ReportModel, Finding, neutral-wording guard
  auditTypes.ts       AuditEntry, severities, AUDIT_CODES, factory
tests/
  money.test.ts, rates.test.ts, report.test.ts   (40 tests)
```

## Βασικοί κανόνες (επιβάλλονται από τα types/tests)

1. **Χρήμα = ακέραια λεπτά.** €647,08 → `{ cents: 64708 }`. Ποτέ float για αποθηκευμένα ποσά.
2. **null ≠ 0.** Ελλείπον δεδομένο = `null`. Το `0` μόνο όταν η πηγή το δηλώνει ρητά.
3. **'unknown' ως κατάσταση πρώτης τάξης** σε Ν.128/75, πολιτική αρνητικού Euribor, ημερομέτρηση — οι μηχανές των επόμενων βημάτων οφείλουν να εκδίδουν AuditEntry, όχι σιωπηρό default.
4. **Ουδέτερη οικονομική γλώσσα στο report.** Η `createReportModel` απορρίπτει κείμενα με απαγορευμένους όρους (παράνομο, άκυρο, διεκδίκηση, προς επιστροφή, αχρεωστήτως, νομική γνωμοδότηση) — έλεγχος case- και accent-insensitive.

## Σύμβαση προσήμου οικονομικής διαφοράς (για τη μελλοντική μηχανή σύγκρισης)

Η σύγκριση ΔΕΝ έχει υλοποιηθεί ακόμη. Η σύμβαση προσήμου είναι ήδη τεκμηριωμένη στο `comparisonTypes.ts` και δεσμεύει όλα τα επόμενα βήματα:

```
economicDifference = bankOrFundAmount − recalculatedAmount
```

- Θετική τιμή → το μέγεθος τράπεζας/fund είναι υψηλότερο από τον επανυπολογισμό.
- Αρνητική τιμή → ο επανυπολογισμός είναι υψηλότερος από το μέγεθος τράπεζας/fund.
- Μηδέν → συμφωνία. Η διαφορά είναι ουδέτερη «οικονομική διαφορά», χωρίς νομικό χαρακτηρισμό.

## Εντολές

```bash
npm install        # τοπικά: εγκαθιστά typescript, tsx, @types/node
npm run lint       # tsc --noEmit (strict type-check)
npm test           # tsx --test tests/*.test.ts (node:test runner)
npm run build      # tsc -p tsconfig.build.json → dist/ (js + d.ts)
```

## Σημειώσεις περιβάλλοντος

- Το βήμα αυτό αναπτύχθηκε σε περιβάλλον χωρίς πρόσβαση στο npm registry, γι' αυτό τα tests χρησιμοποιούν τον ενσωματωμένο runner του Node (`node:test`) αντί για vitest. Μετάβαση σε vitest = αλλαγή των δύο import γραμμών σε κάθε test αρχείο (`import { describe, it, expect } from 'vitest'`) και αντικατάσταση των `assert.*` με `expect`. Η δομή describe/it είναι ήδη συμβατή.
- Δεν υπάρχει eslint config ακόμη· το `npm run lint` εκτελεί strict type-check. Μπορεί να προστεθεί eslint σε επόμενο βήμα.
