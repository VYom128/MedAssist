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
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: (ids: FieldIds) => ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="mt-1">
        {children({ inputId: id, describedBy, invalid: error ? true : undefined })}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </div>
      ) : null}
    </div>
  );
}
