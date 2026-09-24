import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import Button from '../../../components/ui/Button';
import FilterChip from '../../../components/ui/FilterChip';
import { addDaysToDate, formatCalendarDate } from '../../../utils/dates';
import { mondayOf } from '../calendarRange';

/**
 * Previous / Today / Next, the range shown, and Day/Week (hidden on phones, which get day view
 * only). `children` adds filters on the right (e.g. a doctor select).
 */
export default function CalendarToolbar({
  mode,
  date,
  allowWeek,
  onDate,
  onMode,
  children,
}: {
  mode: 'day' | 'week';
  date: string;
  allowWeek: boolean;
  onDate: (date: string) => void;
  onMode: (mode: 'day' | 'week') => void;
  children?: ReactNode;
}) {
  const step = mode === 'week' ? 7 : 1;
  const from = mode === 'week' ? mondayOf(date) : date;
  const label =
    mode === 'week'
      ? `${formatCalendarDate(from)} – ${formatCalendarDate(addDaysToDate(from, 6))}`
      : formatCalendarDate(date);
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card lg:flex-row lg:items-end lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label={mode === 'week' ? 'Previous week' : 'Previous day'}
          onClick={() => onDate(addDaysToDate(date, -step))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onDate('')}>
          Today
        </Button>
        <Button
          variant="secondary"
          size="sm"
          aria-label={mode === 'week' ? 'Next week' : 'Next day'}
          onClick={() => onDate(addDaysToDate(date, step))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h2 className="tabular text-card" aria-live="polite">
          {label}
        </h2>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {allowWeek && (
          <div className="flex gap-2" role="group" aria-label="Calendar range">
            <FilterChip label="Day" selected={mode === 'day'} onClick={() => onMode('day')} />
            <FilterChip label="Week" selected={mode === 'week'} onClick={() => onMode('week')} />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
