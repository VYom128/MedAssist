import { Check } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

/**
 * A rounded on/off filter button (`aria-pressed`), e.g. "Active" / "Inactive" / "All". The
 * selected chip shows a check mark as well as the colour. `count` is an optional number badge.
 */
export default function FilterChip({
  label,
  selected,
  count,
  className = '',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  selected: boolean;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 md:min-h-9 text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 ease-standard motion-safe:active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:cursor-not-allowed disabled:opacity-55 ${
        selected
          ? 'border-primary-600 bg-primary-50 text-primary-700'
          : 'border-line-strong bg-surface text-muted hover:border-line-control hover:text-ink'
      } ${className}`}
      {...rest}
    >
      {selected && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
      {count !== undefined && (
        <span
          className={`tabular rounded-full px-1.5 text-xs font-semibold ${selected ? 'bg-primary-100' : 'bg-neutral-50'}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
