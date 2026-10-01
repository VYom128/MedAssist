import { FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';
import Badge from '../../../components/ui/Badge';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { formatDateTime } from '../../../utils/dates';
import type { LabOrderListItem } from '../api';
import { flagSummaryText } from '../format';
import { reviewOrder, useResultsToReview } from '../review';

const columns: Column<LabOrderListItem>[] = [
  {
    key: 'patient',
    header: 'Patient',
    cell: (o) => (
      <span>
        <span className="block font-medium text-ink">{o.patient.fullName}</span>
        <span className="block text-xs text-muted">{o.patient.mrn}</span>
      </span>
    ),
  },
  {
    key: 'order',
    header: 'Order',
    cell: (o) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <Link
          to={`/doctor/lab-orders/${o.id}`}
          className="font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary-600"
        >
          {o.orderNumber}
        </Link>
        {o.status !== 'released' && o.status !== 'verified' && (
          <Badge tone="warning">Unverified</Badge>
        )}
      </span>
    ),
  },
  { key: 'tests', header: 'Tests', cell: (o) => o.tests.map((t) => t.code).join(', ') },
  {
    key: 'flags',
    header: 'Flags',
    cell: (o) => {
      const text = flagSummaryText(o.flags);
      if (!text) return '—';
      return (
        <Badge
          tone={o.hasCritical ? 'danger' : text === 'All within range' ? 'success' : 'warning'}
        >
          {text}
        </Badge>
      );
    },
  },
  {
    key: 'released',
    header: 'Released',
    cell: (o) =>
      o.releasedAt ? (
        formatDateTime(o.releasedAt)
      ) : (
        <StatusPill domain="labOrder" status={o.status} size="sm" />
      ),
  },
];

/**
 * /doctor/lab-results – "Results to review" (Phase 6): the doctor's orders whose results (or a
 * critical value) are not yet acknowledged – critical first, then released, then unverified.
 */
export default function DoctorLabResultsPage() {
  const list = useResultsToReview();
  const rows = reviewOrder(list.data?.items ?? []);
  return (
    <section>
      <PageHeader
        title="Lab results to review"
        description="Critical values first. Open a result to see the values and acknowledge it."
      />
      <SectionCard title="Results" icon={FlaskConical} iconTone="info">
        {list.isLoading && <ListSkeleton label="Loading results…" rows={4} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && rows.length === 0 && (
          <EmptyState
            icon={FlaskConical}
            title="All caught up"
            description="New lab results appear here when the lab enters or releases them."
          />
        )}
        {rows.length > 0 && (
          <Table
            caption="Lab results to review"
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
          />
        )}
      </SectionCard>
    </section>
  );
}
