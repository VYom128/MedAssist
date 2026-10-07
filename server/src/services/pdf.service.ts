import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { getSettings } from '../modules/settings/service.js';
import { formatClinicDateTime } from '../utils/dates.js';
import { formatIndianAmount } from '../utils/money.js';

/**
 * Server-side PDFs (spec §12.3). By default PDFKit's standard fonts (Helvetica: Latin-1 – no ₹ or
 * Indic glyphs); documents that print money (invoices, receipts) ask for `unicode: true`, which
 * embeds Noto Sans (`src/assets/fonts`, SIL OFL) so ₹ prints – falling back to Helvetica and
 * "Rs." if the font files are missing. Build a document with `createPdf()`, draw with the
 * helpers (they use the document's fonts and text filter), then `finish()` adds the page footers
 * ("Generated on <clinic time>", "Page n of m"), an optional watermark, and resolves the bytes.
 */

export type Pdf = PDFKit.PDFDocument;

export const PDF_LAYOUT = Object.freeze({
  margin: 48,
  footerHeight: 28,
  fonts: Object.freeze({
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
  }),
  colors: Object.freeze({ ink: '#0f172a', muted: '#475569', line: '#cbd5e1', shade: '#f1f5f9' }),
});

const { margin, colors } = PDF_LAYOUT;

export interface PdfFonts {
  regular: string;
  bold: string;
  italic: string;
}

// ---- Embedded Unicode font (₹) ---------------------------------------------------------------

const DEFAULT_FONT_DIR = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
let fontDir = DEFAULT_FONT_DIR;
let fontsFound: boolean | null = null;

const fontFile = (name: string) => `${fontDir.replace(/\/?$/, '/')}${name}`;
const UNICODE_FILES = { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' } as const;
const UNICODE_FONTS: PdfFonts = { regular: 'NotoSans', bold: 'NotoSans-Bold', italic: 'NotoSans' };

/** Whether the embedded font files are there (checked once; the build copies them to dist). */
export function unicodeFontsAvailable(): boolean {
  fontsFound ??= Object.values(UNICODE_FILES).every((f) => existsSync(fontFile(f)));
  return fontsFound;
}

/** Tests only: look for the fonts elsewhere (a missing folder exercises the fallback). */
export function setFontDirectoryForTests(dir: string | null): void {
  fontDir = dir ?? DEFAULT_FONT_DIR;
  fontsFound = null;
}

/** Characters the standard fonts cannot draw become close equivalents (never garbage glyphs). */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/₹/g, 'Rs.')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/\t|\r\n?/g, (c) => (c === '\t' ? ' ' : '\n'))
    .replace(/[^\n\x20-\x7e\xa0-\xff–—•]/g, '?');
}

/**
 * Text for the embedded Noto Sans: keeps Latin (incl. extended), common punctuation and ₹;
 * anything the font lacks becomes a close equivalent or '?' (never a missing-glyph box).
 */
export function pdfSafeUnicode(text: string): string {
  return text
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/\t|\r\n?/g, (c) => (c === '\t' ? ' ' : '\n'))
    .replace(/[^\n\x20-\x7e\xa0-\u024f\u2010-\u2027\u2030-\u203a\u20b9\u2122\u2212]/g, '?');
}

/**
 * Money for PDFs, Indian grouping: '₹1,25,050.50' with the embedded font, else 'Rs. 1,25,050.50'
 * (the standard fonts have no ₹). Negative amounts get a leading '-'.
 */
export function formatMoneyForPdf(paise: number, unicode = unicodeFontsAvailable()): string {
  const amount = formatIndianAmount(Math.abs(paise));
  return `${paise < 0 ? '-' : ''}${unicode ? '₹' : 'Rs. '}${amount}`;
}

export interface PdfHandle {
  doc: Pdf;
  /** Width available between the margins. */
  width: number;
  /** The document's fonts (standard, or the embedded Noto Sans). */
  fonts: PdfFonts;
  /** Whether ₹ and other Unicode text can be drawn (embedded font). */
  unicode: boolean;
  /** Makes text drawable with the document's fonts (pdfSafe / pdfSafeUnicode). */
  safe(text: string): string;
  /** Money in the document's style (formatMoneyForPdf). */
  money(paise: number): string;
  /** Adds footers (and the watermark) to every page and returns the finished PDF. */
  finish(): Promise<Buffer>;
}

/**
 * A new A4 document with buffered pages (footers are drawn at the end).
 * @param unicode Embed Noto Sans so ₹ prints (falls back to the standard fonts if missing).
 * @param watermark Large diagonal text on every page (e.g. 'VOID').
 */
