import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import IconChip from './IconChip';
import type { Tone } from './statusStyles';

/**
 * A titled block of a page or form: title, one-line description, optional icon and actions, the
 * content, and an optional footer (e.g. the save area).
 */
export default function SectionCard({
  title,
  description,
  icon,
  iconTone = 'primary',
  actions,
  footer,
  children,
  className = '',
  bodyClassName = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  iconTone?: Tone;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-card border border-line bg-surface shadow-card ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 lg:px-6 lg:pt-6">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <IconChip icon={icon} tone={iconTone} size="sm" />}
          <div className="min-w-0">
            <h2 id={titleId} className="text-card">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className={`p-5 lg:p-6 ${bodyClassName}`}>{children}</div>
      {footer && (
        <footer className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-end lg:px-6">
          {footer}
        </footer>
      )}
    </section>
  );
}
