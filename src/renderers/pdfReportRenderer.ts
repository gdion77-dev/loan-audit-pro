/**
 * Loan Audit PRO — src/renderers/pdfReportRenderer.ts
 * ------------------------------------------------------------------
 * Step 8-B: PRODUCTION PDF Renderer (hardening of the 8-A spike).
 *
 * Converts the Step 7-B ReportTextRenderResult into a production
 * A4 PDF with branding header, numbered footer, typographic
 * hierarchy and an optional comparative summary table.
 *
 * LIBRARY / GREEK FONT DECISION (unchanged from 8-A, documented):
 *   No PDF npm package with Unicode font embedding is installable in
 *   this offline environment, so this file implements a MINIMAL
 *   PDF 1.4 writer and embeds SYSTEM fonts (configuration only — no
 *   font files are added to the repository):
 *     regular: /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
 *     bold:    /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
 *   Each is embedded as Type0 / Identity-H → CIDFontType2 with a
 *   /ToUnicode CMap, so extraction recovers real Greek text. If the
 *   BOLD font is missing, the renderer falls back to the regular
 *   font (PDF_BOLD_FONT_FALLBACK) without failing; if the REGULAR
 *   Greek-capable font is missing, rendering aborts with
 *   PDF_FONT_UNAVAILABLE — broken glyphs are never produced.
 *
 * LAYOUT:
 *   - header band on every page: «Loan Audit PRO» ·
 *     «The Bizboost by G. Dionysiou» + report title + rule, kept
 *     clear of the body (content starts below a fixed band);
 *   - footer band on every page: rule + neutral short disclaimer +
 *     «Σελίδα X από Y» (right-aligned); totals are exact because
 *     numbering is stamped AFTER the full layout pass;
 *   - measured line wrapping (hmtx advances) — no clipping; strictly
 *     monotonic y-cursor inside the content band — no overlap;
 *     headings are kept with at least the first body line;
 *   - optional comparative table (Μέγεθος / Τράπεζα / Fund /
 *     Επανυπολογισμός / Οικονομική Διαφορά / Σημείωση) rendered from
 *     ALREADY-FORMATTED values supplied by the caller — nothing is
 *     recomputed here. Without structured values the table is
 *     skipped with PDF_TABLE_SKIPPED info.
 *
 * The pre-render forbidden-wording gate from 8-A is preserved:
 * violations → requires_review, pdfBytes null, PDF_TEXT_NOT_NEUTRAL,
 * and PDF_RENDERED is never emitted.
 *
 * Scope guards: independent of Ν.3869/2010 and ΑΠ 6/2026; no UI, no
 * markup, no recalculation — amounts, signs and the
 * «Δεν οριστικοποιείται…» phrasing pass through untouched.
 */

// Filesystem access is isolated in a Node-only module. The browser
// build aliases this to a stub (see vite.config.ts) so node:fs never
// enters the client bundle. No rendering logic or output changes.
import { getFontFs } from './nodeFontFs';

import type { AuditEntry } from '../domain/auditTypes';
import { info, warning } from '../domain/auditFactories';
import { formatMoneyGreek, moneyFromCents, type CurrencyCode } from '../domain/money';
import { findForbiddenFindingTerms } from '../engines/findingsEngine';
import type { ScheduleComparisonSummary } from '../engines/scheduleComparisonEngine';
import type { ReportTextRenderResult } from './reportTextRenderer';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const PDF_AUDIT_CODES = {
  PDF_TEXT_NOT_NEUTRAL: 'PDF_TEXT_NOT_NEUTRAL',
  PDF_FONT_UNAVAILABLE: 'PDF_FONT_UNAVAILABLE',
  PDF_BOLD_FONT_FALLBACK: 'PDF_BOLD_FONT_FALLBACK',
  PDF_GLYPH_MISSING: 'PDF_GLYPH_MISSING',
  PDF_TABLE_SKIPPED: 'PDF_TABLE_SKIPPED',
  PDF_RENDERED: 'PDF_RENDERED',
} as const;

const DEFAULT_REGULAR_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const DEFAULT_BOLD_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const BANNED_FRAGMENTS: readonly string[] = ['νομικη γνωμοδοτηση', '3869', '6/2026'];