export function createPdf({
  title,
  subject,
  unicode = false,
  watermark,
}: {
  title: string;
  subject?: string;
  unicode?: boolean;
  watermark?: string;
}): PdfHandle {
  const embedded = unicode && unicodeFontsAvailable();
  const fonts: PdfFonts = embedded ? UNICODE_FONTS : PDF_LAYOUT.fonts;
  const safe = embedded ? pdfSafeUnicode : pdfSafe;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: margin, bottom: margin + PDF_LAYOUT.footerHeight, left: margin, right: margin },
    bufferPages: true,
    info: {
      Title: pdfSafe(title),
      ...(subject ? { Subject: pdfSafe(subject) } : {}),
      Producer: 'MedAssist',
    },
  });
  if (embedded) {
    doc.registerFont(UNICODE_FONTS.regular, fontFile(UNICODE_FILES.regular));
    doc.registerFont(UNICODE_FONTS.bold, fontFile(UNICODE_FILES.bold));
  }
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  doc.font(fonts.regular).fontSize(10).fillColor(colors.ink);
  const width = doc.page.width - margin * 2;

  return {
    doc,
    width,
    fonts,
    unicode: embedded,
    safe,
    money: (paise) => formatMoneyForPdf(paise, embedded),
    async finish() {
      const { timezone } = await getSettings();
      const generated = `Generated on ${formatClinicDateTime(new Date(), timezone)}`;
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        const y = doc.page.height - margin - 10;
        // Writing inside the bottom margin must not add a page.
        const bottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc
          .moveTo(margin, y - 6)
          .lineTo(doc.page.width - margin, y - 6)
          .lineWidth(0.5)
          .strokeColor(colors.line)
          .stroke();
        doc.font(fonts.regular).fontSize(8).fillColor(colors.muted);
        doc.text(generated, margin, y, { width, lineBreak: false });
        doc.text(`Page ${i - range.start + 1} of ${range.count}`, margin, y, {
          width,
          align: 'right',
          lineBreak: false,
        });
        if (watermark) drawWatermark(doc, fonts, watermark);
        doc.page.margins.bottom = bottom;
      }
      doc.end();
      return done;
    },
  };
}

/** Large, faint diagonal text across the current page (VOID). */
function drawWatermark(doc: Pdf, fonts: PdfFonts, text: string) {
  const { width, height } = doc.page;
  doc.save();
  doc.rotate(-35, { origin: [width / 2, height / 2] });
  doc
    .font(fonts.bold)
    .fontSize(120)
    .fillColor('#dc2626')
    .fillOpacity(0.12)
    .text(text, 0, height / 2 - 70, { width, align: 'center', lineBreak: false });
  doc.restore();
}

/** Clinic header from the settings: name, address, contact, registration number, GSTIN. */
export async function clinicHeader(pdf: PdfHandle, heading: string): Promise<void> {
  const { doc, width } = pdf;
  const s = await getSettings();
  const a = s.address;
  const address = [
    a?.line1,
    a?.line2,
    [a?.city, a?.state].filter(Boolean).join(', '),
    a?.postalCode,
  ]
    .filter(Boolean)
    .join(', ');
  const contact = [s.phone && `Phone ${s.phone}`, s.email].filter(Boolean).join(' | ');
  const registration = [
    s.registrationNumber && `Reg. no. ${s.registrationNumber}`,
    s.gstin && `GSTIN ${s.gstin}`,
  ]
    .filter(Boolean)
    .join(' | ');

  doc
    .font(pdf.fonts.bold)
    .fontSize(16)
    .fillColor(colors.ink)
    .text(pdf.safe(s.name ?? 'Clinic'), { width });
  doc.font(pdf.fonts.regular).fontSize(9).fillColor(colors.muted);
  for (const line of [address, contact, registration]) {
    if (line) doc.text(pdf.safe(line), { width });
  }
  doc.moveDown(0.4);
  rule(pdf);
  doc.moveDown(0.6);
  doc
    .font(pdf.fonts.bold)
    .fontSize(13)
    .fillColor(colors.ink)
    .text(pdf.safe(heading), { width, align: 'center' });
  doc.moveDown(0.6);
}

/** A thin horizontal line across the page at the current position. */
export function rule(pdf: PdfHandle): void {
  const { doc } = pdf;
  doc
    .moveTo(margin, doc.y)
    .lineTo(margin + pdf.width, doc.y)
    .lineWidth(0.75)
    .strokeColor(colors.line)
    .stroke();
}

