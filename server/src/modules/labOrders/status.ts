import type { LabItemStatus, LabOrderStatus } from '../../config/constants.js';

/**
 * Order status derived from its items (spec §5.4): an order whose items are all cancelled is
 * cancelled; an order in processing moves to result_entered once every non-cancelled item has
 * results. Otherwise the status stays as it is. Pure – the service applies the change with
 * assertTransition and a conditional update.
 */
export function derivedOrderStatus(order: {
  status: LabOrderStatus | string;
  items: readonly { status: LabItemStatus | string }[];
}): LabOrderStatus {
  const status = order.status as LabOrderStatus;
  if (status === 'draft' || status === 'cancelled') return status;
  const open = order.items.filter((i) => i.status !== 'cancelled');
  if (open.length === 0) return 'cancelled';
  if (
    status === 'processing' &&
    open.every((i) => i.status === 'result_entered' || i.status === 'verified')
  ) {
    return 'result_entered';
  }
  return status;
}
