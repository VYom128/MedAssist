import Alert from '../../../components/ui/Alert';
import { formatDateTime } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import type { CancelledItemBilled } from '../api';

/**
 * Lab tests cancelled after this invoice was issued: the lines stay (issued invoices are locked),
 * so reception refunds them from a payment.
 */
export default function CancelledItemsPanel({
  items,
  canRefund,
}: {
  items: CancelledItemBilled[];
  canRefund: boolean;
}) {
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + i.lineTotalPaise, 0);
  return (
    <Alert tone="warning" title="Cancelled tests were billed">
      <p>These tests were cancelled after the invoice was issued:</p>
      <ul className="mt-2 space-y-1">
        {items.map((i) => (
          <li key={i.itemId} className="flex flex-wrap justify-between gap-x-4">
            <span>
              {i.description}
              <span className="text-xs"> · cancelled {formatDateTime(i.at)}</span>
            </span>
            <span className="tabular font-semibold">{formatINR(i.lineTotalPaise)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2">
        {canRefund
          ? `If the patient has paid for them, refund ${formatINR(total)} from a payment below.`
          : 'The front desk will refund them if they were paid.'}
      </p>
    </Alert>
  );
}
