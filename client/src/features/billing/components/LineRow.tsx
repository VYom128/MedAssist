import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import MoneyInput from '../../../components/ui/MoneyInput';
import { BILLING_RULES, INVOICE_LINE_KIND_LABELS } from '../../../constants/catalog';
import { formatINR, formatPercentFromBps } from '../../../utils/money';
import {
  priceLocked,
  quantityLocked,
  rowPreview,
  type EditRow,
  type RowErrors,
} from '../useInvoiceDraft';

/**
 * One editable line of a draft invoice, as a card (stacked on phones, one row of fields from
 * `lg`). Visit lines (from the appointment or a lab order) only take a discount; catalogue lines
 * keep their price; 'other' lines are free.
 */
export default function LineRow({
  row,
  index,
  count,
  errors,
  taxLabel,
  onChange,
  onMove,
  onRemove,
}: {
  row: EditRow;
  index: number;
  count: number;
  errors: RowErrors;
  taxLabel: string;
  onChange: (patch: Partial<EditRow>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const amounts = rowPreview(row);
  const n = index + 1;
  const visit = row.origin === 'visit';
  return (
    <li
      className="rounded-card border border-line bg-surface p-4 shadow-card"
      aria-label={`Line ${n}: ${row.description || 'new line'}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="tabular text-muted">{n}.</span>
          <Badge tone="neutral">{INVOICE_LINE_KIND_LABELS[row.kind]}</Badge>
          {visit && <Badge tone="info">From the visit</Badge>}
          {!row.id && <Badge tone="warning">Not saved yet</Badge>}
        </p>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move line ${n} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Move line ${n} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove line ${n}`}
            title={
              visit ? 'From the visit – cancel the lab test instead, or give a discount' : undefined
            }
            disabled={visit}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-4">
          {row.kind === 'other' && !visit ? (
            <Input
              label="Description"
              value={row.description}
              maxLength={BILLING_RULES.descriptionMax}
              error={errors.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          ) : (
            <div className="text-sm">
              <p className="text-muted">Description</p>
              <p className="mt-1.5 font-medium text-ink">{row.description}</p>
            </div>
          )}
        </div>
        <Input
          label="Qty"
          type="number"
          inputMode="numeric"
          min={1}
          max={BILLING_RULES.maxQuantity}
          step={1}
          className="lg:col-span-1"
          disabled={quantityLocked(row)}
          value={row.quantity ?? ''}
          error={errors.quantity}
          onChange={(e) =>
            onChange({ quantity: e.target.value === '' ? null : Number(e.target.value) })
          }
        />
        <MoneyInput
          label="Unit price"
          className="lg:col-span-2"
          value={row.unitPricePaise}
          disabled={priceLocked(row)}
          error={errors.unitPricePaise}
          onChange={(paise) => onChange({ unitPricePaise: paise })}
        />
        <div className="lg:col-span-3">
          <div className="flex items-end gap-2">
            {row.discountMode === 'amount' ? (
              <MoneyInput
                label="Discount"
                className="flex-1"
                value={row.discountPaise}
                error={errors.discount}
                onChange={(paise) => onChange({ discountPaise: paise })}
              />
            ) : (
              <Input
                label="Discount %"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                className="flex-1"
                value={row.discountPercent}
                error={errors.discount}
                onChange={(e) => onChange({ discountPercent: e.target.value })}
              />
            )}
            <div
              role="group"
              aria-label={`Discount in rupees or percent for line ${n}`}
              className={`flex shrink-0 overflow-hidden rounded-control border border-line-strong ${errors.discount ? 'mb-6' : ''}`}
            >
              {(['amount', 'percent'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={row.discountMode === mode}
                  onClick={() =>
                    onChange(
                      mode === 'amount'
                        ? { discountMode: 'amount', discountPaise: rowPreviewDiscount(row) }
                        : { discountMode: 'percent', discountPercent: '' },
                    )
                  }
                  className={`min-h-11 px-3 text-sm font-semibold md:min-h-10 focus-visible:outline-2 focus-visible:outline-primary-600 ${
                    row.discountMode === mode
                      ? 'bg-primary-50 text-primary-700'
                      : 'bg-surface text-muted'
                  }`}
                >
                  {mode === 'amount' ? '₹' : '%'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-end justify-between gap-3 text-sm sm:col-span-2 lg:col-span-2 lg:flex-col lg:items-end lg:justify-end">
          <p className="text-muted">
            {taxLabel} {formatPercentFromBps(row.taxRateBps)}
            {amounts ? <span className="tabular"> · {formatINR(amounts.taxPaise)}</span> : null}
          </p>
          <p className="tabular text-base font-semibold text-ink" aria-label={`Line ${n} amount`}>
            {amounts ? formatINR(amounts.lineTotalPaise) : '—'}
          </p>
        </div>
      </div>
    </li>
  );
}

/** When switching % → ₹, keep the discount the percentage gave. */
function rowPreviewDiscount(row: EditRow): number | null {
  if (row.discountMode === 'amount') return row.discountPaise;
  const a = rowPreview(row);
  if (!a || row.quantity === null || row.unitPricePaise === null) return 0;
  return row.quantity * row.unitPricePaise - (a.lineTotalPaise - a.taxPaise);
}
