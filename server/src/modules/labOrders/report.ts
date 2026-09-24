import type { ClientSession, Types } from 'mongoose';
import {
  createPdf,
  clinicHeader,
  detailsGrid,
  heading,
  paragraph,
  rule,
  table,
  type TableCell,
} from '../../services/pdf.service.js';
import { formatClinicDateTime } from '../../utils/dates.js';
import { Document } from '../documents/model.js';
import {
  createGeneratedDocument,
  logOrphanedFile,
  storeGeneratedFile,
} from '../documents/service.js';
import { ageOf } from '../patients/serializer.js';
import { getSettings } from '../settings/service.js';
import type { LabOrderItem } from './model.js';
import type { LabOrderLike } from './serializer.js';

/**
 * The lab report PDF (spec §4.8, §12.3), made on release and on every applied revision. It is
 * built BEFORE the release/revision transaction and stored; `save()` records its Document inside
 * the transaction (older reports of the order stay, hidden from the patient); if the transaction
 * fails, `discard()` logs the orphaned file.
 */

export interface PreparedReport {
  save(session: ClientSession): Promise<Types.ObjectId>;
  discard(err?: unknown): Promise<void>;
}

export interface ReportOptions {
  kind: 'release' | 'revision';
  /** Release time and releaser (the order may not be released yet when the PDF is built). */
  releasedAt: Date;
  releasedBy: string;
  /** The user the generated document is recorded for. */
  createdBy: string;
}

const FLAG_LABELS: Record<string, string> = {
  low: 'Low',
  high: 'High',
  critical_low: 'CRITICAL LOW **',
  critical_high: 'CRITICAL HIGH **',
  abnormal: 'Abnormal',
};

type Person = { firstName: string; lastName: string } | { toString(): string } | null | undefined;
const nameOf = (p: Person) => (p && 'firstName' in p ? `${p.firstName} ${p.lastName}` : null);
const sexLabel = (g: string) => (g === 'male' ? 'Male' : g === 'female' ? 'Female' : 'Other');

const valueText = (value: unknown) =>
  value === null || value === undefined
    ? '–'
    : typeof value === 'number'
      ? String(value)
      : String(value);

function resultRows(item: LabOrderItem): TableCell[][] {
  return (item.results ?? []).map((r) => {
    const abnormal = r.flag !== 'normal' && r.flag !== 'na';
    return [
      { text: r.name },
      { text: valueText(r.value), bold: abnormal },
      { text: r.unit ?? '' },
      { text: r.referenceText ?? '' },
      { text: FLAG_LABELS[r.flag] ?? '', bold: abnormal },
    ];
  });
}

