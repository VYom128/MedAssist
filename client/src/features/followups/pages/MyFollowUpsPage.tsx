import { MessageSquare, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import { buttonClass } from '../../../components/ui/buttonClass';
import { useListParams } from '../../../hooks/useListParams';
import { formatDate, formatDateTime } from '../../../utils/dates';
import { useListFollowupsQuery, type FollowupListItem } from '../api';
import EmergencyBanner from '../components/EmergencyBanner';
import { FOLLOWUP_TYPE_LABELS } from '../labels';

const columns: Column<FollowupListItem>[] = [
  {
    key: 'request',
    header: 'Request',
    cell: (r) => (
      <Link
        to={`/patient/follow-ups/${r.id}`}
        className="font-semibold text-primary-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        {FOLLOWUP_TYPE_LABELS[r.type]?.label ?? r.type}
      </Link>
    ),
  },
  {
    key: 'sent',
    header: 'Sent',
    cell: (r) => <span className="tabular">{r.createdAt ? formatDate(r.createdAt) : '—'}</span>,
  },
  {
    key: 'last',
    header: 'Last message',
    cell: (r) => (
      <span className="tabular text-muted">
        {r.lastMessageAt ? formatDateTime(r.lastMessageAt) : 'No reply yet'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => <StatusPill domain="followup" status={r.status} size="sm" />,
  },
];

/** /patient/follow-ups – the patient's follow-up requests with their status (spec §4.10). */
export default function MyFollowUpsPage() {
  const params = useListParams();
  const list = useListFollowupsQuery({ page: params.page, limit: 20 });
  const newButton = (
    <Link to="/patient/follow-ups/new" className={buttonClass('primary')}>
      <Plus className="h-4 w-4" aria-hidden="true" /> New request
    </Link>
  );
  return (
    <section className="space-y-6">
      <PageHeader
        title="Follow-ups"
        description="Ask your doctor a question, report a change, or ask for a refill or a visit."
        actions={newButton}
      />
      <EmergencyBanner />
      <SectionCard title="My requests" icon={MessageSquare} iconTone="primary">
        {list.isLoading && <ListSkeleton label="Loading your requests…" rows={3} />}
        {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
        {list.data && list.data.items.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No requests yet"
            description="Send a request and the clinic will reply here."
            action={newButton}
          />
        )}
        {list.data && list.data.items.length > 0 && (
          <>
            <Table
              caption="My follow-up requests"
              columns={columns}
              rows={list.data.items}
              rowKey={(r) => r.id}
            />
            <Pagination
              meta={list.data.meta}
              onPageChange={(page) => params.update({ page: String(page) })}
            />
          </>
        )}
      </SectionCard>
    </section>
  );
}
