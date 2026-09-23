import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState, type ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Extra classes for the cell in table mode. */
  className?: string;
  /** Leave out of the phone card view (e.g. duplicate information). */
  hideOnCard?: boolean;
}

/**
 * Data table from 768 px; below that each row becomes a card (spec §13.3). Optional
 * `renderExpanded` adds a show/hide details toggle per row.
 */
export default function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  renderExpanded,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  renderExpanded?: (row: T) => ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleButton = (key: string) => {
    const open = expanded.has(key);
    const Icon = open ? ChevronDown : ChevronRight;
    return (
      <button
        type="button"
        onClick={() => toggle(key)}
        aria-expanded={open}
        aria-label={open ? 'Hide details' : 'Show details'}
        className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  };

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-slate-50">
            <tr>
              {renderExpanded && (
                <th scope="col" className="w-10 px-3 py-2">
                  <span className="sr-only">Details</span>
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <Fragment key={key}>
                  <tr className="align-top">
                    {renderExpanded && <td className="px-3 py-3">{toggleButton(key)}</td>}
                    {columns.map((c) => (
                      <td key={c.key} className={`px-4 py-3 ${c.className ?? ''}`}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && expanded.has(key) && (
                    <tr className="bg-slate-50">
                      <td colSpan={columns.length + 1} className="px-4 py-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <li key={key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <dl className="space-y-2 text-sm">
                {columns
                  .filter((c) => !c.hideOnCard)
                  .map((c) => (
                    <div key={c.key} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                      <dt className="text-slate-500">{c.header}</dt>
                      <dd className="min-w-0 text-right break-words">{c.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
              {renderExpanded && (
                <div className="mt-2 flex items-center gap-1 text-sm text-slate-600">
                  {toggleButton(key)} Details
                </div>
              )}
              {renderExpanded && expanded.has(key) && (
                <div className="mt-2 border-t border-slate-100 pt-2">{renderExpanded(row)}</div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
