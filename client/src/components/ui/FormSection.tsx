import type { ReactNode } from 'react';

/**
 * A titled group of fields inside a form or dialog (lighter than SectionCard): legend, optional
 * one-line description, then the fields. Put a grid (`grid gap-4 sm:grid-cols-2`) inside.
 */
export default function FormSection({
  title,
  description,
  children,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={`min-w-0 space-y-4 ${className}`}>
      <div>
        <legend className="text-caption text-muted uppercase">{title}</legend>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </fieldset>
  );
}
