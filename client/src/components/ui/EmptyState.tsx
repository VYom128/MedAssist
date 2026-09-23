import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Shown when a list has no items; offers the next action when there is one. */
export default function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <Icon className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
      <p className="mt-3 font-medium text-slate-700">{title}</p>
      {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
