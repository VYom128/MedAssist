import PDFDocument from 'pdfkit';
import { getSettings } from '../modules/settings/service.js';
import { formatClinicDateTime } from '../utils/dates.js';

/**
 * Server-side PDFs (spec §12.3) with PDFKit and its standard fonts only (Helvetica: Latin-1 –
 * no ₹ or Indic glyphs, so these documents carry no money). Build a document with `createPdf()`,
 * draw with the helpers, then `finish()` adds the page footers ("Generated on <clinic time>",
 * "Page n of m") and resolves the bytes.
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

const { margin, fonts, colors } = PDF_LAYOUT;

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

export interface PdfHandle {
  doc: Pdf;
  /** Width available between the margins. */
  width: number;
  /** Adds footers to every page and returns the finished PDF. */
  finish(): Promise<Buffer>;
}

/** A new A4 document with buffered pages (footers are drawn at the end). */
export function createPdf({ title, subject }: { title: string; subject?: string }): PdfHandle {
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
        doc.page.margins.bottom = bottom;
      }
      doc.end();
      return done;
    },
  };
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
    .font(fonts.bold)
    .fontSize(16)
    .fillColor(colors.ink)
    .text(pdfSafe(s.name ?? 'Clinic'), { width });
  doc.font(fonts.regular).fontSize(9).fillColor(colors.muted);
  for (const line of [address, contact, registration]) {
    if (line) doc.text(pdfSafe(line), { width });
  }
  doc.moveDown(0.4);
  rule(pdf);
  doc.moveDown(0.6);
  doc
    .font(fonts.bold)
    .fontSize(13)
    .fillColor(colors.ink)
    .text(pdfSafe(heading), { width, align: 'center' });
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
      doc.font(fonts.bold).fontSize(9).fillColor(colors.muted);
      doc.text(pdfSafe(pair[0]), x, y, { width: labelWidth });
      doc.font(fonts.regular).fontSize(9).fillColor(colors.ink);
      doc.text(pdfSafe(pair[1] ?? '–'), x + labelWidth, y, { width: colWidth - labelWidth - 8 });
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
    doc.font(bold ? fonts.bold : fonts.regular).fontSize(9);
    return doc.heightOfString(pdfSafe(text) || ' ', { width: widths[i]! - pad * 2 });
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
        .font(header || cell.bold ? fonts.bold : fonts.regular)
        .fontSize(9)
        .fillColor(header ? colors.muted : colors.ink)
        .text(pdfSafe(cell.text), x + pad, y + pad, {
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
    .font(fonts.bold)
    .fontSize(11)
    .fillColor(colors.ink)
    .text(pdfSafe(text), margin, doc.y, { width });
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
    .font(italic ? fonts.italic : fonts.regular)
    .fontSize(9)
    .fillColor(muted ? colors.muted : colors.ink)
    .text(pdfSafe(text), margin, doc.y, { width, align });
}
