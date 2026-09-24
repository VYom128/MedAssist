import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { WEEKDAY_SHORT } from '../../../constants/catalog';
import { addDaysToDate, clinicDate, formatCalendarDate } from '../../../utils/dates';
import { useGetAvailabilityQuery } from '../api';

const DAYS = 7;

/**
 * A week of dates with the number of free slots on each (GET /doctors/:id/availability), plus a
 * date field to jump further ahead. Days without free slots are disabled.
 */
export default function DateAvailabilityPicker({
  doctorId,
  serviceId,
  value,
  onChange,
}: {
  doctorId: string;
  serviceId?: string;
  value: string;
  onChange: (date: string) => void;
}) {
  const today = clinicDate();
  const [from, setFrom] = useState(value && value >= today ? value : today);
  const to = addDaysToDate(from, DAYS - 1);
  const labelId = useId();
  const { data, isFetching, isError } = useGetAvailabilityQuery(
    { doctorId, from, to, ...(serviceId ? { serviceId } : {}) },
    { skip: !doctorId },
  );
  const byDate = new Map(data?.days.map((d) => [d.date, d.freeSlots]));
  const dates = Array.from({ length: DAYS }, (_, i) => addDaysToDate(from, i));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p id={labelId} className="text-sm font-medium text-ink">
          Date <span className="font-normal text-muted">(free times per day)</span>
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous week"
            disabled={from <= today}
            onClick={() => {
              const prev = addDaysToDate(from, -DAYS);
              setFrom(prev < today ? today : prev);
            }}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next week"
            onClick={() => setFrom(addDaysToDate(from, DAYS))}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-busy={isFetching || undefined}
        className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-7"
      >
        {dates.map((date) => {
          const free = byDate.get(date);
          const selected = date === value;
          const weekday = WEEKDAY_SHORT[new Date(`${date}T12:00:00Z`).getUTCDay()];
          const none = free === 0;
          return (
            <button
              key={date}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={none}
              aria-label={`${formatCalendarDate(date)}: ${free === undefined ? 'loading' : `${free} free`}`}
              onClick={() => onChange(date)}
              className={`flex min-h-16 flex-col items-center justify-center rounded-control border px-1 py-2 text-xs transition-colors duration-150 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-55 ${
                selected
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-line-strong bg-surface text-body hover:border-primary-500'
              }`}
            >
              <span className="font-semibold">{weekday}</span>
              <span className="tabular">{date.slice(8)}</span>
              <span className={`tabular mt-0.5 ${none ? 'text-muted' : 'text-success-700'}`}>
                {free === undefined ? '…' : none ? 'Full' : `${free} free`}
              </span>
            </button>
          );
        })}
      </div>
      {isError && (
        <p className="mt-1.5 text-sm text-danger-700" role="alert">
          Could not load free times.
        </p>
      )}
      <Input
        label="Or pick a date"
        type="date"
        min={today}
        className="mt-3 sm:max-w-xs"
        value={value}
        onChange={(e) => {
          if (!e.target.value) return;
          onChange(e.target.value);
          setFrom(e.target.value);
        }}
      />
    </div>
  );
}
