import { skipToken } from '@reduxjs/toolkit/query';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import Badge from '../../../components/ui/Badge';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import Modal from '../../../components/ui/Modal';
import StatusPill from '../../../components/ui/StatusPill';
import { formatDate } from '../../../utils/dates';
import { useGetLabOrderQuery, useListLabOrdersQuery, type LabOrderListItem } from '../api';
import LabOrderResults from './LabOrderResults';

function QuickView({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading, isError, error, refetch } = useGetLabOrderQuery(id ?? skipToken);
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      size="lg"
      title={data?.orderNumber ? `Lab order ${data.orderNumber}` : 'Lab order'}
    >
      {isLoading && <ListSkeleton label="Loading results…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <StatusPill domain="labOrder" status={data.status} size="sm" />
            Dr {data.orderedBy.name}
            {data.orderedAt ? ` · ordered ${formatDate(data.orderedAt)}` : ''}
          </p>
          <LabOrderResults order={data} />
        </div>
      )}
    </Modal>
  );
}

/** Released first, then the rest, newest first; drafts and cancelled orders are left out. */
function ordered(items: LabOrderListItem[]) {
  const shown = items.filter((o) => o.status !== 'draft' && o.status !== 'cancelled');
  const time = (o: LabOrderListItem) => new Date(o.releasedAt ?? o.orderedAt ?? 0).getTime();
  return [
    ...shown.filter((o) => o.status === 'released').sort((a, b) => time(b) - time(a)),
    ...shown.filter((o) => o.status !== 'released').sort((a, b) => time(b) - time(a)),
  ];
}

const rowClass =
  'w-full rounded-control px-2 py-2 text-left transition-colors duration-150 ease-standard hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-primary-600';

/** "Lab results" in the consult history panel: the patient's lab orders with flag counts. */
export default function LabHistory({ patientId }: { patientId: string }) {
  const list = useListLabOrdersQuery({ patient: patientId, limit: 20 });
  const [open, setOpen] = useState<string | null>(null);
  const orders = ordered(list.data?.items ?? []);
  return (
    <section aria-labelledby="history-lab">
      <h2 id="history-lab" className="mb-2 flex items-center gap-2 text-card text-ink">
        <FlaskConical className="h-4 w-4 text-muted" aria-hidden="true" /> Lab results
      </h2>
      {list.isLoading && <ListSkeleton label="Loading lab results…" rows={2} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && orders.length === 0 && (
        <p className="text-sm text-muted">No lab results yet.</p>
      )}
      <ul className="space-y-1">
        {orders.map((o) => (
          <li key={o.id}>
            <button type="button" className={rowClass} onClick={() => setOpen(o.id)}>
              <span className="block text-sm font-semibold text-ink">
                {o.tests.map((t) => t.code).join(', ')}
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {formatDate(o.releasedAt ?? o.orderedAt)}
                {o.status !== 'released' && (
                  <StatusPill domain="labOrder" status={o.status} size="sm" />
                )}
                {(o.flags?.critical ?? 0) > 0 && (
                  <Badge tone="danger">{o.flags!.critical} critical</Badge>
                )}
                {(o.flags?.abnormal ?? 0) > 0 && (
                  <Badge tone="warning">{o.flags!.abnormal} out of range</Badge>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <QuickView id={open} onClose={() => setOpen(null)} />
    </section>
  );
}
