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
  /** On phone cards, show this cell below the details without a label (row actions). */
  cardFooter?: boolean;
}

/**
 * Data table from 768 px; below that each row becomes a card (spec §13.3). Optional
 * `renderExpanded` adds a show/hide details toggle per row; `cardHeader` gives each phone card a
 * title row.
 */
export default function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  renderExpanded,
  cardHeader,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  renderExpanded?: (row: T) => ReactNode;
  /** Title row of the phone card (e.g. avatar + name); columns it repeats can set hideOnCard. */
  cardHeader?: (row: T) => ReactNode;
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
        className="inline-flex h-11 w-11 items-center justify-center rounded-control text-muted transition-colors hover:bg-neutral-50 md:h-9 md:w-9 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  };

  return (
    <>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-card md:block print:block">
        <table className="min-w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-surface-muted">
            <tr>
              {renderExpanded && (
                <th scope="col" className="w-12 px-3 py-3">
                  <span className="sr-only">Details</span>
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className="px-4 py-3 text-left text-caption whitespace-nowrap text-muted uppercase first:pl-5 last:pr-5"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <Fragment key={key}>
                  <tr className="align-middle transition-colors hover:bg-surface-muted">
                    {renderExpanded && <td className="px-3 py-2.5">{toggleButton(key)}</td>}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`px-4 py-3.5 text-body first:pl-5 last:pr-5 ${c.className ?? ''}`}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && expanded.has(key) && (
                    <tr className="bg-surface-muted">
                      <td colSpan={columns.length + 1} className="px-5 py-4">
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

      <ul className="space-y-3 md:hidden print:hidden" aria-label={caption}>
        {rows.map((row) => {
          const key = rowKey(row);
          return (
            <li key={key} className="rounded-card border border-line bg-surface p-4 shadow-card">
              {cardHeader && (
                <div className="mb-3 border-b border-line pb-3">{cardHeader(row)}</div>
              )}
              <dl className="space-y-2.5 text-sm">
                {columns
                  .filter((c) => !c.hideOnCard && !c.cardFooter)
                  .map((c) => (
                    <div key={c.key} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                      <dt className="text-muted">{c.header}</dt>
                      <dd className="min-w-0 text-right break-words text-body">{c.cell(row)}</dd>
                    </div>
                  ))}
              </dl>
              {columns
                .filter((c) => c.cardFooter && !c.hideOnCard)
                .map((c) => (
                  <div key={c.key} className="mt-3 border-t border-line pt-3">
                    {c.cell(row)}
                  </div>
                ))}
              {renderExpanded && (
                <div className="mt-3 flex items-center gap-1 text-sm text-muted">
                  {toggleButton(key)} Details
                </div>
              )}
              {renderExpanded && expanded.has(key) && (
                <div className="mt-2 border-t border-line pt-3">{renderExpanded(row)}</div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
