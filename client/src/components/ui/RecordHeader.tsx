import type { ReactNode } from 'react';
import Avatar from './Avatar';

/**
 * Header card of a record page (patient, doctor, user; DESIGN_SYSTEM §6): large avatar, the name
 * as the page's h1, a muted meta line, status pills, the page's actions (right from `lg`, under
 * the name on smaller screens) and optional extra content below (e.g. allergies).
 */
export default function RecordHeader({
  name,
  title,
  meta,
  pills,
  actions,
  children,
}: {
  /** Used for the avatar initials and tint. */
  name: string;
  /** The h1 text; defaults to `name`. */
  title?: ReactNode;
  meta?: ReactNode;
  pills?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 rounded-card border border-line bg-surface p-5 shadow-card lg:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar name={name} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h1 className="text-page break-words">{title ?? name}</h1>
              {meta && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  {meta}
                </div>
              )}
            </div>
            {actions && <div className="flex flex-wrap gap-2 lg:shrink-0">{actions}</div>}
          </div>
          {pills && <div className="mt-3 flex flex-wrap items-center gap-2">{pills}</div>}
        </div>
      </div>
      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}
