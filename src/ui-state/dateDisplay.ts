/**
 * Loan Audit PRO — src/ui-state/dateDisplay.ts
 * ------------------------------------------------------------------
 * Presentation helpers for dates. The whole engine/PDF/audit stack
 * works strictly in ISO `yyyy-mm-dd`. The UI, however, shows and accepts
 * Greek-style `dd/mm/yyyy`. These helpers translate between the two and
 * derive a month count from two ISO dates. No financial logic here.
 */

/** ISO `yyyy-mm-dd` → display `dd/mm/yyyy`. Returns '' for empty/invalid. */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Display `dd/mm/yyyy` (also tolerates `d/m/yyyy` and `-` separators) →
 * ISO `yyyy-mm-dd`. Returns the original string unchanged if it cannot be
 * parsed, so partially-typed input is preserved while editing.
 */
export function displayToIso(text: string): string {
  const t = text.trim();
  if (t === '') return '';
  // already ISO? keep it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t);
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return text;
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  // basic range sanity; if out of range, leave as typed
  const dn = Number(dd);
  const mn = Number(mm);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31) return text;
  return `${yyyy}-${mm}-${dd}`;
}

/** True when the string is a complete ISO date. */
export function isCompleteIso(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso.trim());
}

/**
 * Whole-month count between two ISO dates (end − start). Counts calendar
 * months; if the end day-of-month is earlier than the start day, the last
 * partial month is not counted. Returns null when either date is missing
 * or invalid, or when end is before start.
 */
export function monthsBetweenIso(startIso: string, endIso: string): number | null {
  if (!isCompleteIso(startIso) || !isCompleteIso(endIso)) return null;
  const sy = Number(startIso.slice(0, 4));
  const sm = Number(startIso.slice(5, 7));
  const sd = Number(startIso.slice(8, 10));
  const ey = Number(endIso.slice(0, 4));
  const em = Number(endIso.slice(5, 7));
  const ed = Number(endIso.slice(8, 10));
  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months -= 1;
  if (months < 0) return null;
  return months;
}
