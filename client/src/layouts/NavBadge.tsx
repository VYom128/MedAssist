import { usePendingLinksQuery } from '../features/patients/api';
import type { NavBadgeKind } from '../routes/routeConfig';

/** Refresh interval of sidebar counts. */
const POLL_MS = 60_000;

function PendingLinksCount() {
  const { data } = usePendingLinksQuery({ page: 1, limit: 1 }, { pollingInterval: POLL_MS });
  const total = data?.meta.total ?? 0;
  if (total === 0) return null;
  return (
    <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      {total}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

/** A live count next to a sidebar entry. */
export default function NavBadge({ kind }: { kind: NavBadgeKind }) {
  if (kind === 'pendingLinks') return <PendingLinksCount />;
  return null;
}
