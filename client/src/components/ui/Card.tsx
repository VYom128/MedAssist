import { useId, type ReactNode } from 'react';

/** White surface card on the canvas; optional title row with actions on the right. */
export default function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={`rounded-card border border-line bg-surface shadow-card ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 lg:px-6">
          {title && (
            <h2 id={titleId} className="text-card">
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className="p-5 lg:p-6">{children}</div>
    </section>
  );
}
