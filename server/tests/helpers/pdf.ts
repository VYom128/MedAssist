import { inflateSync } from 'node:zlib';

/**
 * The text drawn in a PDFKit document (for assertions). Reads the page content streams and
 * decodes the strings of their text operators per font: standard fonts as WinAnsi bytes,
 * embedded fonts (Identity-H, e.g. Noto Sans for ₹) through the font's ToUnicode map. Good
 * enough to find numbers and names; not a general PDF parser.
 */

interface PdfObject {
  dict: string;
  stream?: Buffer;
}

const inflate = (bytes: Buffer) => {
  try {
    return inflateSync(bytes).toString('latin1');
  } catch {
    return bytes.toString('latin1');
  }
};

function objectsOf(raw: string): Map<number, PdfObject> {
  const objects = new Map<number, PdfObject>();
  for (const m of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)\bendobj/g)) {
    const body = m[2]!;
    const start = /\bstream\r?\n/.exec(body);
    if (!start) {
      objects.set(Number(m[1]), { dict: body });
      continue;
    }
    const data = body.slice(start.index + start[0].length);
    const end = data.lastIndexOf('endstream');
    objects.set(Number(m[1]), {
      dict: body.slice(0, start.index),
      stream: Buffer.from(data.slice(0, end).replace(/\r?\n$/, ''), 'latin1'),
    });
  }
  return objects;
}

/** UTF-16BE hex ('20B9') → text. */
const utf16 = (hex: string) => Buffer.from(hex, 'hex').swap16().toString('utf16le');

/** A ToUnicode CMap: glyph id → text. */
function parseCmap(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(parseInt(m[1]!, 16), utf16(m[2]!));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const entries = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g;
    for (const m of block[1]!.matchAll(entries)) {
      const lo = parseInt(m[1]!, 16);
      const hi = parseInt(m[2]!, 16);
      if (m[3]!.startsWith('[')) {
        [...m[3]!.matchAll(/<([0-9a-fA-F]+)>/g)].forEach((d, i) => map.set(lo + i, utf16(d[1]!)));
      } else {
        const first = parseInt(m[3]!.slice(1, -1), 16);
        for (let g = lo; g <= hi; g += 1) map.set(g, String.fromCodePoint(first + g - lo));
      }
    }
  }
  return map;
}

export function pdfText(pdf: Buffer): string {
  const objects = objectsOf(pdf.toString('latin1'));

  // Font resource names (/F1 …) → their ToUnicode map, for embedded (Type0) fonts.
  const cmaps = new Map<string, Map<number, string>>();
  for (const { dict } of objects.values()) {
    for (const ref of dict.matchAll(/\/(F\d+)\s+(\d+)\s+0\s+R/g)) {
      const font = objects.get(Number(ref[2]));
      const toUnicode = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font?.dict ?? '');
      const stream = toUnicode ? objects.get(Number(toUnicode[1]))?.stream : undefined;
      if (stream) cmaps.set(ref[1]!, parseCmap(inflate(stream)));
    }
  }

  const contents = new Set<number>();
  for (const { dict } of objects.values()) {
    for (const ref of dict.matchAll(/\/Contents\s+(\d+)\s+0\s+R/g)) contents.add(Number(ref[1]));
  }

  const parts: string[] = [];
  for (const id of [...contents].sort((a, b) => a - b)) {
    const stream = objects.get(id)?.stream;
    if (!stream) continue;
    const content = inflate(stream);
    let cmap: Map<number, string> | undefined;
    const tokens = /\/(F\d+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]*)>|\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    for (const t of content.matchAll(tokens)) {
      if (t[1]) {
        cmap = cmaps.get(t[1]);
      } else if (t[2] !== undefined) {
        if (cmap) {
          for (let i = 0; i + 4 <= t[2].length; i += 4) {
            parts.push(cmap.get(parseInt(t[2].slice(i, i + 4), 16)) ?? '');
          }
        } else {
          parts.push(Buffer.from(t[2], 'hex').toString('latin1'));
        }
      } else if (t[3] !== undefined) {
        parts.push(t[3]);
      }
    }
  }
  return parts.join('');
}

export const isPdf = (buffer: Buffer) =>
  buffer.subarray(0, 5).toString('latin1') === '%PDF-' &&
  buffer.subarray(-6).toString('latin1').includes('%%EOF');
