import type { ReactNode } from 'react';

const COLUMNS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' };

/** Label / value pairs for detail pages. Items with an empty value show an em dash. */
export default function DescriptionList({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; wide?: boolean }[];
  columns?: keyof typeof COLUMNS;
}) {
  return (
    <dl className={`grid gap-x-6 gap-y-4 text-sm ${COLUMNS[columns]}`}>
      {items.map(({ label, value, wide }) => (
        <div key={label} className={`min-w-0 ${wide ? 'sm:col-span-full' : ''}`}>
          <dt className="text-muted">{label}</dt>
          <dd className="mt-0.5 font-medium break-words text-ink">
            {value === null || value === undefined || value === '' ? '—' : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