/** Two columns of "Label: value" pairs (patient and order details). */
export function detailsGrid(pdf: PdfHandle, pairs: [string, string | null | undefined][]): void {
  const { doc, width } = pdf;
  const colWidth = width / 2;
  const labelWidth = 92;
  const rows = Math.ceil(pairs.length / 2);
  for (let r = 0; r < rows; r += 1) {
    const y = doc.y;
    let height = 0;
    for (let c = 0; c < 2; c += 1) {
      const pair = pairs[r * 2 + c];
      if (!pair) continue;
      const x = margin + c * colWidth;
      doc.font(pdf.fonts.bold).fontSize(9).fillColor(colors.muted);
      doc.text(pdf.safe(pair[0]), x, y, { width: labelWidth });
      doc.font(pdf.fonts.regular).fontSize(9).fillColor(colors.ink);
      doc.text(pdf.safe(pair[1] ?? '–'), x + labelWidth, y, { width: colWidth - labelWidth - 8 });
      height = Math.max(height, doc.y - y);
    }
    doc.x = margin;
    doc.y = y + height + 3;
  }
}

export interface TableColumn {
  header: string;
  /** Share of the width (all columns' shares are scaled to the full width). */
  width: number;
  align?: 'left' | 'right' | 'center';
}

export interface TableCell {
  text: string;
  bold?: boolean;
}

/**
 * A simple table: a shaded header row, then rows whose height follows the tallest cell. Starts a
 * new page (repeating the header) when a row does not fit.
 */
export function table(
  pdf: PdfHandle,
  columns: readonly TableColumn[],
  rows: readonly (readonly (TableCell | string)[])[],
): void {
  const { doc, width } = pdf;
  const total = columns.reduce((sum, c) => sum + c.width, 0);
  const widths = columns.map((c) => (c.width / total) * width);
  const pad = 4;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

  const cellHeight = (text: string, i: number, bold: boolean) => {
    doc.font(bold ? pdf.fonts.bold : pdf.fonts.regular).fontSize(9);
    return doc.heightOfString(pdf.safe(text) || ' ', { width: widths[i]! - pad * 2 });
  };

  const drawRow = (cells: readonly TableCell[], header: boolean) => {
    const height =
      Math.max(...cells.map((c, i) => cellHeight(c.text, i, header || Boolean(c.bold)))) + pad * 2;
    if (doc.y + height > bottomLimit()) {
      doc.addPage();
      if (!header)
        drawRow(
          columns.map((c) => ({ text: c.header })),
          true,
        );
    }
    const y = doc.y;
    if (header) doc.rect(margin, y, width, height).fill(colors.shade);
    let x = margin;
    cells.forEach((cell, i) => {
      doc
        .font(header || cell.bold ? pdf.fonts.bold : pdf.fonts.regular)
        .fontSize(9)
        .fillColor(header ? colors.muted : colors.ink)
        .text(pdf.safe(cell.text), x + pad, y + pad, {
          width: widths[i]! - pad * 2,
          align: columns[i]!.align ?? 'left',
        });
      x += widths[i]!;
    });
    doc
      .moveTo(margin, y + height)
      .lineTo(margin + width, y + height)
      .lineWidth(0.5)
      .strokeColor(colors.line)
      .stroke();
    doc.x = margin;
    doc.y = y + height;
  };

  drawRow(
    columns.map((c) => ({ text: c.header })),
    true,
  );
  for (const row of rows) {
    drawRow(
      row.map((c) => (typeof c === 'string' ? { text: c } : c)),
      false,
    );
  }
  doc.moveDown(0.5);
}

/** A bold section heading. */
export function heading(pdf: PdfHandle, text: string): void {
  const { doc, width } = pdf;
  if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) doc.addPage();
  doc
    .font(pdf.fonts.bold)
    .fontSize(11)
    .fillColor(colors.ink)
    .text(pdf.safe(text), margin, doc.y, { width });
  doc.moveDown(0.3);
}

/** A paragraph in the regular (or muted/italic) style. */
export function paragraph(
  pdf: PdfHandle,
  text: string,
  {
    muted = false,
    italic = false,
    align = 'left',
  }: { muted?: boolean; italic?: boolean; align?: 'left' | 'center' } = {},
): void {
  const { doc, width } = pdf;
  doc
    .font(italic ? pdf.fonts.italic : pdf.fonts.regular)
    .fontSize(9)
    .fillColor(muted ? colors.muted : colors.ink)
    .text(pdf.safe(text), margin, doc.y, { width, align });
}
