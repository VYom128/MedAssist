import { useListLabOrdersQuery, type LabOrderListItem } from './api';

/** One shared query for "results to review": the page, the sidebar badge and the critical banner. */
export const REVIEW_PARAMS = { needsReview: true, limit: 100 } as const;
/** Fallback refresh when real-time updates are off. */
const POLL_MS = 60_000;

export function useResultsToReview({ skip = false }: { skip?: boolean } = {}) {
  return useListLabOrdersQuery(REVIEW_PARAMS, { skip, pollingInterval: POLL_MS });
}

/** Unacknowledged critical values first, then released results, then the rest (unverified). */
export function reviewOrder(items: readonly LabOrderListItem[]) {
  const rank = (o: LabOrderListItem) => (o.hasCritical ? 0 : o.status === 'released' ? 1 : 2);
  const time = (o: LabOrderListItem) => new Date(o.releasedAt ?? o.orderedAt ?? 0).getTime();
  return [...items].sort((a, b) => rank(a) - rank(b) || time(b) - time(a));
}
