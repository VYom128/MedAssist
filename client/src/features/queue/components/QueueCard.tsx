import type { ReactNode } from 'react';
import Code from '../../../components/ui/Code';
import StatusPill from '../../../components/ui/StatusPill';
import { formatTime } from '../../../utils/dates';
import PriorityPill from '../../appointments/components/PriorityPill';
import type { QueueItem } from '../api';

const minutes = (m: number | null) =>
  m === null ? '—' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;

/**
 * One patient in a doctor's queue: the token (large), short name, MRN, priority, scheduled time
 * (walk-ins: "Walk-in") and waiting time. `highlight` plays a short entrance when the card
 * changed since the screen loaded (motion-safe only).
 */
export default function QueueCard({
  item,
  highlight = false,
  children,
}: {
  item: QueueItem;
  highlight?: boolean;
  /** Actions (buttons) under the card. */
  children?: ReactNode;
}) {
  const waiting = item.status === 'checked_in';
  return (
    <article
      aria-label={`Token ${item.tokenNumber ?? '–'}, ${item.patient.shortName}`}
      className={`rounded-control border border-line bg-surface p-3 shadow-card ${
        highlight ? 'motion-safe:animate-fade-up' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className="tabular flex h-12 min-w-12 shrink-0 items-center justify-center rounded-control bg-primary-50 px-2 text-stat text-primary-700"
          aria-hidden="true"
        >
          {item.tokenNumber ?? '–'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold text-ink">{item.patient.shortName}</p>
            <PriorityPill priority={item.priority} size="sm" />
            {item.status !== 'checked_in' && (
              <StatusPill domain="appointment" status={item.status} size="sm" />
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <Code>{item.patient.mrn}</Code>
            <span className="tabular">
              {item.type === 'walk_in' ? 'Walk-in' : `Booked ${formatTime(item.scheduledAt)}`}
            </span>
          </p>
          <p className="tabular mt-1 text-xs text-body">
            {waiting ? (
              <>
                Waiting {minutes(item.waitMinutes)}
                {item.estimatedWaitMinutes !== null && (
                  <span className="text-muted">
                    {' '}
                    · about {minutes(item.estimatedWaitMinutes)} to go
                  </span>
                )}
              </>
            ) : item.status === 'in_consultation' ? (
              <>Since {formatTime(item.startedAt)}</>
            ) : (
              <>Done {formatTime(item.completedAt)}</>
            )}
          </p>
        </div>
      </div>
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </article>
  );
}
