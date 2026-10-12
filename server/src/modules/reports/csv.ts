import type { Response } from 'express';
import { formatInTimeZone } from 'date-fns-tz';
import { paiseToRupeeString } from '../../utils/money.js';

/**
 * CSV export (spec §14, Phase 10 decisions): streamed with a UTF-8 BOM (Excel opens it as UTF-8),
 * CRLF lines, RFC 4180 quoting, dates in the clinic timezone, money as rupees with 2 decimals
 * from paise, ratios as percentages – and CSV-injection protection: a text cell starting with
 * = + - @ (or a tab / carriage return) gets a leading apostrophe so spreadsheets don't run it.
 */

export type CsvKind = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime';

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
  kind?: CsvKind;
}

const BOM = '﻿';
const DANGEROUS = /^[=+\-@\t\r]/;

/** One cell as CSV text (quoted when needed). */
export function csvCell(value: unknown, kind: CsvKind = 'text', timezone = 'UTC'): string {
  let text: string;
  if (value === null || value === undefined || value === '') {
    text = '';
  } else if (kind === 'money') {
    text = paiseToRupeeString(Number(value));
  } else if (kind === 'percent') {
    text = (Number(value) * 100).toFixed(1);
  } else if (kind === 'number') {
    text = String(value);
  } else if (kind === 'date' || kind === 'datetime') {
    const d = value instanceof Date ? value : new Date(String(value));
    text = Number.isNaN(d.getTime())
      ? String(value)
      : formatInTimeZone(d, timezone, kind === 'date' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm');
  } else {
    text = String(value);
    if (DANGEROUS.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine<T>(columns: readonly CsvColumn<T>[], row: T, timezone: string): string {
  return columns.map((c) => csvCell(c.value(row), c.kind, timezone)).join(',');
}

/**
 * Streams rows as a CSV download. Headers first, then one write per row (back-pressure aware),
 * then an optional totals row.
 */
export async function streamCsv<T>(
  res: Response,
  fileName: string,
  columns: readonly CsvColumn<T>[],
  rows: Iterable<T>,
  { timezone, totals }: { timezone: string; totals?: T },
): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  const write = (line: string) =>
    new Promise<void>((resolve) => {
      if (res.write(line)) resolve();
      else res.once('drain', resolve);
    });
  await write(BOM + columns.map((c) => csvCell(c.header)).join(',') + '\r\n');
  for (const row of rows) await write(csvLine(columns, row, timezone) + '\r\n');
  if (totals) await write(csvLine(columns, totals, timezone) + '\r\n');
  res.end();
}
