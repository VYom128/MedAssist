import type { ReactNode } from 'react';
import Button from './Button';

/** A row of list filters (stacked on phones) with an optional "Clear filters" button. */
export default function FilterBar({
  children,
  onClear,
  label = 'Filters',
}: {
  children: ReactNode;
  onClear?: () => void;
  label?: string;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end [&>*]:sm:min-w-[12rem] [&>*]:sm:flex-1"
    >
      {children}
      {onClear && (
        <div className="sm:!min-w-0 sm:!flex-none">
          <Button variant="ghost" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
