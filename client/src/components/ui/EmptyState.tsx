import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import IconChip from './IconChip';

/** Shown when a list has no items; offers the next action when there is one. */
export default function EmptyState({
  title,
  description,
  action,
  icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <IconChip icon={icon} size="lg" />
      <p className="mt-4 text-card text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
