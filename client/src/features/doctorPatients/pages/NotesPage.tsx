import { FileText, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import Badge from '../../../components/ui/Badge';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import StatusPill from '../../../components/ui/StatusPill';
import Table, { type Column } from '../../../components/ui/Table';
import Tabs from '../../../components/ui/Tabs';
import { linkClass } from '../../../components/ui/linkClass';
import type { EncounterStatus } from '../../../constants/catalog';
import { useListParams } from '../../../hooks/useListParams';
import { formatDateTime } from '../../../utils/dates';
import { useListEncountersQuery, type EncounterListItem } from '../../encounters/api';

const PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60_000;
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'signed', label: 'Signed' },
  { id: 'amended', label: 'Amended' },
] as const;

/** A draft more than 24 hours after the visit: still to be signed (documentation window 72 h). */
const isOverdueDraft = (e: EncounterListItem, now = Date.now()) =>
  e.status === 'draft' && now - new Date(e.visitAt).getTime() > DAY_MS;

/**
 * /doctor/notes – the doctor's own notes, newest visit first, filtered by status. Drafts older
 * than 24 hours are highlighted as "Unsigned" (they can be signed up to 72 hours after the visit).
 */
export default function NotesPage() {
  const list = useListParams();
  const status = (list.get('status') || 'all') as (typeof FILTERS)[number]['id'];
  const { data, isLoading, isFetching, isError, error, refetch } = useListEncountersQuery({
    mine: true,
    page: list.page,
    limit: PAGE_SIZE,
    ...(status !== 'all' ? { status: status as EncounterStatus } : {}),
  });

  const columns: Column<EncounterListItem>[] = [
    {
      key: 'patient',
      header: 'Patient',
      hideOnCard: true,
      cell: (e) => (
        <div>
          <Link
            to={
              e.status === 'draft'
                ? `/doctor/consult/${e.appointmentId}`
                : `/doctor/encounters/${e.id}`
            }
            className={linkClass}
          >
            {e.patient.fullName}
          </Link>
          <p className="text-xs text-muted">
            {e.patient.mrn} · {e.encounterNumber}
          </p>
        </div>
      ),
    },
    {
      key: 'visit',
      header: 'Visit',
      cell: (e) => <span className="tabular">{formatDateTime(e.visitAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (e) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <StatusPill domain="encounter" status={e.status} size="sm" />
          {isOverdueDraft(e) && (
            <Badge tone="danger" icon={TriangleAlert}>
              Unsigned
            </Badge>
          )}
          {e.version > 1 && <Badge tone="neutral">v{e.version}</Badge>}
        </span>
      ),
    },
  ];

  return (
    <section>
      <PageHeader
        title="Notes"
        description="Your visit notes. Drafts can be signed up to 72 hours after the consultation."
      />
      <Tabs
        label="Filter notes by status"
        variant="pills"
        tabs={FILTERS}
        value={status}
        onChange={(v) => list.update({ status: v === 'all' ? '' : v })}
      >
        {isLoading && <ListSkeleton label="Loading notes…" rows={6} />}
        {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
        {data && data.items.length === 0 && <EmptyState icon={FileText} title="No notes here" />}
        {data && data.items.length > 0 && (
          <div className={isFetching ? 'opacity-70' : ''}>
            <Table
              caption="My notes"
              columns={columns}
              rows={data.items}
              rowKey={(e) => e.id}
              cardHeader={(e) => columns[0]!.cell(e)}
            />
            <Pagination meta={data.meta} onPageChange={(p) => list.update({ page: String(p) })} />
          </div>
        )}
      </Tabs>
    </section>
  );
}