const HEADER_BRAND = 'Loan Audit PRO · The Bizboost by G. Dionysiou';
const HEADER_TITLE = 'Τεχνική Οικονομική Μελέτη Ελέγχου Δανείου';
const FOOTER_DISCLAIMER = 'Τεχνική οικονομική αποτύπωση βάσει διαθέσιμων δεδομένων.';

/* A4 portrait, points. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - 2 * MARGIN;
/* header band */
const HEADER_BRAND_Y = PAGE_H - 34;
const HEADER_TITLE_Y = PAGE_H - 46;
const HEADER_RULE_Y = PAGE_H - 54;
const CONTENT_TOP = PAGE_H - 74;
/* footer band */
const FOOTER_RULE_Y = 52;
const FOOTER_TEXT_Y = 40;
const CONTENT_BOTTOM = 66;

const TITLE_SIZE = 18;
const HEADING_SIZE = 12.5;
const BODY_SIZE = 10.5;
const TABLE_SIZE = 9.5;
const HEADER_SIZE = 9;
const FOOTER_SIZE = 7.5;
const LEADING = 1.45;

/* Brand palette (deep slate-blue accent + warm neutrals). */
const COLOR_BRAND: RGB = { r: 0.12, g: 0.20, b: 0.38 }; // deep indigo
const COLOR_ACCENT: RGB = { r: 0.18, g: 0.40, b: 0.62 }; // steel blue
const COLOR_INK: RGB = { r: 0.13, g: 0.13, b: 0.15 }; // near-black body
const COLOR_MUTED: RGB = { r: 0.42, g: 0.44, b: 0.48 }; // muted grey
const COLOR_BAND: RGB = { r: 0.93, g: 0.95, b: 0.98 }; // pale blue band

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type PdfRenderStatus = 'success' | 'requires_review';

export interface PdfFontConfig {
  /** System font configuration only — no fonts ship with the repo. */
  readonly regularPath?: string;
  readonly boldPath?: string;
}

export interface PdfRenderOptions {
  readonly includeFullText?: boolean;
  readonly includeSectionPageBreaks?: boolean;
  readonly pageSize?: 'A4';
  readonly language?: 'el';
  readonly fontConfig?: PdfFontConfig;
}

/** One row of the comparative table — values arrive PRE-FORMATTED. */
export interface PdfSummaryTableRow {
  readonly label: string;
  readonly bankText: string;
  readonly recalcText: string;
  readonly diffText: string;
  readonly noteText: string;
}

export interface PdfRenderInput {
  readonly reportText: ReportTextRenderResult;
  /** Optional structured comparative rows (no recalculation here). */
  readonly summaryTable?: readonly PdfSummaryTableRow[];
  readonly options?: PdfRenderOptions;
}

export interface PdfRenderResult {
  readonly status: PdfRenderStatus;
  readonly pdfBytes: Uint8Array | null;
  readonly pageCount: number | null;
  readonly auditEntries: readonly AuditEntry[];
}

/* ------------------------------------------------------------------ */
/* Table helper: format EXISTING comparison summary values             */
/* ------------------------------------------------------------------ */

/**
 * Formats the locked Step 6-A summary into table rows. Pure
 * formatting of existing numbers — null stays a dash with an
 * explicit note, NEVER 0,00 €.
 */
