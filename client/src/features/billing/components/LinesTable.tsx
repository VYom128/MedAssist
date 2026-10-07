import Table, { type Column } from '../../../components/ui/Table';
import { INVOICE_LINE_KIND_LABELS } from '../../../constants/catalog';
import { formatINR, formatPercentFromBps } from '../../../utils/money';
import type { InvoiceLine } from '../api';

/** The lines of a saved invoice, read-only (cards on phones). */
export default function LinesTable({
  lines,
  taxLabel = 'Tax',
}: {
  lines: InvoiceLine[];
  taxLabel?: string;
}) {
  const columns: Column<InvoiceLine>[] = [
    {
      key: 'description',
      header: 'Item',
      cell: (l) => (
        <span>
          <span className="block font-medium text-ink">{l.description}</span>
          <span className="block text-xs text-muted">{INVOICE_LINE_KIND_LABELS[l.kind]}</span>
        </span>
      ),
      hideOnCard: true,
    },
    { key: 'qty', header: 'Qty', cell: (l) => l.quantity, className: 'tabular text-right' },
    {
      key: 'price',
      header: 'Unit price',
      cell: (l) => formatINR(l.unitPricePaise),
      className: 'tabular text-right',
    },
    {
      key: 'discount',
      header: 'Discount',
      cell: (l) => (l.discountPaise ? `−${formatINR(l.discountPaise)}` : '—'),
      className: 'tabular text-right',
    },
    {
      key: 'tax',
      header: taxLabel,
      cell: (l) => `${formatINR(l.taxPaise)} (${formatPercentFromBps(l.taxRateBps)})`,
      className: 'tabular text-right',
    },
    {
      key: 'total',
      header: 'Amount',
      cell: (l) => <span className="font-semibold">{formatINR(l.lineTotalPaise)}</span>,
      className: 'tabular text-right',
    },
  ];
  return (
    <Table
      caption="Invoice lines"
      columns={columns}
      rows={lines}
      rowKey={(l) => l.id}
      cardHeader={(l) => (
        <span>
          <span className="block font-medium text-ink">{l.description}</span>
          <span className="block text-xs text-muted">{INVOICE_LINE_KIND_LABELS[l.kind]}</span>
        </span>
      )}
    />
  );
}
