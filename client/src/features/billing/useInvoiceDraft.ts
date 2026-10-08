import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InvoiceLineKind } from '../../constants/catalog';
import { isApiQueryError } from '../../utils/http';
import { useUpdateInvoiceMutation, type Invoice, type InvoiceLine, type LineInput } from './api';
import { percentOfPaise, previewLine, previewTotals, type PreviewTotals } from './calc';

/**
 * Editing a draft invoice (reception, admin): local rows, a live preview of the totals, and an
 * autosave-style PATCH with `expectedVersion` – 1.5 s after the last change, on "Save now" and
 * Ctrl/⌘+S; one request in flight (edits made meanwhile go in the next one). The server's answer
 * is the truth: once nothing changed since the request, the rows and totals are replaced by it.
 * - 409 CONFLICT / RECORD_LOCKED → `blocked` (reload banner), autosave stops;
 * - 422 DISCOUNT_REQUIRES_ADMIN → `discountLimit`, autosave waits for the next change;
 * - 400 field errors → shown on their rows.
 */

export const AUTOSAVE_DELAY_MS = 1500;

export interface EditRow {
  key: string;
  /** Server line id (absent for lines not saved yet). */
  id?: string;
  kind: InvoiceLineKind;
  origin: 'visit' | 'staff';
  /** New catalogue lines only. */
  serviceId?: string;
  labTestId?: string;
  description: string;
  quantity: number | null;
  unitPricePaise: number | null;
  discountMode: 'amount' | 'percent';
  discountPaise: number | null;
  /** Typed percentage when discountMode is 'percent'. */
  discountPercent: string;
  taxRateBps: number;
}

export type RowErrors = Partial<
  Record<'description' | 'quantity' | 'unitPricePaise' | 'discount', string>
>;

export type DraftBlock =
  { kind: 'conflict'; message: string } | { kind: 'locked'; message: string };

let seq = 0;
const newKey = () => `row-${(seq += 1)}`;

/** Price and quantity come from the catalogue / the visit and stay fixed. */
export const priceLocked = (r: Pick<EditRow, 'origin' | 'kind'>) =>
  r.origin === 'visit' || r.kind !== 'other';
/** Visit lines change only their discount and cannot be removed. */
export const quantityLocked = (r: Pick<EditRow, 'origin'>) => r.origin === 'visit';

export const rowFromLine = (l: InvoiceLine): EditRow => ({
  key: newKey(),
  id: l.id,
  kind: l.kind,
  origin: l.origin,
  description: l.description,
  quantity: l.quantity,
  unitPricePaise: l.unitPricePaise,
  discountMode: 'amount',
  discountPaise: l.discountPaise,
  discountPercent: '',
  taxRateBps: l.taxRateBps,
});

export function newRow(
  fields: Pick<EditRow, 'kind' | 'description' | 'unitPricePaise' | 'taxRateBps'> &
    Partial<Pick<EditRow, 'serviceId' | 'labTestId'>>,
): EditRow {
  return {
    key: newKey(),
    origin: 'staff',
    quantity: 1,
    discountMode: 'amount',
    discountPaise: 0,
    discountPercent: '',
    ...fields,
  };
}

/** The row's gross amount (quantity × price), or null while incomplete. */
export const grossOf = (r: EditRow) =>
  r.quantity !== null && r.unitPricePaise !== null && !Number.isNaN(r.unitPricePaise)
    ? r.quantity * r.unitPricePaise
    : null;

/** The discount in paise, from ₹ or % (half-up). NaN when the input is not a number. */
export function discountOf(r: EditRow): number | null {
  if (r.discountMode === 'amount') return r.discountPaise;
  if (r.discountPercent.trim() === '') return 0;
  const gross = grossOf(r);
  const pct = Number(r.discountPercent);
  if (gross === null) return null;
  return Number.isFinite(pct) ? percentOfPaise(gross, pct) : Number.NaN;
}

