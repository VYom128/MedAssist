import { History } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import FilterChip from '../../../components/ui/FilterChip';
import IconChip from '../../../components/ui/IconChip';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import StatusPill from '../../../components/ui/StatusPill';
import { formatDateTime, formatInClinic, formatTime } from '../../../utils/dates';
import {
  flattenPages,
  useGetTimelineInfiniteQuery,
  type TimelineItem,
  type TimelineType,
} from '../api';
import { FLAG_BADGES, groupByMonth, TYPE_LOOK } from '../look';

function ItemStatus({ item }: { item: TimelineItem }) {
  const domain = TYPE_LOOK[item.type]?.domain;
  if (!domain || !item.status) return null;
  return <StatusPill domain={domain} status={item.status as never} size="sm" />;
}

function Row({ item, compact }: { item: TimelineItem; compact: boolean }) {
  const look = TYPE_LOOK[item.type] ?? TYPE_LOOK.document;
  const flags = item.flags.filter((f) => FLAG_BADGES[f]);
  const title = item.link ? (
    <Link
      to={item.link}
      className="font-semibold text-ink underline-offset-2 hover:text-primary-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
    >
      {item.title}
    </Link>
  ) : (
    <span className="font-semibold text-ink">{item.title}</span>
  );
  return (
    <li className="group/item relative flex gap-3 pb-5 last:pb-0">
      {/* The vertical line between icons (decorative). */}
      <span
        aria-hidden="true"
        className="absolute top-10 bottom-1 left-4 w-px bg-line group-last/item:hidden"
      />
      <IconChip icon={look.icon} tone={look.tone} size="sm" className="relative shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-sm break-words">{title}</p>
          <ItemStatus item={item} />
        </div>
        {item.subtitle && (
          <p className={`text-sm break-words text-muted ${compact ? 'line-clamp-2' : ''}`}>
            {item.subtitle}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <time dateTime={item.at} className="tabular text-xs text-subtle">
            {compact ? formatDateTime(item.at) : formatTime(item.at)}
            {!compact && ` · ${formatInClinic(item.at, 'dd MMM')}`}
          </time>
          {flags.map((f) => (
            <Badge key={f} tone={FLAG_BADGES[f]!.tone}>
              {FLAG_BADGES[f]!.label}
            </Badge>
          ))}
        </div>
      </div>
    </li>
  );
}

/**
 * A patient's timeline (spec §8.8), newest first and grouped by month: an icon per type, title,
 * subtitle, status, clinic time and a link to the item's page. What it shows is decided by the
 * server for the viewer's role – this component only renders it. `types` are the filter chips the
 * role can use; `compact` (side panels) drops the filters and month headings.
 */
export default function Timeline({
  patientId,
  types,
  compact = false,
  pageSize,
  label = 'Patient timeline',
}: {
  /** A patient id, or 'me'. */
  patientId: string;
  /** Item types offered as filters (empty/undefined: no filter chips). */
  types?: readonly TimelineType[];
  compact?: boolean;
  pageSize?: number;
  label?: string;
}) {
  const [selected, setSelected] = useState<TimelineType[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const rangeError = from && to && from > to ? 'Must be on or after the start date' : undefined;
  const query = useGetTimelineInfiniteQuery(
    {
      patientId,
      ...(selected.length > 0 ? { types: [...selected].sort() } : {}),
      ...(from && !rangeError ? { from } : {}),
      ...(to && !rangeError ? { to } : {}),
      limit: pageSize ?? (compact ? 10 : 20),
    },
    { refetchOnMountOrArgChange: 30 },
  );
  const items = flattenPages(query.data?.pages);
  const filtered = selected.length > 0 || Boolean(from) || Boolean(to);
  const toggle = (t: TimelineType) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <div className="space-y-5">
      {!compact && types && types.length > 0 && (
        <div className="space-y-3">
          <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
            <FilterChip
              label="All"
              selected={selected.length === 0}
              onClick={() => setSelected([])}
            />
            {types.map((t) => (
              <FilterChip
                key={t}
                label={TYPE_LOOK[t].label}
                selected={selected.includes(t)}
                onClick={() => toggle(t)}
              />
            ))}
          </div>
          <div className="grid gap-3 sm:max-w-md sm:grid-cols-2">
            <Input
              label="From"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={to}
              error={rangeError}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      )}

      {query.isLoading && <ListSkeleton label="Loading the timeline…" rows={compact ? 3 : 5} />}
      {query.isError && !query.data && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.data && items.length === 0 && (
        <EmptyState
          icon={History}
          title={filtered ? 'Nothing matches these filters' : 'Nothing here yet'}
          description={
            filtered
              ? 'Try other types or dates.'
              : 'Visits, results, bills and documents appear here as they happen.'
          }
        />
      )}
      {items.length > 0 && (
        <div
          aria-label={label}
          role="feed"
          aria-busy={query.isFetching}
          className={`transition-opacity duration-200 ease-standard ${query.isFetching && !query.isFetchingNextPage ? 'opacity-60' : ''}`}
        >
          {compact ? (
            <ol>
              {items.map((item) => (
                <Row key={`${item.type}:${item.id}`} item={item} compact />
              ))}
            </ol>
          ) : (
            <div className="space-y-6">
              {groupByMonth(items).map(([month, monthItems]) => (
                <section key={month} aria-label={month}>
                  <h3 className="mb-3 text-caption text-muted uppercase">{month}</h3>
                  <ol>
                    {monthItems.map((item) => (
                      <Row key={`${item.type}:${item.id}`} item={item} compact={false} />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
      {query.isError && query.data && (
        <p role="alert" className="text-sm text-danger-700">
          More items could not be loaded.
        </p>
      )}
      {query.hasNextPage && (
        <Button
          variant="secondary"
          size="sm"
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