export function buildSummaryTableFromComparison(
  summary: ScheduleComparisonSummary,
  currency: CurrencyCode = 'EUR',
): PdfSummaryTableRow[] {
  const amt = (cents: number | null): string =>
    cents === null ? '—' : formatMoneyGreek(moneyFromCents(cents, currency));
  const diff = (cents: number | null): string => {
    if (cents === null) return '—';
    const text = formatMoneyGreek(moneyFromCents(cents, currency));
    return cents > 0 ? `+${text}` : text;
  };
  const note = (cents: number | null): string =>
    cents === null ? 'Ελλιπή δεδομένα· δεν οριστικοποιείται.' : `${summary.comparedRowCount} συγκρίσιμες περίοδοι.`;
  return [
    {
      label: 'Δόσεις',
      bankText: amt(summary.totalBankInstallmentsCents),
      recalcText: amt(summary.totalRecalculatedInstallmentsCents),
      diffText: diff(summary.totalEconomicDifferenceCents),
      noteText: note(summary.totalEconomicDifferenceCents),
    },
    {
      label: 'Τόκοι',
      bankText: amt(summary.totalBankInterestCents),
      recalcText: amt(summary.totalRecalculatedInterestCents),
      diffText: diff(summary.totalInterestDifferenceCents),
      noteText: note(summary.totalInterestDifferenceCents),
    },
    {
      label: 'Χρεολύσιο',
      bankText: amt(summary.totalBankPrincipalCents),
      recalcText: amt(summary.totalRecalculatedPrincipalCents),
      diffText: diff(summary.totalPrincipalDifferenceCents),
      noteText: note(summary.totalPrincipalDifferenceCents),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Minimal TrueType parsing (cmap / hmtx / head / hhea / maxp)         */
/* ------------------------------------------------------------------ */

interface ParsedFont {
  readonly data: Buffer;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly bbox: readonly [number, number, number, number];
  glyphId(codePoint: number): number;
  advance(glyphId: number): number;
}

function parseTtf(data: Buffer): ParsedFont {
  const numTables = data.readUInt16BE(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const base = 12 + i * 16;
    tables.set(data.toString('latin1', base, base + 4), {
      offset: data.readUInt32BE(base + 8),
      length: data.readUInt32BE(base + 12),
    });
  }
  const need = (tag: string): { offset: number } => {
    const t = tables.get(tag);
    if (!t) throw new Error(`font table missing: ${tag}`);
    return t;
  };

  const head = need('head').offset;
  const unitsPerEm = data.readUInt16BE(head + 18);
  const bbox: [number, number, number, number] = [
    data.readInt16BE(head + 36),
    data.readInt16BE(head + 38),
    data.readInt16BE(head + 40),
    data.readInt16BE(head + 42),
  ];

  const hhea = need('hhea').offset;
  const ascent = data.readInt16BE(hhea + 4);
  const descent = data.readInt16BE(hhea + 6);
  const numHMetrics = data.readUInt16BE(hhea + 34);

  const hmtx = need('hmtx').offset;
  const advance = (gid: number): number =>
    data.readUInt16BE(hmtx + Math.min(gid, numHMetrics - 1) * 4);

  const cmap = need('cmap').offset;
  const subtables = data.readUInt16BE(cmap + 2);
  let best: { offset: number; format: number } | null = null;
  for (let i = 0; i < subtables; i++) {
    const rec = cmap + 4 + i * 8;
    const platform = data.readUInt16BE(rec);
    const encoding = data.readUInt16BE(rec + 2);
    const offset = cmap + data.readUInt32BE(rec + 4);
    const format = data.readUInt16BE(offset);
    if (platform === 3 && encoding === 10 && format === 12) {
      best = { offset, format };
      break;
    }
    if (platform === 3 && encoding === 1 && format === 4 && best === null) {
      best = { offset, format };
    }
  }
  if (!best) throw new Error('no usable cmap subtable (3,1)/(3,10)');

  let glyphId: (cp: number) => number;
  if (best.format === 12) {
    const o = best.offset;
    const nGroups = data.readUInt32BE(o + 12);
    glyphId = (cp: number): number => {
      let lo = 0;
      let hi = nGroups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = o + 16 + mid * 12;
        const start = data.readUInt32BE(g);
        const end = data.readUInt32BE(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return data.readUInt32BE(g + 8) + (cp - start);
      }
      return 0;
    };
  } else {
    const o = best.offset;
    const segCount = data.readUInt16BE(o + 6) / 2;
    const endO = o + 14;
    const startO = endO + segCount * 2 + 2;
    const deltaO = startO + segCount * 2;
    const rangeO = deltaO + segCount * 2;
    glyphId = (cp: number): number => {
      if (cp > 0xffff) return 0;
      for (let seg = 0; seg < segCount; seg++) {
        const end = data.readUInt16BE(endO + seg * 2);
        if (cp <= end) {
          const start = data.readUInt16BE(startO + seg * 2);
          if (cp < start) return 0;
          const delta = data.readInt16BE(deltaO + seg * 2);
          const rangeOffset = data.readUInt16BE(rangeO + seg * 2);
          if (rangeOffset === 0) return (cp + delta) & 0xffff;
          const gid = data.readUInt16BE(rangeO + seg * 2 + rangeOffset + (cp - start) * 2);
          return gid === 0 ? 0 : (gid + delta) & 0xffff;
        }
      }
      return 0;
    };
  }

  return { data, unitsPerEm, ascent, descent, bbox, glyphId, advance };
}

const fontCache = new Map<string, ParsedFont>();
function loadFontAt(path: string): ParsedFont | null {
  const hit = fontCache.get(path);
  if (hit) return hit;
  const fs = getFontFs();
  if (fs === null) return null; // no filesystem (e.g. browser) → no embedded font
  if (!fs.existsSync(path)) return null;
  const parsed = parseTtf(fs.readFileSync(path));
  fontCache.set(path, parsed);
  return parsed;
}

/** Spike diagnostic kept from 8-A: full-glyph coverage check. */
export function verifyGreekGlyphCoverage(text: string): {
  covered: boolean;
  missing: readonly string[];
} {
  const font = loadFontAt(DEFAULT_REGULAR_FONT);
  if (!font) return { covered: false, missing: [...new Set(text)] };
  const missing = new Set<string>();
  for (const ch of text) {
    if (ch !== '\n' && font.glyphId(ch.codePointAt(0)!) === 0) missing.add(ch);
  }
  return { covered: missing.size === 0, missing: [...missing] };
}

/* ------------------------------------------------------------------ */
/* Layout primitives                                                   */
/* ------------------------------------------------------------------ */

type FontKey = 'F1' | 'F2';

interface FontEntry {
  readonly key: FontKey;
  readonly font: ParsedFont;
  readonly usedGids: Set<number>;
  readonly gidToUnicode: Map<number, number>;
}

interface RGB {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Line {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly fontKey: FontKey;
  readonly glyphHex: string;
  readonly color?: RGB;
}

interface Rule {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width: number;
  readonly color?: RGB;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly color: RGB;
}

interface PageModel {
  readonly lines: Line[];
  readonly rules: Rule[];
  readonly rects: Rect[];
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function renderLoanAuditPdf(input: PdfRenderInput): PdfRenderResult {
  const auditEntries: AuditEntry[] = [];
  const reportText = input.reportText;
  const sectionPageBreaks = input.options?.includeSectionPageBreaks ?? false;
  const regularPath = input.options?.fontConfig?.regularPath ?? DEFAULT_REGULAR_FONT;
  const boldPath = input.options?.fontConfig?.boldPath ?? DEFAULT_BOLD_FONT;

  /* --- neutral wording gate BEFORE any rendering ---------------------- */
  const normalize = (t: string): string =>
    t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const screen = (location: string, text: string): boolean => {
    const terms = [...findForbiddenFindingTerms(text)];
    const norm = normalize(text);
    for (const frag of BANNED_FRAGMENTS) if (norm.includes(frag)) terms.push(frag);
    if (terms.length === 0) return true;
    auditEntries.push(
      warning(
        PDF_AUDIT_CODES.PDF_TEXT_NOT_NEUTRAL,
        `Μη ουδέτερη διατύπωση στο κείμενο της μελέτης («${location}»)· η παραγωγή PDF διακόπηκε και απαιτείται έλεγχος.`,
        { location, terms },
      ),
    );
    return false;
  };

  let neutral = screen('fullText', reportText.fullText);
  for (const s of reportText.sections) {
    neutral = screen(`section:${s.sectionId}`, s.body) && neutral;
  }
  for (const [i, row] of (input.summaryTable ?? []).entries()) {
    neutral =
      screen(`table:${i}`, `${row.label} ${row.bankText} ${row.recalcText} ${row.diffText} ${row.noteText}`) &&
      neutral;
  }
  if (!neutral) {
    return { status: 'requires_review', pdfBytes: null, pageCount: null, auditEntries };
  }

  /* --- fonts: regular required, bold optional with fallback ----------- */
  const regular = loadFontAt(regularPath);
  if (regular === null) {
    auditEntries.push(
      warning(
        PDF_AUDIT_CODES.PDF_FONT_UNAVAILABLE,
        'Μη διαθέσιμη γραμματοσειρά με ελληνική κάλυψη· η παραγωγή PDF δεν είναι ασφαλής και διακόπηκε (δεν παράγονται αλλοιωμένα γλυφικά).',
        { fontPath: regularPath },
      ),
    );
    return { status: 'requires_review', pdfBytes: null, pageCount: null, auditEntries };
  }
  const bold = loadFontAt(boldPath);
  if (bold === null) {
    auditEntries.push(
      info(
        PDF_AUDIT_CODES.PDF_BOLD_FONT_FALLBACK,
        'Μη διαθέσιμη έντονη (bold) γραμματοσειρά με ελληνική κάλυψη· χρησιμοποιείται η κανονική χωρίς διακοπή της παραγωγής.',
        { fontPath: boldPath },
      ),
    );
  }

  const regularEntry: FontEntry = { key: 'F1', font: regular, usedGids: new Set(), gidToUnicode: new Map() };
  const boldEntry: FontEntry =
    bold === null
      ? regularEntry
      : { key: 'F2', font: bold, usedGids: new Set(), gidToUnicode: new Map() };
  const fontFor = (key: FontKey): FontEntry => (key === 'F2' ? boldEntry : regularEntry);

  /* --- encoding & measuring -------------------------------------------- */
  const missingChars = new Set<string>();
  const QUESTION = '?'.codePointAt(0)!;

  const encode = (key: FontKey, text: string): string => {
    const entry = fontFor(key);
    let hex = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let gid = entry.font.glyphId(cp);
      if (gid === 0 && ch !== ' ') {
        missingChars.add(ch);
        gid = entry.font.glyphId(QUESTION);
      }
      entry.usedGids.add(gid);
      if (!entry.gidToUnicode.has(gid)) entry.gidToUnicode.set(gid, cp);
      hex += gid.toString(16).padStart(4, '0');
    }
    return hex;
  };

  const measure = (key: FontKey, text: string, size: number): number => {
    const entry = fontFor(key);
    let width = 0;
    for (const ch of text) {
      const gid = entry.font.glyphId(ch.codePointAt(0)!) || entry.font.glyphId(QUESTION);
      width += entry.font.advance(gid);
    }
    return (width * size) / entry.font.unitsPerEm;
  };

  const wrap = (key: FontKey, paragraph: string, size: number, maxW: number): string[] => {
    const words = paragraph.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (measure(key, candidate, size) <= maxW || current === '') current = candidate;
      else {
        lines.push(current);
        current = word;
      }
      while (measure(key, current, size) > maxW && current.length > 1) {
        let cut = current.length - 1;
        while (cut > 1 && measure(key, current.slice(0, cut), size) > maxW) cut--;
        lines.push(current.slice(0, cut));
        current = current.slice(cut);
      }
    }
    if (current !== '') lines.push(current);
    return lines;
  };

  /* --- layout ------------------------------------------------------------ */
  const pages: PageModel[] = [{ lines: [], rules: [], rects: [] }];
  let y = CONTENT_TOP;
  const page = (): PageModel => pages[pages.length - 1]!;
  const newPage = (): void => {
    pages.push({ lines: [], rules: [], rects: [] });
    y = CONTENT_TOP;
  };

  const put = (key: FontKey, text: string, size: number, indent = 0, color?: RGB): void => {
    const lineHeight = size * LEADING;
    for (const ln of wrap(key, text, size, CONTENT_W - indent)) {
      if (y - lineHeight < CONTENT_BOTTOM) newPage();
      y -= lineHeight;
      page().lines.push({
        x: MARGIN + indent,
        y,
        size,
        fontKey: key,
        glyphHex: encode(key, ln),
        ...(color ? { color } : {}),
      });
    }
  };

  const gap = (pts: number): void => {
    if (y - pts < CONTENT_BOTTOM) newPage();
    else y -= pts;
  };

  /* --- comparative table --------------------------------------------------- */
  const TABLE_COLS: { readonly w: number; readonly align: 'l' | 'r' }[] = [
    { w: 120, align: 'l' },
    { w: 88, align: 'r' },
    { w: 88, align: 'r' },
    { w: 88, align: 'r' },
    { w: CONTENT_W - 384, align: 'l' },
  ];
  const TABLE_HEADERS = ['Μέγεθος', 'Τράπεζα / Fund', 'Επανυπολογισμός', 'Οικονομική Διαφορά', 'Σημείωση'];
  const tLineH = TABLE_SIZE * 1.32;

  const drawTableRow = (cells: readonly string[], key: FontKey): void => {
    const cellLines = cells.map((c, i) => wrap(key, c, TABLE_SIZE, TABLE_COLS[i]!.w - 6));
    const rows = Math.max(...cellLines.map((c) => c.length));
    const height = rows * tLineH + 5;
    if (y - height < CONTENT_BOTTOM) {
      newPage();
      if (key !== 'F2') drawTableRow(TABLE_HEADERS, 'F2'); // re-draw header after break
    }
    let x = MARGIN;
    cellLines.forEach((linesOfCell, i) => {
      const col = TABLE_COLS[i]!;
      linesOfCell.forEach((ln, li) => {
        const ly = y - (li + 1) * tLineH;
        const lx =
          col.align === 'r' ? x + col.w - 3 - measure(key, ln, TABLE_SIZE) : x + 3;
        page().lines.push({ x: lx, y: ly, size: TABLE_SIZE, fontKey: key, glyphHex: encode(key, ln) });
      });
      x += col.w;
    });
    y -= height;
    page().rules.push({ x1: MARGIN, y1: y + 2, x2: MARGIN + CONTENT_W, y2: y + 2, width: 0.4 });
  };

  const drawTable = (rows: readonly PdfSummaryTableRow[]): void => {
    gap(6);
    if (y - 3 * tLineH < CONTENT_BOTTOM) newPage();
    page().rules.push({ x1: MARGIN, y1: y, x2: MARGIN + CONTENT_W, y2: y, width: 0.7 });
    drawTableRow(TABLE_HEADERS, 'F2');
    for (const row of rows) {
      drawTableRow([row.label, row.bankText, row.recalcText, row.diffText, row.noteText], 'F1');
    }
    gap(4);
  };

  /* --- flow: title + sections (+ table after S07) --------------------------- */
  // Cover-style title block: a tall accent band behind the title, the
  // title in brand color, and a thin accent rule beneath it.
  gap(6);
  {
    const bandH = TITLE_SIZE * LEADING + 22;
    const bandTop = y;
    page().rects.push({
      x: MARGIN - 10,
      y: bandTop - bandH + 6,
      w: CONTENT_W + 20,
      h: bandH,
      color: COLOR_BAND,
    });
    // accent bar on the left edge of the band
    page().rects.push({
      x: MARGIN - 10,
      y: bandTop - bandH + 6,
      w: 4,
      h: bandH,
      color: COLOR_ACCENT,
    });
    gap(14);
    put('F2', reportText.title, TITLE_SIZE, 6, COLOR_BRAND);
    gap(8);
    page().rules.push({
      x1: MARGIN,
      y1: y + 4,
      x2: MARGIN + CONTENT_W,
      y2: y + 4,
      width: 1.2,
      color: COLOR_ACCENT,
    });
  }
  gap(14);

  let sectionIndex = 0;
  for (const section of reportText.sections) {
    sectionIndex += 1;
    if (sectionPageBreaks && page().lines.length > 0) newPage();
    gap(11);
    if (y - HEADING_SIZE * LEADING - BODY_SIZE * LEADING < CONTENT_BOTTOM) newPage();
    // section heading: small accent bar + brand-colored heading text
    const headTop = y;
    page().rects.push({
      x: MARGIN,
      y: headTop - HEADING_SIZE * LEADING + 2,
      w: 3,
      h: HEADING_SIZE * LEADING,
      color: COLOR_ACCENT,
    });
    put('F2', section.title, HEADING_SIZE, 10, COLOR_BRAND);
    gap(4);
    for (const paragraph of section.body.split('\n')) {
      if (paragraph.trim() === '') gap(BODY_SIZE * 0.6);
      else put('F1', paragraph, BODY_SIZE, 0, COLOR_INK);
    }
    if (section.sectionId === 'S07') {
      if (input.summaryTable !== undefined && input.summaryTable.length > 0) {
        drawTable(input.summaryTable);
      } else {
        auditEntries.push(
          info(
            PDF_AUDIT_CODES.PDF_TABLE_SKIPPED,
            'Ο συγκριτικός πίνακας παραλείφθηκε: δεν δόθηκαν δομημένες τιμές σύνοψης· τα συγκριτικά αποτελέσματα παρατίθενται ως κείμενο.',
          ),
        );
      }
    }
  }

  /* --- header & footer per page (totals now known) --------------------------- */
  const total = pages.length;
  pages.forEach((p, i) => {
    p.lines.push({
      x: MARGIN,
      y: HEADER_BRAND_Y,
      size: HEADER_SIZE,
      fontKey: 'F2',
      glyphHex: encode('F2', HEADER_BRAND),
      color: COLOR_BRAND,
    });
    p.lines.push({
      x: MARGIN,
      y: HEADER_TITLE_Y,
      size: 8,
      fontKey: 'F1',
      glyphHex: encode('F1', HEADER_TITLE),
      color: COLOR_MUTED,
    });
    p.rules.push({ x1: MARGIN, y1: HEADER_RULE_Y, x2: PAGE_W - MARGIN, y2: HEADER_RULE_Y, width: 0.7, color: COLOR_ACCENT });

    p.rules.push({ x1: MARGIN, y1: FOOTER_RULE_Y, x2: PAGE_W - MARGIN, y2: FOOTER_RULE_Y, width: 0.5, color: COLOR_ACCENT });
    p.lines.push({
      x: MARGIN,
      y: FOOTER_TEXT_Y,
      size: FOOTER_SIZE,
      fontKey: 'F1',
      glyphHex: encode('F1', FOOTER_DISCLAIMER),
      color: COLOR_MUTED,
    });
    const pageLabel = `Σελίδα ${i + 1} από ${total}`;
    p.lines.push({
      x: PAGE_W - MARGIN - measure('F1', pageLabel, FOOTER_SIZE),
      y: FOOTER_TEXT_Y,
      size: FOOTER_SIZE,
      fontKey: 'F1',
      glyphHex: encode('F1', pageLabel),
      color: COLOR_MUTED,
    });
  });

  /* --- bytes -------------------------------------------------------------------- */
  const fontEntries: FontEntry[] = boldEntry === regularEntry ? [regularEntry] : [regularEntry, boldEntry];
  const pdfBytes = buildPdf(fontEntries, boldEntry === regularEntry, pages);

  if (missingChars.size > 0) {
    auditEntries.push(
      warning(
        PDF_AUDIT_CODES.PDF_GLYPH_MISSING,
        'Χαρακτήρες χωρίς διαθέσιμο γλυφικό στη γραμματοσειρά αντικαταστάθηκαν με «?»· απαιτείται έλεγχος εμφάνισης.',
        { characters: [...missingChars] },
      ),
    );
  }

  auditEntries.push(
    info(
      PDF_AUDIT_CODES.PDF_RENDERED,
      `Παρήχθη PDF ${total} σελίδων (A4) με κεφαλίδα, υποσέλιδο αρίθμησης και ενσωματωμένες γραμματοσειρές DejaVu Sans${bold ? ' / DejaVu Sans Bold' : ''} (πλήρης ελληνική κάλυψη) βάσει διαθέσιμων δεδομένων.`,
      { pageCount: total, fonts: fontEntries.length },
    ),
  );

  const needsReview = reportText.status === 'requires_review' || missingChars.size > 0;
  return {
    status: needsReview ? 'requires_review' : 'success',
    pdfBytes,
    pageCount: total,
    auditEntries,
  };
}

/* ------------------------------------------------------------------ */
/* Minimal PDF assembly                                                */
/* ------------------------------------------------------------------ */

function buildPdf(fonts: FontEntry[], boldAliased: boolean, pages: PageModel[]): Uint8Array {
  const objects: Buffer[] = [];
  const obj = (num: number, body: string | Buffer): void => {
    objects[num - 1] = Buffer.concat([
      Buffer.from(`${num} 0 obj\n`, 'latin1'),
      typeof body === 'string' ? Buffer.from(body, 'latin1') : body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
  };
  const stream = (dict: string, content: Buffer): Buffer =>
    Buffer.concat([
      Buffer.from(`<< ${dict} /Length ${content.length} >>\nstream\n`, 'latin1'),
      content,
      Buffer.from('\nendstream', 'latin1'),
    ]);

  /* font objects: per font 5 objects starting at 3 */
  const fontBase = (i: number): number => 3 + i * 5;
  fonts.forEach((entry, i) => {
    const base = fontBase(i);
    const name = entry.key === 'F2' ? 'DejaVuSans-Bold' : 'DejaVuSans';
    const font = entry.font;
    const scale = 1000 / font.unitsPerEm;

    obj(
      base,
      `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [ ${base + 1} 0 R ] /ToUnicode ${base + 4} 0 R >>`,
    );
    const wEntries = [...entry.usedGids]
      .sort((a, b) => a - b)
      .map((gid) => `${gid} [ ${Math.round(font.advance(gid) * scale)} ]`)
      .join(' ');
    obj(
      base + 1,
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} ` +
        `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
        `/FontDescriptor ${base + 2} 0 R /CIDToGIDMap /Identity /DW 600 /W [ ${wEntries} ] >>`,
    );
    const [xMin, yMin, xMax, yMax] = font.bbox;
    obj(
      base + 2,
      `<< /Type /FontDescriptor /FontName /${name} /Flags 4 ` +
        `/FontBBox [ ${Math.round(xMin * scale)} ${Math.round(yMin * scale)} ${Math.round(xMax * scale)} ${Math.round(yMax * scale)} ] ` +
        `/ItalicAngle 0 /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} ` +
        `/CapHeight ${Math.round(font.ascent * scale)} /StemV ${entry.key === 'F2' ? 120 : 80} /FontFile2 ${base + 3} 0 R >>`,
    );
    obj(base + 3, stream(`/Length1 ${font.data.length}`, font.data));

    const bfchars = [...entry.gidToUnicode.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([gid, cp]) => `<${gid.toString(16).padStart(4, '0')}> <${cp.toString(16).padStart(4, '0')}>`);
    const chunks: string[] = [];
    for (let c = 0; c < bfchars.length; c += 100) {
      const part = bfchars.slice(c, c + 100);
      chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`);
    }
    const cmapText =
      '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      `${chunks.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    obj(base + 4, stream('', Buffer.from(cmapText, 'latin1')));
  });

  const f1Obj = fontBase(0);
  const f2Obj = boldAliased ? f1Obj : fontBase(1);
  const fontResources = `/Font << /F1 ${f1Obj} 0 R /F2 ${f2Obj} 0 R >>`;

  const firstPageObj = 3 + fonts.length * 5;
  const pageObjNums = pages.map((_, i) => firstPageObj + i * 2);

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(
    2,
    `<< /Type /Pages /Count ${pages.length} /Kids [ ${pageObjNums.map((n) => `${n} 0 R`).join(' ')} ] >>`,
  );

  pages.forEach((p, i) => {
    const pageNum = pageObjNums[i]!;
    obj(
      pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${PAGE_W} ${PAGE_H} ] ` +
        `/Resources << ${fontResources} >> /Contents ${pageNum + 1} 0 R >>`,
    );
    const rectOps = p.rects
      .map(
        (rc) =>
          `q ${rc.color.r.toFixed(3)} ${rc.color.g.toFixed(3)} ${rc.color.b.toFixed(3)} rg ` +
          `${rc.x.toFixed(2)} ${rc.y.toFixed(2)} ${rc.w.toFixed(2)} ${rc.h.toFixed(2)} re f Q`,
      )
      .join('\n');
    const textOps = p.lines
      .map((l) => {
        const c = l.color;
        const fill = c ? `${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} rg ` : '';
        return `q BT ${fill}/${l.fontKey} ${l.size} Tf 1 0 0 1 ${l.x.toFixed(2)} ${l.y.toFixed(2)} Tm <${l.glyphHex}> Tj ET Q`;
      })
      .join('\n');
    const ruleOps = p.rules
      .map((r) => {
        const c = r.color ?? { r: 0.55, g: 0.55, b: 0.55 };
        return (
          `q ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)} RG ${r.width.toFixed(2)} w ` +
          `${r.x1.toFixed(2)} ${r.y1.toFixed(2)} m ${r.x2.toFixed(2)} ${r.y2.toFixed(2)} l S Q`
        );
      })
      .join('\n');
    obj(pageNum + 1, stream('', Buffer.from(`${rectOps}\n${ruleOps}\n${textOps}`, 'latin1')));
  });

  const header = Buffer.from('%PDF-1.4\n%\xb5\xb5\xb5\xb5\n', 'latin1');
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let cursor = header.length;
  for (const o of objects) {
    offsets.push(cursor);
    parts.push(o);
    cursor += o.length;
  }
  const xrefStart = cursor;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));

  return new Uint8Array(Buffer.concat(parts));
}
