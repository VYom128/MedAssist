import { skipToken } from '@reduxjs/toolkit/query';
import { FileText, Pill } from 'lucide-react';
import { useState } from 'react';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Modal from '../../../components/ui/Modal';
import StatusPill from '../../../components/ui/StatusPill';
import { formatDate } from '../../../utils/dates';
import { useGetPrescriptionQuery, useListPrescriptionsQuery } from '../../prescriptions/api';
import PrescriptionItems from '../../prescriptions/components/PrescriptionItems';
import { useGetEncounterQuery, useListEncountersQuery } from '../api';
import EncounterReadView from './EncounterReadView';

/** Read-only quick view of an earlier signed note. */
function NoteQuickView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, isError, error, refetch } = useGetEncounterQuery(id ?? skipToken);
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      size="lg"
      title={data ? `Visit on ${formatDate(data.visitAt)}` : 'Earlier visit'}
    >
      {isLoading && <ListSkeleton label="Loading note…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {data.encounterNumber} · Dr {data.doctor.name} ·{' '}
            <StatusPill domain="encounter" status={data.status} size="sm" /> · version{' '}
            {data.version}
          </p>
          <EncounterReadView encounter={data} />
        </div>
      )}
    </Modal>
  );
}

function PrescriptionQuickView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, isError, error, refetch } = useGetPrescriptionQuery(id ?? skipToken);
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={data?.prescriptionNumber ? `Prescription ${data.prescriptionNumber}` : 'Prescription'}
    >
      {isLoading && <ListSkeleton label="Loading prescription…" rows={2} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Dr {data.doctor.name}
            {data.issuedAt ? ` · issued ${formatDate(data.issuedAt)}` : ''}
          </p>
          <PrescriptionItems prescription={data} />
        </div>
      )}
    </Modal>
  );
}

const rowClass =
  'w-full rounded-control px-2 py-2 text-left transition-colors duration-150 ease-standard hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-primary-600';

/**
 * The patient's earlier signed notes (date, doctor, primary diagnosis) and active prescriptions,
 * each opening a read-only quick view. The patient timeline replaces this in Phase 8.
 */
export default function HistoryPanel({
  patientId,
  currentEncounterId,
}: {
  patientId: string;
  currentEncounterId?: string;
}) {
  const notes = useListEncountersQuery({ patient: patientId, limit: 20 });
  const rx = useListPrescriptionsQuery({ patient: patientId, status: 'issued', limit: 20 });
  const [note, setNote] = useState<string | null>(null);
  const [prescription, setPrescription] = useState<string | null>(null);
  const earlier = (notes.data?.items ?? []).filter(
    (e) => e.id !== currentEncounterId && e.status !== 'draft',
  );

  return (
    <div className="space-y-6">
      <section aria-labelledby="history-notes">
        <h2 id="history-notes" className="mb-2 flex items-center gap-2 text-card text-ink">
          <FileText className="h-4 w-4 text-muted" aria-hidden="true" /> Previous visits
        </h2>
        {notes.isLoading && <ListSkeleton label="Loading visits…" rows={3} />}
        {notes.isError && <ErrorState error={notes.error} onRetry={() => void notes.refetch()} />}
        {notes.data && earlier.length === 0 && (
          <p className="text-sm text-muted">No earlier signed visits.</p>
        )}
        <ul className="space-y-1">
          {earlier.map((e) => (
            <li key={e.id}>
              <button type="button" className={rowClass} onClick={() => setNote(e.id)}>
                <span className="block text-sm font-semibold text-ink">
                  {e.primaryDiagnosis ?? 'No diagnosis recorded'}
                </span>
                <span className="block text-xs text-muted">
                  {formatDate(e.visitAt)} · Dr {e.doctor.name}
                  {e.status === 'amended' ? ' · amended' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="history-rx">
        <h2 id="history-rx" className="mb-2 flex items-center gap-2 text-card text-ink">
          <Pill className="h-4 w-4 text-muted" aria-hidden="true" /> Active prescriptions
        </h2>
        {rx.isLoading && <ListSkeleton label="Loading prescriptions…" rows={2} />}
        {rx.isError && <ErrorState error={rx.error} onRetry={() => void rx.refetch()} />}
        {rx.data && rx.data.items.length === 0 && (
          <p className="text-sm text-muted">No active prescriptions.</p>
        )}
        <ul className="space-y-1">
          {(rx.data?.items ?? []).map((p) => (
            <li key={p.id}>
              <button type="button" className={rowClass} onClick={() => setPrescription(p.id)}>
                <span className="block text-sm font-semibold text-ink">
                  {p.prescriptionNumber} · {p.itemCount} drug{p.itemCount === 1 ? '' : 's'}
                </span>
                <span className="block text-xs text-muted">
                  {p.issuedAt ? formatDate(p.issuedAt) : ''} · Dr {p.doctor.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <NoteQuickView id={note} onClose={() => setNote(null)} />
      <PrescriptionQuickView id={prescription} onClose={() => setPrescription(null)} />
    </div>
  );
}
