import { useResultsToReview } from '../features/labs/review';
import { useListFollowupsQuery } from '../features/followups/api';
import { usePendingLinksQuery } from '../features/patients/api';
import type { NavBadgeKind } from '../routes/routeConfig';

/** Refresh interval of sidebar counts. */
const POLL_MS = 60_000;

function PendingLinksCount({ className }: { className: string }) {
  const { data } = usePendingLinksQuery({ page: 1, limit: 1 }, { pollingInterval: POLL_MS });
  const total = data?.meta.total ?? 0;
  if (total === 0) return null;
  return (
    <span
      className={`tabular ml-auto rounded-full bg-warning-50 px-2 py-0.5 text-xs font-semibold text-warning-700 ring-1 ring-warning-100 ring-inset ${className}`}
    >
      {total}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

/** The doctor's results to review (red when one holds a critical value). */
function LabResultsCount({ className }: { className: string }) {
  const { data } = useResultsToReview();
  const total = data?.meta.total ?? 0;
  if (total === 0) return null;
  const critical = data?.items.some((o) => o.hasCritical);
  const tone = critical
    ? 'bg-danger-50 text-danger-700 ring-danger-100'
    : 'bg-warning-50 text-warning-700 ring-warning-100';
  return (
    <span
      className={`tabular ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tone} ${className}`}
    >
      {total}
      <span className="sr-only"> to review{critical ? ', including a critical value' : ''}</span>
    </span>
  );
}

/** Open follow-up requests (reception: all; doctors: assigned to them – the server filters). */
function FollowupsCount({ className }: { className: string }) {
  const { data } = useListFollowupsQuery(
    { status: 'open', limit: 1 },
    { pollingInterval: POLL_MS },
  );
  const total = data?.meta.total ?? 0;
  if (total === 0) return null;
  return (
    <span
      className={`tabular ml-auto rounded-full bg-info-50 px-2 py-0.5 text-xs font-semibold text-info-700 ring-1 ring-info-100 ring-inset ${className}`}
    >
      {total}
      <span className="sr-only"> open</span>
    </span>
  );
}

/**
 * A live count next to a sidebar entry. `className` repositions it (e.g. as a bubble on the
 * icon in the icon-only sidebar).
 */
export default function NavBadge({
  kind,
  className = '',
}: {
  kind: NavBadgeKind;
  className?: string;
}) {
  if (kind === 'pendingLinks') return <PendingLinksCount className={className} />;
  if (kind === 'labResults') return <LabResultsCount className={className} />;
  if (kind === 'followups') return <FollowupsCount className={className} />;
  return null;
}