/** Local checks (the server checks again). */
export function rowErrors(r: EditRow): RowErrors {
  const e: RowErrors = {};
  if (!r.description.trim()) e.description = 'Describe this line';
  if (r.quantity === null || !Number.isInteger(r.quantity) || r.quantity < 1 || r.quantity > 999) {
    e.quantity = 'A whole number from 1 to 999';
  }
  if (r.unitPricePaise === null || Number.isNaN(r.unitPricePaise) || r.unitPricePaise < 0) {
    e.unitPricePaise = 'Enter a price';
  }
  const discount = discountOf(r);
  const gross = grossOf(r);
  if (discount === null || Number.isNaN(discount) || discount < 0) {
    e.discount = 'Enter a discount in ₹ or %';
  } else if (r.discountMode === 'percent' && Number(r.discountPercent) > 100) {
    e.discount = 'At most 100%';
  } else if (gross !== null && discount > gross) {
    e.discount = 'More than the line amount';
  }
  return e;
}

/** What the server is sent for a row (amounts are never sent). */
export function toLineInput(r: EditRow): LineInput {
  const discountPaise = discountOf(r) ?? 0;
  if (r.id) {
    return {
      id: r.id,
      discountPaise,
      ...(r.origin === 'staff' ? { quantity: r.quantity ?? 1 } : {}),
      ...(r.origin === 'staff' && r.kind === 'other'
        ? { description: r.description.trim(), unitPricePaise: r.unitPricePaise ?? 0 }
        : {}),
    };
  }
  const base = { quantity: r.quantity ?? 1, discountPaise };
  if (r.kind === 'lab_test') return { kind: 'lab_test', labTestId: r.labTestId, ...base };
  if (r.kind === 'other') {
    return {
      kind: 'other',
      description: r.description.trim(),
      unitPricePaise: r.unitPricePaise ?? 0,
      ...base,
    };
  }
  return { kind: r.kind, serviceId: r.serviceId, ...base };
}

interface Snapshot {
  rows: EditRow[];
  notes: string;
  dueDate: string;
}

const fromInvoice = (inv: Invoice): Snapshot => ({
  rows: inv.items.map(rowFromLine),
  notes: inv.notes ?? '',
  dueDate: inv.dueDate ?? '',
});

