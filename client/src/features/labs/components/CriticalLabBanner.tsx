import { Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useResultsToReview } from '../review';

/**
 * The doctor's persistent alert for critical lab values (spec §8.7, §11): shown on every page
 * while one of their orders has an unacknowledged critical value – on load, and as soon as a
 * `lab.critical` event refreshes the list. It goes away only when the order is acknowledged.
 */
export default function CriticalLabBanner() {
  const { data } = useResultsToReview();
  const critical = (data?.items ?? []).filter((o) => o.hasCritical);
  if (critical.length === 0) return null;
  const first = critical[0]!;
  return (
    <div
      role="alert"
      aria-label="Critical lab result"
      className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-danger-100 bg-danger-50 px-4 py-3 text-danger-700"
    >
      <Siren className="h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Critical lab result</span> for {first.patient.fullName} (
        {first.orderNumber}) needs your review.
        {critical.length > 1 ? ` ${critical.length - 1} more waiting.` : ''}
      </p>
      <div className="flex flex-wrap gap-3 text-sm font-semibold">
        <Link
          to={`/doctor/lab-orders/${first.id}`}
          className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-danger-600"
        >
          Review now
        </Link>
        {critical.length > 1 && (
          <Link to="/doctor/lab-results" className="underline underline-offset-2">
            All results to review
          </Link>
        )}
      </div>
    </div>
  );
}
