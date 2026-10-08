import { Inbox, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import BackLink from '../../../components/ui/BackLink';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import SectionCard from '../../../components/ui/SectionCard';
import Select from '../../../components/ui/Select';
import StatusPill from '../../../components/ui/StatusPill';
import Tabs from '../../../components/ui/Tabs';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useListParams } from '../../../hooks/useListParams';
import { formatDateTime } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import { useListDoctorsQuery } from '../../doctors/api';
import { useListFollowupsQuery, type FollowupListItem } from '../api';
import FollowupDetail from '../components/FollowupDetail';
import { FOLLOWUP_TYPE_LABELS } from '../labels';

/** Inbox tabs → the statuses they show ("Closed" also holds rejected requests). */
const TABS = [
  { id: 'open', label: 'Open', status: 'open' },
  { id: 'in_review', label: 'In review', status: 'in_review' },
  { id: 'responded', label: 'Responded', status: 'responded' },
  { id: 'scheduled', label: 'Scheduled', status: 'scheduled' },
  { id: 'closed', label: 'Closed', status: 'closed,rejected' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** How many requests have `status` (one cheap `limit=1` call; the total is in `meta`). */
function useCount(status: string, assignedDoctor: string) {
  return useListFollowupsQuery({
    status,
    limit: 1,
    ...(assignedDoctor ? { assignedDoctor } : {}),
  }).data?.meta.total;
}

/** The tab labels with the number of requests in each. */
function useTabCounts(assignedDoctor: string) {
  const counts = [
    useCount(TABS[0].status, assignedDoctor),
    useCount(TABS[1].status, assignedDoctor),
    useCount(TABS[2].status, assignedDoctor),
    useCount(TABS[3].status, assignedDoctor),
    useCount(TABS[4].status, assignedDoctor),
  ];
  return TABS.map((t, i) => ({
    id: t.id,
    label: counts[i] === undefined ? t.label : `${t.label} (${counts[i]})`,
  }));
}

function Row({ r, to, selected }: { r: FollowupListItem; to: string; selected: boolean }) {
  return (
    <li>
      <Link
        to={to}
        aria-current={selected ? 'true' : undefined}
        className={`block rounded-control border p-3 transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
          selected
            ? 'border-primary-600 bg-primary-50'
            : 'border-line bg-surface hover:border-line-strong hover:bg-surface-muted'
        }`}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-ink">
              {r.patient.fullName ?? 'Patient'}
            </span>
            <span className="block truncate text-sm text-muted">
              {FOLLOWUP_TYPE_LABELS[r.type]?.label ?? r.type}
            </span>
          </span>
          <StatusPill domain="followup" status={r.status} size="sm" />
        </span>
        <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-subtle">
          <span className="tabular">{r.requestNumber}</span>
          <span>{r.assignedDoctor?.name ? `Dr ${r.assignedDoctor.name}` : 'Unassigned'}</span>
          <span className="tabular">{formatDateTime(r.lastMessageAt ?? r.createdAt ?? '')}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * /reception/follow-ups and /doctor/follow-ups (spec §4.10, §7.13): the request inbox with status
 * tabs and counts, search and (reception) a doctor filter; the selected request opens beside the
 * list from 1024 px and as its own page on smaller screens (`/…/follow-ups/:id`). Doctors see the
 * requests assigned to them (the server filters).
 */
export default function FollowUpsInboxPage() {
  const { id } = useParams();
  const location = useLocation();
  const user = useAppSelector(selectCurrentUser);
  const isReception = user?.role === 'receptionist';
  const base = isReception ? '/reception/follow-ups' : '/doctor/follow-ups';
  const params = useListParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'open') as TabId;
  const doctorFilter = params.get('doctor');
  const [search, setSearch] = useState(params.get('q'));
  const q = useDebouncedValue(search.trim(), 300);
  useEffect(() => {
    if (q !== params.get('q')) params.update({ q });
    // Only when the debounced text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const tabs = useTabCounts(doctorFilter);
  const status = TABS.find((t) => t.id === tab)!.status;
  const list = useListFollowupsQuery({
    status,
    page: params.page,
    limit: 20,
    ...(params.get('q') ? { q: params.get('q') } : {}),
    ...(doctorFilter ? { assignedDoctor: doctorFilter } : {}),
  });
  const doctors = useListDoctorsQuery({ limit: 100 }, { skip: !isReception });
  const keep = location.search;

  const listPane = (
    <SectionCard title="Requests" icon={Inbox} iconTone="primary" bodyClassName="space-y-4">
      <div className="grid gap-3">
        <Input
          label="Search"
          type="search"
          placeholder="Request number, MRN, phone or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {isReception && (
          <Select
            label="Doctor"
            placeholder="All doctors"
            options={(doctors.data?.items ?? []).map((d) => ({ value: d.id, label: d.name }))}
            value={doctorFilter}
            onChange={(e) => params.update({ doctor: e.target.value })}
          />
        )}
      </div>
      {list.isLoading && <ListSkeleton label="Loading requests…" rows={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.items.length === 0 && (
        <EmptyState icon={Inbox} title="No requests here" description="Nothing in this tab." />
      )}
      {list.data && list.data.items.length > 0 && (
        <>
          <ul
            aria-label="Follow-up requests"
            className={`space-y-2 transition-opacity duration-200 ease-standard ${list.isFetching ? 'opacity-60' : ''}`}
          >
            {list.data.items.map((r) => (
              <Row key={r.id} r={r} to={`${base}/${r.id}${keep}`} selected={r.id === id} />
            ))}
          </ul>
          <Pagination
            meta={list.data.meta}
            onPageChange={(page) => params.update({ page: String(page) })}
          />
        </>
      )}
    </SectionCard>
  );

  return (
    <section className="space-y-6">
      <PageHeader
        title="Follow-up requests"
        description={
          isReception
            ? 'Questions and requests from patients: reply, assign a doctor or book a visit.'
            : 'Requests from your patients assigned to you.'
        }
      />
      <Tabs
        label="Request status"
        tabs={tabs}
        value={tab}
        onChange={(next) => params.update({ tab: next })}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className={id ? 'hidden lg:block' : ''}>{listPane}</div>
          <div className={id ? '' : 'hidden lg:block'}>
            {id ? (
              <div className="space-y-4">
                <div className="lg:hidden">
                  <BackLink to={`${base}${keep}`} label="All requests" />
                </div>
                <FollowupDetail key={id} id={id} role={user?.role ?? 'receptionist'} />
              </div>
            ) : (
              <SectionCard title="Request" icon={MessageSquare} iconTone="neutral">
                <EmptyState
                  icon={MessageSquare}
                  title="Choose a request"
                  description="Its conversation and actions appear here."
                />
              </SectionCard>
            )}
          </div>
        </div>
      </Tabs>
    </section>
  );
}
