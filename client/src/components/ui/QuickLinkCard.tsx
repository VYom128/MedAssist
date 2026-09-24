import { ArrowRight, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import IconChip from './IconChip';
import type { Tone } from './statusStyles';

/** A card that links to a page: icon chip, title, one-line description, optional count badge. */
export default function QuickLinkCard({
  to,
  title,
  description,
  icon,
  tone = 'primary',
  badge,
}: {
  to: string;
  title: string;
  description?: string;
  icon: LucideIcon;
  tone?: Tone;
  badge?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="group flex h-full flex-col rounded-card border border-line bg-surface p-5 shadow-card transition-[box-shadow,border-color,transform] duration-150 ease-standard hover:border-primary-200 hover:shadow-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 motion-safe:hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <IconChip icon={icon} tone={tone} />
        {badge}
      </div>
      <h3 className="mt-4 text-card">{title}</h3>
      {description && <p className="mt-1 flex-1 text-sm text-muted">{description}</p>}
      <span
        aria-hidden="true"
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary-700"
      >
        Open
        <ArrowRight className="h-4 w-4 transition-transform duration-200 ease-standard motion-safe:group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
