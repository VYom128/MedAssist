import { inflateSync } from 'node:zlib';

/**
 * The text drawn in a PDFKit document (for assertions): inflates each content stream and decodes
 * the hex strings of its text operators (standard fonts, WinAnsi). Good enough to find numbers
 * and names; not a general PDF parser.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  const streams = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of raw.matchAll(streams)) {
    const bytes = Buffer.from(match[1]!, 'latin1');
    let content: string;
    try {
      content = inflateSync(bytes).toString('latin1');
    } catch {
      content = match[1]!;
    }
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
      parts.push(Buffer.from(hex[1]!, 'hex').toString('latin1'));
    }
    for (const lit of content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)) parts.push(lit[1]!);
  }
  return parts.join('');
}

export const isPdf = (buffer: Buffer) =>
  buffer.subarray(0, 5).toString('latin1') === '%PDF-' &&
  buffer.subarray(-6).toString('latin1').includes('%%EOF');