/** The report bytes for `o` as it will read once released / revised. */
export async function buildLabReportPdf(o: LabOrderLike, opts: ReportOptions): Promise<Buffer> {
  const { timezone } = await getSettings();
  const when = (d?: Date | null) => (d ? formatClinicDateTime(d, timezone) : '–');
  const received = (o.statusHistory ?? []).find((h) => h.status === 'processing')?.at;
  const version = Math.max(1, ...o.items.map((i) => i.resultVersion ?? 1));
  const pdf = createPdf({
    title: `Lab report ${o.orderNumber ?? ''}`.trim(),
    subject: 'Laboratory report',
  });

  await clinicHeader(pdf, 'Laboratory report');
  if (version > 1) {
    paragraph(pdf, `Revised report – version ${version}. It replaces the earlier versions.`, {
      italic: true,
      align: 'center',
    });
    pdf.doc.moveDown(0.5);
  }
  const age = o.sample?.patientAgeYears ?? ageOf(o.patient);
  detailsGrid(pdf, [
    ['Patient', `${o.patient.firstName} ${o.patient.lastName}`],
    ['Order number', o.orderNumber ?? '–'],
    ['Age / sex', `${age} years / ${sexLabel(o.patient.gender)}`],
    ['Ordered by', `Dr ${o.orderedBy.firstName} ${o.orderedBy.lastName}`],
    ['MRN', o.patient.mrn],
    ['Sample ID', o.sample?.sampleId ?? '–'],
    ['Collected', when(o.sample?.collectedAt)],
    ['Received', when(received)],
    ['Released', when(opts.releasedAt)],
    ['Priority', o.priority === 'urgent' ? 'Urgent' : 'Routine'],
  ]);
  pdf.doc.moveDown(0.4);
  rule(pdf);
  pdf.doc.moveDown(0.6);

  const columns = [
    { header: 'Parameter', width: 30 },
    { header: 'Result', width: 16 },
    { header: 'Unit', width: 12 },
    { header: 'Reference', width: 24 },
    { header: 'Flag', width: 18 },
  ];
  for (const item of o.items.filter((i) => i.status !== 'cancelled')) {
    heading(pdf, `${item.testSnapshot.name} (${item.testSnapshot.code})`);
    table(pdf, columns, resultRows(item));
    if (item.remarks) paragraph(pdf, `Remarks: ${item.remarks}`);
    const verifier = nameOf(item.verifiedBy as Person);
    paragraph(
      pdf,
      [
        verifier
          ? `Verified by ${verifier}${item.verifiedAt ? ` on ${when(item.verifiedAt)}` : ''}`
          : null,
        (item.resultVersion ?? 1) > 1 ? `Revised – version ${item.resultVersion}` : null,
      ]
        .filter(Boolean)
        .join('   |   '),
      { muted: true },
    );
    pdf.doc.moveDown(0.8);
  }
  const cancelled = o.items.filter((i) => i.status === 'cancelled');
  if (cancelled.length > 0) {
    paragraph(pdf, `Not performed: ${cancelled.map((i) => i.testSnapshot.name).join(', ')}`, {
      muted: true,
    });
    pdf.doc.moveDown(0.5);
  }
  if (o.items.some((i) => (i.results ?? []).some((r) => r.flag.startsWith('critical')))) {
    paragraph(pdf, '** Critical value – the ordering doctor was alerted.', { muted: true });
  }
  pdf.doc.moveDown(0.5);
  paragraph(pdf, `Released by ${opts.releasedBy} on ${when(opts.releasedAt)}`);
  pdf.doc.moveDown(1);
  paragraph(pdf, '*** End of report ***', { align: 'center', muted: true });
  return pdf.finish();
}

/**
 * Builds and stores the report for `o` (step 1, outside the transaction) and returns how to
 * record it (inside) or report the orphan (after a failed transaction).
 */
export async function prepareReleaseReport(
  o: LabOrderLike,
  opts: ReportOptions,
): Promise<PreparedReport> {
  const buffer = await buildLabReportPdf(o, opts);
  const { storageKey } = await storeGeneratedFile(buffer);
  const version = Math.max(1, ...o.items.map((i) => i.resultVersion ?? 1));
  const number = o.orderNumber ?? o._id.toString();
  return {
    async save(session) {
      const id = await createGeneratedDocument(
        {
          patient: o.patient._id,
          category: 'lab_report',
          title: `Lab report ${number}${version > 1 ? ` (version ${version})` : ''}`,
          fileName: `lab-report-${number}${version > 1 ? `-v${version}` : ''}.pdf`,
          buffer,
          storageKey,
          linked: { type: 'lab_order', id: o._id },
          visibleToPatient: true,
          createdBy: opts.createdBy,
        },
        session,
      );
      // Earlier reports stay for staff; the patient sees the current one only.
      await Document.updateMany(
        {
          'linked.type': 'lab_order',
          'linked.id': o._id,
          isGenerated: true,
          _id: { $ne: id },
        },
        { $set: { visibleToPatient: false } },
        { session },
      );
      return id;
    },
    async discard(err) {
      logOrphanedFile(storageKey, `lab report of lab order ${o._id.toString()}`, err);
    },
  };
}
