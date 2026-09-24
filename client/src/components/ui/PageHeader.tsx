import type { ReactNode } from 'react';
import BackLink from './BackLink';

/**
 * Top of every page: optional back link and eyebrow, the page title (the page's only h1), a
 * one-line description and the page's main actions (wrap under the title on phones).
 */
export default function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Small label above the title (e.g. a role or section name). */
  eyebrow?: ReactNode;
  /** Link shown above the title, e.g. `{ to: '/admin/users', label: 'Users' }`. */
  back?: { to: string; label: string };
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && <BackLink to={back.to} label={back.label} />}
        {eyebrow && <p className="mb-1 text-caption text-primary-700 uppercase">{eyebrow}</p>}
        <h1 className="text-page break-words lg:text-[1.75rem] lg:leading-9">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div>}
    </div>
  );
}
