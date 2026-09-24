import { CalendarX } from 'lucide-react';
import { useId } from 'react';
import Skeleton from '../../../components/ui/Skeleton';
import { formatClockTime } from '../../../utils/dates';
import type { Slot } from '../api';

/**
 * Free slots as a grid of buttons (a radio group: arrow keys are not needed, each slot is a
 * focusable button with aria-checked). `value` is the chosen slot's startAt.
 */
export default function SlotPicker({
  slots,
  value,
  onChange,
  loading = false,
  error,
  label = 'Time',
}: {
  slots: Slot[] | undefined;
  value: string;
  onChange: (startAt: string) => void;
  loading?: boolean;
  error?: string;
  label?: string;
}) {
  const labelId = useId();
  return (
    <div>
      <p id={labelId} className="text-sm font-medium text-ink">
        {label}
      </p>
      {loading && <Skeleton className="mt-1.5 h-24 w-full" />}
      {!loading && slots && slots.length === 0 && (
        <p className="mt-1.5 flex items-center gap-2 rounded-control border border-dashed border-line-strong px-3 py-4 text-sm text-muted">
          <CalendarX className="h-4 w-4" aria-hidden="true" /> No free times on this day. Try
          another date.
        </p>
      )}
      {!loading && slots && slots.length > 0 && (
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6"
        >
          {slots.map((s) => {
            const selected = s.startAt === value;
            return (
              <button
                key={s.startAt}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(s.startAt)}
                className={`tabular min-h-11 rounded-control border px-2 text-sm font-medium transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 md:min-h-9 ${
                  selected
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-line-strong bg-surface text-body hover:border-primary-500 hover:text-primary-700'
                }`}
              >
                {formatClockTime(s.label)}
              </button>
            );
          })}
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-sm text-danger-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
