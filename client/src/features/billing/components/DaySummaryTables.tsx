import { PAYMENT_METHOD_LABELS } from '../../../constants/catalog';
import { formatINR } from '../../../utils/money';
import type { DaySummary } from '../api';

const money = (paise: number) => formatINR(paise);
const refund = (paise: number) => (paise ? `−${formatINR(paise)}` : formatINR(0));

/**
 * The day close tables – totals per method (payments, refunds, net) and every payment/refund in
 * time order. Plain tables (they print as they look; on phones they scroll inside their box).
 */
export default function DaySummaryTables({ summary }: { summary: DaySummary }) {
  const th = 'px-3 py-2 text-left text-caption whitespace-nowrap text-muted uppercase';
  const td = 'px-3 py-2';
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto rounded-card border border-line">
        <table className="min-w-full text-sm" aria-label="Totals by method">
          <thead className="border-b border-line bg-surface-muted">
            <tr>
              <th scope="col" className={th}>
                Method
              </th>
              <th scope="col" className={`${th} text-right`}>
                Payments
              </th>
              <th scope="col" className={`${th} text-right`}>
                Refunds
              </th>
              <th scope="col" className={`${th} text-right`}>
                Net
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {summary.byMethod.map((m) => (
              <tr key={m.method}>
                <th scope="row" className={`${td} text-left font-medium text-ink`}>
                  {PAYMENT_METHOD_LABELS[m.method] ?? m.method}
                </th>
                <td className={`${td} tabular text-right`}>
                  {money(m.collectedPaise)}
                  <span className="block text-xs text-muted">{m.paymentCount} payments</span>
                </td>
                <td className={`${td} tabular text-right`}>
                  {refund(m.refundedPaise)}
                  <span className="block text-xs text-muted">{m.refundCount} refunds</span>
                </td>
                <td className={`${td} tabular text-right font-semibold`}>{money(m.netPaise)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line-strong">
            <tr>
              <th scope="row" className={`${td} text-left font-semibold text-ink`}>
                Total
              </th>
              <td className={`${td} tabular text-right font-semibold`} data-testid="day-collected">
                {money(summary.totals.collectedPaise)}
              </td>
              <td className={`${td} tabular text-right font-semibold`} data-testid="day-refunded">
                {refund(summary.totals.refundedPaise)}
              </td>
              <td
                className={`${td} tabular text-right text-base font-semibold`}
                data-testid="day-net"
              >
                {money(summary.totals.netPaise)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {summary.payments.length > 0 && (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="min-w-full text-sm" aria-label="Payments and refunds">
            <thead className="border-b border-line bg-surface-muted">
              <tr>
                {['Time', 'Receipt', 'Invoice', 'Patient', 'Method', 'Received by'].map((h) => (
                  <th key={h} scope="col" className={th}>
                    {h}
                  </th>
                ))}
                <th scope="col" className={`${th} text-right`}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.payments.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} tabular`}>{p.time}</td>
                  <td className={`${td} tabular whitespace-nowrap`}>
                    {p.paymentNumber}
                    {p.kind === 'refund' && <span className="text-warning-700"> (refund)</span>}
                  </td>
                  <td className={`${td} tabular whitespace-nowrap`}>{p.invoiceNumber ?? '—'}</td>
                  <td className={td}>{p.patientName ?? '—'}</td>
                  <td className={td}>{PAYMENT_METHOD_LABELS[p.method] ?? p.method}</td>
                  <td className={td}>{p.receivedByName ?? '—'}</td>
                  <td
                    className={`${td} tabular text-right font-medium ${p.amountPaise < 0 ? 'text-warning-700' : ''}`}
                  >
                    {p.amountPaise < 0 ? refund(-p.amountPaise) : money(p.amountPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
