import { CircleCheck, Hourglass, Stethoscope, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import IconChip from '../../../components/ui/IconChip';
import type { Tone } from '../../../components/ui/statusStyles';
import type { Queue, QueueItem } from '../api';
import QueueCard from './QueueCard';

/** What makes a card "changed": its status, priority or token (not its position). */
const signature = (i: QueueItem) => `${i.appointmentId}:${i.status}:${i.priority}:${i.tokenNumber}`;
const all = (q: Queue) => [...q.waiting, ...q.inConsultation, ...q.done];

function Column({
  title,
  icon,
  tone,
  items,
  empty,
  seen,
  actions,
  maxItems,
}: {
  title: string;
  icon: LucideIcon;
  tone: Tone;
  items: QueueItem[];
  empty: string;
  seen: Set<string>;
  actions?: (item: QueueItem) => ReactNode;
  maxItems?: number;
}) {
  const shown = maxItems ? items.slice(0, maxItems) : items;
  return (
    <section aria-label={`${title} (${items.length})`} className="min-w-0">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        <IconChip icon={icon} tone={tone} size="sm" />
        {title}
        <span className="tabular rounded-full bg-neutral-50 px-2 text-xs text-muted">
          {items.length}
        </span>
      </h3>
      {items.length === 0 ? (
        <p className="rounded-control border border-dashed border-line-strong px-3 py-4 text-sm text-muted">
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((item) => (
            // Keyed by the signature: a changed card remounts and plays its entrance once.
            <li key={signature(item)}>
              <QueueCard item={item} highlight={!seen.has(signature(item))}>
                {actions?.(item)}
              </QueueCard>
            </li>
          ))}
          {shown.length < items.length && (
            <li className="text-xs text-muted">and {items.length - shown.length} more</li>
          )}
        </ul>
      )}
    </section>
  );
}

/**
 * A doctor's queue as three columns – Waiting (in queue order) / In consultation / Done – stacked
 * on phones. Cards that changed after the screen loaded (live updates) get a short entrance.
 */
export default function QueueColumns({
  queue,
  waitingActions,
  compact = false,
}: {
  queue: Queue;
  waitingActions?: (item: QueueItem) => ReactNode;
  /** Overview mode: fewer done cards. */
  compact?: boolean;
}) {
  // Cards present when the screen loaded are not highlighted.
  const [seen] = useState(() => new Set(all(queue).map(signature)));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Column
        title="Waiting"
        icon={Hourglass}
        tone="warning"
        items={queue.waiting}
        empty="Nobody is waiting."
        seen={seen}
        actions={waitingActions}
      />
      <Column
        title="In consultation"
        icon={Stethoscope}
        tone="consult"
        items={queue.inConsultation}
        empty="Nobody is with the doctor."
        seen={seen}
      />
      <Column
        title="Done"
        icon={CircleCheck}
        tone="success"
        items={queue.done}
        empty="No completed visits yet."
        seen={seen}
        maxItems={compact ? 3 : undefined}
      />
    </div>
  );
}
