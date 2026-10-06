import Badge from '../../../components/ui/Badge';
import StatusPill from '../../../components/ui/StatusPill';
import { formatDateTime } from '../../../utils/dates';
import type { LabOrder } from '../api';
import ResultsTable from './ResultsTable';

/**
 * The results of an order for a doctor: per test its results (marked "Unverified" until the lab
 * verifies them), remarks, corrections and pending revisions; tests without results say so.
 */
export default function LabOrderResults({ order }: { order: LabOrder }) {
  return (
    <div className="space-y-4">
      {order.items.map((item) => (
        <section key={item.id} aria-label={item.name} className="space-y-2">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {item.name} <span className="font-normal text-muted">({item.code})</span>
            {item.status === 'cancelled' && (
              <StatusPill domain="labItem" status="cancelled" size="sm" />
            )}
            {item.unverified && <Badge tone="warning">Unverified</Badge>}
            {item.correctedAt && (
              <Badge tone="info">Corrected {formatDateTime(item.correctedAt)}</Badge>
            )}
            {item.revisionPending && <Badge tone="warning">Correction pending</Badge>}
          </h3>
          {item.status === 'cancelled' ? (
            <p className="text-sm text-muted">
              Not performed{item.cancellation?.reason ? `: ${item.cancellation.reason}` : ''}.
            </p>
          ) : item.resultsAvailable === false ? (
            <p className="text-sm text-muted">Results are not available yet.</p>
          ) : (
            <>
              <ResultsTable results={item.results} caption={`${item.name} results`} />
              {item.remarks && <p className="text-sm text-muted">Remarks: {item.remarks}</p>}
            </>
          )}
        </section>
      ))}
    </div>
  );
}
