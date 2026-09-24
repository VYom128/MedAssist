import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export interface FieldIds {
  inputId: string;
  describedBy: string | undefined;
  invalid: true | undefined;
}

/**
 * Label + control + hint/error, with the ids wired for screen readers. `children` receives the
 * ids to put on the control (`id`, `aria-describedby`, `aria-invalid`).
 */
export default function FormField({
  id,
  label,
  hint,
  error,
  className = '',
  reserveMessage = false,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  /** Keep a line free for the error so the form does not shift when one appears. */
  reserveMessage?: boolean;
  children: (ids: FieldIds) => ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="mt-1.5">
        {children({ inputId: id, describedBy, invalid: error ? true : undefined })}
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 flex min-h-5 items-start gap-1.5 text-sm text-danger-700 motion-safe:animate-fade-in"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="mt-1.5 text-xs text-muted">
          {hint}
        </div>
      ) : reserveMessage ? (
        <div aria-hidden="true" className="mt-1.5 h-5" />
      ) : null}
    </div>
  );
}