export function useInvoiceDraft(invoice: Invoice) {
  const [state, setState] = useState<Snapshot>(() => fromInvoice(invoice));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [block, setBlock] = useState<DraftBlock | null>(null);
  const [discountLimit, setDiscountLimit] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverRowErrors, setServerRowErrors] = useState<Record<string, RowErrors>>({});
  const [revision, setRevision] = useState(invoice.revision);
  // The server's latest answer: its totals are shown once nothing is unsaved (not the cache,
  // which is updated a moment later).
  const [server, setServer] = useState<Invoice>(invoice);
  const [update] = useUpdateInvoiceMutation();

  // Refs for the save loop (always the latest values, without re-creating the callback).
  const latest = useRef({ state, dirty, block, revision: invoice.revision, edit: 0 });
  useEffect(() => {
    latest.current.state = state;
    latest.current.dirty = dirty;
    latest.current.block = block;
  }, [state, dirty, block]);
  const inFlight = useRef(false);
  const again = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const localErrors = useMemo(
    () => Object.fromEntries(state.rows.map((r) => [r.key, rowErrors(r)])),
    [state.rows],
  );
  const valid = Object.values(localErrors).every((e) => Object.keys(e).length === 0);

  const change = useCallback((next: (s: Snapshot) => Snapshot) => {
    latest.current.edit += 1;
    setState(next);
    setDirty(true);
    setDiscountLimit(null);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const l = latest.current;
    if (!l.dirty || l.block) return;
    if (!l.state.rows.every((r) => Object.keys(rowErrors(r)).length === 0)) return;
    const sent = l.state;
    const editAtSend = l.edit;
    inFlight.current = true;
    setSaving(true);
    try {
      const saved = await update({
        id: invoice.id,
        expectedVersion: l.revision,
        items: sent.rows.map(toLineInput),
        notes: sent.notes.trim() || null,
        dueDate: sent.dueDate || null,
      }).unwrap();
      latest.current.revision = saved.revision;
      setRevision(saved.revision);
      setServer(saved);
      setServerRowErrors({});
      if (latest.current.edit === editAtSend) {
        // Nothing changed meanwhile: the server's lines (and totals) are the truth.
        setState(fromInvoice(saved));
        setDirty(false);
      } else {
        // Keep the newer edits; give the rows that were sent their server ids.
        const ids = new Map(sent.rows.map((r, i) => [r.key, saved.items[i]?.id]));
        setState((s) => ({
          ...s,
          rows: s.rows.map((r) => (r.id ? r : { ...r, id: ids.get(r.key) ?? r.id })),
        }));
      }
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'CONFLICT') {
        setBlock({ kind: 'conflict', message: err.message });
      } else if (isApiQueryError(err) && err.code === 'RECORD_LOCKED') {
        setBlock({ kind: 'locked', message: err.message });
      } else if (isApiQueryError(err) && err.code === 'DISCOUNT_REQUIRES_ADMIN') {
        const max = (err.details as { maxPercent?: number } | undefined)?.maxPercent;
        setDiscountLimit(max ?? invoice.rules?.maxDiscountPercentWithoutAdmin ?? 10);
      } else if (isApiQueryError(err) && Array.isArray(err.details)) {
        const byRow: Record<string, RowErrors> = {};
        for (const d of err.details as { field?: string; message?: string }[]) {
          const m = /^body\.items\.(\d+)\.(\w+)/.exec(d.field ?? '');
          const row = m ? sent.rows[Number(m[1])] : undefined;
          if (!row || !m) continue;
          const field = m[2] === 'discountPaise' ? 'discount' : (m[2] as keyof RowErrors);
          byRow[row.key] = { ...byRow[row.key], [field]: d.message };
        }
        setServerRowErrors(byRow);
        setError(err.message);
      } else {
        setError(isApiQueryError(err) ? err.message : 'The invoice could not be saved');
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  }, [invoice.id, invoice.rules, update]);

  // Debounced autosave after each change (not while blocked or waiting for an admin).
  useEffect(() => {
    if (!dirty || block || discountLimit !== null || !valid) return undefined;
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [state, dirty, block, discountLimit, valid, save]);

  /** Drop local edits and start again from `fresh` (after "Reload latest"). */
  const reset = useCallback((fresh: Invoice) => {
    latest.current.revision = fresh.revision;
    setRevision(fresh.revision);
    setServer(fresh);
    latest.current.edit += 1;
    setState(fromInvoice(fresh));
    setDirty(false);
    setBlock(null);
    setDiscountLimit(null);
    setError(null);
    setServerRowErrors({});
  }, []);

  const preview: PreviewTotals | null = useMemo(
    () =>
      valid
        ? previewTotals(
            state.rows.map((r) => ({
              quantity: r.quantity ?? 0,
              unitPricePaise: r.unitPricePaise ?? 0,
              discountPaise: discountOf(r) ?? 0,
              taxRateBps: r.taxRateBps,
            })),
          )
        : null,
    [state.rows, valid],
  );

  const errorsFor = (key: string): RowErrors => ({ ...serverRowErrors[key], ...localErrors[key] });

  return {
    rows: state.rows,
    notes: state.notes,
    dueDate: state.dueDate,
    dirty,
    saving,
    valid,
    block,
    discountLimit,
    error,
    preview,
    revision,
    server,
    errorsFor,
    setRows: (next: (rows: EditRow[]) => EditRow[]) =>
      change((s) => ({ ...s, rows: next(s.rows) })),
    setNotes: (notes: string) => change((s) => ({ ...s, notes })),
    setDueDate: (dueDate: string) => change((s) => ({ ...s, dueDate })),
    save,
    reset,
  };
}

/** A row's preview amounts (null while incomplete). */
export const rowPreview = (r: EditRow) =>
  previewLine({
    quantity: r.quantity ?? 0,
    unitPricePaise: r.unitPricePaise ?? 0,
    discountPaise: discountOf(r) ?? 0,
    taxRateBps: r.taxRateBps,
  });
