import { Link } from 'react-router-dom';
import Badge from '../../../components/ui/Badge';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { formatDate } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { FlaskConical } from 'lucide-react';
import { useListLabOrdersQuery, type LabOrderListItem } from '../api';
import { flagSummaryText } from '../format';
import { UrgentPill } from './LabBadges';

/**
 * A patient's lab orders as a table. `doctor`: each order links to its results with a flag
 * summary. `reception`: status only – tests with prices, never results (spec §2.4).
 */
export default function PatientLabOrders({
  patientId,
  view,
}: {
  patientId: string;
  view: 'doctor' | 'reception';
}) {
  const list = useListLabOrdersQuery({ patient: patientId, limit: 50 });
  const rows = (list.data?.items ?? []).filter((o) => o.status !== 'draft');
  const columns: Column<LabOrderListItem>[] = [
    {
      key: 'order',
      header: 'Order',
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {view === 'doctor' ? (
            <Link
              to={`/doctor/lab-orders/${o.id}`}
              className="font-semibold text-primary-700 underline-offset-2 hover:underline"
            >
              {o.orderNumber}
            </Link>
          ) : (
            <span className="font-semibold text-ink">{o.orderNumber}</span>
          )}
          <UrgentPill priority={o.priority} />
        </span>
      ),
    },
    { key: 'date', header: 'Ordered', cell: (o) => formatDate(o.orderedAt) },
    {
      key: 'tests',
      header: 'Tests',
      cell: (o) =>
        o.tests
          .map((t) =>
            view === 'reception' && t.pricePaise !== undefined
              ? `${t.code} (${formatINR(t.pricePaise)})${t.cancelled ? ' – cancelled' : ''}`
              : t.code,
          )
          .join(', '),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (o) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusPill domain="labOrder" status={o.status} size="sm" />
          {view === 'doctor' && flagSummaryText(o.flags) && (
            <Badge tone={o.hasCritical ? 'danger' : 'neutral'}>{flagSummaryText(o.flags)}</Badge>
          )}
        </span>
      ),
    },
  ];
  if (list.isLoading) return <ListSkeleton label="Loading lab orders…" rows={3} />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  if (rows.length === 0) return <EmptyState icon={FlaskConical} title="No lab orders yet" />;
  return <Table caption="Lab orders" columns={columns} rows={rows} rowKey={(o) => o.id} />;
}
