import { formatINR } from '../../../utils/money';

interface Row {
  label: string;
  paise: number;
  /** Shown as a deduction ("−₹50.00"). */
  minus?: boolean;
  strong?: boolean;
}

/**
 * The totals block (right-aligned on wide screens). `preview` marks client-side numbers that the
 * server has not confirmed yet.
 */
export default function InvoiceTotals({
  subtotalPaise,
  discountTotalPaise,
  taxTotalPaise,
  totalPaise,
  taxLabel = 'Tax',
  extra = [],
  preview = false,
}: {
  subtotalPaise: number;
  discountTotalPaise: number;
  taxTotalPaise: number;
  totalPaise: number;
  taxLabel?: string;
  extra?: Row[];
  preview?: boolean;
}) {
  const rows: Row[] = [
    { label: 'Subtotal', paise: subtotalPaise },
    { label: 'Discount', paise: discountTotalPaise, minus: true },
    { label: taxLabel, paise: taxTotalPaise },
    { label: 'Total', paise: totalPaise, strong: true },
    ...extra,
  ];
  return (
    <div className="ml-auto w-full max-w-sm">
      {preview && (
        <p className="mb-2 text-xs text-muted" role="note">
          Preview – the saved invoice shows the clinic&apos;s calculation.
        </p>
      )}
      <dl
        className="space-y-1.5 text-sm"
        aria-label={preview ? 'Totals (preview)' : 'Totals'}
        data-testid={preview ? 'totals-preview' : 'totals'}
      >
        {rows.map((r) => (
          <div
            key={r.label}
            className={`flex justify-between gap-4 ${r.strong ? 'border-t border-line pt-2 text-base font-semibold text-ink' : 'text-muted'}`}
          >
            <dt>{r.label}</dt>
            <dd className="tabular text-ink">
              {r.minus && r.paise > 0 ? `−${formatINR(r.paise)}` : formatINR(r.paise)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
