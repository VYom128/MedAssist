import { History } from 'lucide-react';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import SectionCard from '../../../components/ui/SectionCard';
import { NOTE_FIELD_LABELS } from '../../../constants/catalog';
import { formatDateTime } from '../../../utils/dates';
import { useListAmendmentsQuery } from '../api';
import { formatNoteValue } from '../fields';

/** Versions of a signed note: reason, author, date and before/after of each changed field. */
export default function AmendmentHistory({ encounterId }: { encounterId: string }) {
  const { data, isLoading, isError, error, refetch } = useListAmendmentsQuery(encounterId);
  return (
    <SectionCard title="Amendment history" icon={History} iconTone="info">
      {isLoading && <ListSkeleton label="Loading history…" rows={2} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <ol className="space-y-4">
          {[...data.amendments].reverse().map((a) => (
            <li key={a.id} className="rounded-control border border-line p-3">
              <p className="text-sm font-semibold text-ink">
                Version {a.version} · {a.amendedBy.name ? `Dr ${a.amendedBy.name}` : 'Unknown'} ·{' '}
                {formatDateTime(a.amendedAt)}
              </p>
              <p className="mt-1 text-sm">
                <span className="text-muted">Reason: </span>
                {a.reason}
              </p>
              <dl className="mt-2 space-y-2">
                {a.changedFields.map((f) => (
                  <div key={f} className="text-sm">
                    <dt className="font-medium text-ink">{NOTE_FIELD_LABELS[f] ?? f}</dt>
                    <dd className="grid gap-1 sm:grid-cols-2">
                      <span className="rounded-control bg-danger-50 px-2 py-1">
                        <span className="sr-only">Before: </span>
                        <span aria-hidden="true" className="font-semibold">
                          −{' '}
                        </span>
                        {formatNoteValue(f, a.before[f])}
                      </span>
                      <span className="rounded-control bg-success-50 px-2 py-1">
                        <span className="sr-only">After: </span>
                        <span aria-hidden="true" className="font-semibold">
                          +{' '}
                        </span>
                        {formatNoteValue(f, a.after[f])}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
          <li className="text-sm text-muted">
            Version 1 · signed {data.signedAt ? formatDateTime(data.signedAt) : ''}
          </li>
        </ol>
      )}
    </SectionCard>
  );
}
