import { DRUG_FREQUENCY_LABELS, DRUG_TIMING_LABELS } from '../../constants/catalog';
import type { Prescription, PrescriptionItem, PrescriptionItemInput } from './api';

/** One editable prescription row (a stable `key` for React; not sent). */
export interface RxRow extends PrescriptionItemInput {
  key: string;
}

export interface RxLocal {
  rows: RxRow[];
  generalInstructions: string;
}

let next = 0;
export const newKey = () => `rx-${(next += 1)}`;

export const blankRow = (): RxRow => ({ key: newKey(), drugName: '', route: 'oral' });

/** The server's draft as editable rows. */
export function rowsFrom(p: Prescription | null): RxLocal {
  return {
    rows: (p?.items ?? []).map((i, n) => ({
      key: `server-${n}-${i.drugName}`,
      drugName: i.drugName,
      genericName: i.genericName,
      strength: i.strength,
      form: i.form,
      dose: i.dose,
      route: i.route,
      frequency: i.frequency,
      frequencyText: i.frequencyText,
      timing: i.timing,
      durationDays: i.durationDays,
      quantity: i.quantity,
      instructions: i.instructions,
    })),
    generalInstructions: p?.generalInstructions ?? '',
  };
}

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** A row as sent in PUT /encounters/:id/prescription. */
export function toInput({ key: _key, acknowledgeAllergy, ...row }: RxRow): PrescriptionItemInput {
  return {
    drugName: row.drugName.trim(),
    genericName: text(row.genericName),
    strength: text(row.strength),
    form: row.form || null,
    dose: text(row.dose),
    route: row.route || null,
    frequency: row.frequency || null,
    frequencyText: row.frequency === 'other' ? text(row.frequencyText) : null,
    timing: row.timing || null,
    durationDays: row.durationDays ?? null,
    quantity: text(row.quantity),
    instructions: text(row.instructions),
    ...(acknowledgeAllergy !== undefined ? { acknowledgeAllergy } : {}),
  };
}

/**
 * Rows that cannot be saved yet (index → field → message): a row without a drug name, or
 * frequency 'other' without text. The draft is saved only when none are left (the PUT replaces
 * every row, so a half-filled row would otherwise be lost).
 */
export function rowProblems(rows: readonly RxRow[]): Record<number, Record<string, string>> {
  const out: Record<number, Record<string, string>> = {};
  rows.forEach((r, i) => {
    const p: Record<string, string> = {};
    if (!r.drugName.trim()) p.drugName = 'Enter a drug name or remove the row';
    if (r.frequency === 'other' && !r.frequencyText?.trim()) {
      p.frequencyText = 'Describe the frequency';
    }
    if (Object.keys(p).length) out[i] = p;
  });
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The server's allergy warning for a row (by position when unchanged, else by drug name). */
export function warningFor(
  p: Prescription | null,
  row: RxRow,
  index: number,
  dirty: boolean,
): PrescriptionItem['allergyWarning'] {
  if (!p) return null;
  const item = dirty
    ? p.items.find((i) => norm(i.drugName) === norm(row.drugName))
    : p.items[index];
  return item && norm(item.drugName) === norm(row.drugName) ? (item.allergyWarning ?? null) : null;
}

/** A plain-text preview of the prescription. */
export function previewText(local: RxLocal): string {
  const lines = local.rows
    .filter((r) => r.drugName.trim())
    .map((r, i) => {
      const freq =
        r.frequency === 'other'
          ? r.frequencyText
          : r.frequency
            ? DRUG_FREQUENCY_LABELS[r.frequency]
            : null;
      const parts = [
        r.dose,
        freq,
        r.timing ? DRUG_TIMING_LABELS[r.timing].toLowerCase() : null,
        r.durationDays ? `for ${r.durationDays} day${r.durationDays === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      return `${i + 1}. ${r.drugName.trim()}${r.strength ? ` ${r.strength}` : ''}${
        parts.length ? ` – ${parts.join(', ')}` : ''
      }${r.instructions ? `\n   ${r.instructions}` : ''}`;
    });
  if (lines.length === 0) return 'No drugs yet.';
  return [
    ...lines,
    ...(local.generalInstructions.trim() ? ['', local.generalInstructions.trim()] : []),
  ].join('\n');
}
