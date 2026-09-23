import { useId, type ReactNode } from 'react';

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
      className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-6">
          {title && (
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className="p-4 sm:p-6">{children}</div>
    </section>
  );
}
