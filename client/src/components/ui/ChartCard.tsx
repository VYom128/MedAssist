import { CloudOff, RotateCw } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { getQueryErrorMessage } from '../../utils/http';
import Button from './Button';
import Skeleton from './Skeleton';

/** Heights of the placeholder bars shown while a chart loads (decorative). */
const BAR_HEIGHTS = ['h-[45%]', 'h-[70%]', 'h-[55%]', 'h-[90%]', 'h-[65%]', 'h-[40%]'];

/**
 * Frame for a dashboard chart or report widget (Phase 10): title, description, actions (e.g. a
 * range select), and loading / error / empty states around the chart. Charts are drawn by the
 * caller (with the colours in chartTheme.ts); `summary` is a text alternative for screen readers
 * and should state the key figures, since the chart itself is hidden from them.
 */
export default function ChartCard({
  title,
  description,
  actions,
  summary,
  loading = false,
  error,
  onRetry,
  empty = false,
  emptyText = 'No data for this period.',
  height = 'h-64',
  children,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  summary?: string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: boolean;
  emptyText?: string;
  /** Height of the chart area (Tailwind class). */
  height?: string;
  children?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const state = loading ? 'loading' : error ? 'error' : empty ? 'empty' : 'ready';
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={loading || undefined}
      className={`flex flex-col rounded-card border border-line bg-surface p-5 shadow-card lg:p-6 ${className}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-card">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <div className={`mt-5 ${height}`}>
        {state === 'loading' && (
          <div role="status" className="flex h-full items-end gap-3">
            <span className="sr-only">Loading {title}…</span>
            {BAR_HEIGHTS.map((h, i) => (
              <Skeleton key={i} className={`flex-1 ${h}`} rounded="rounded-t-lg" />
            ))}
          </div>
        )}
        {state === 'error' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <CloudOff className="h-6 w-6 text-danger-600" aria-hidden="true" />
            <p role="alert" className="text-sm text-muted">
              {getQueryErrorMessage(error)}
            </p>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RotateCw className="h-4 w-4" aria-hidden="true" /> Try again
              </Button>
            )}
          </div>
        )}
        {state === 'empty' && (
          <div className="flex h-full items-center justify-center rounded-control border border-dashed border-line-strong text-sm text-muted">
            {emptyText}
          </div>
        )}
        {state === 'ready' && (
          <>
            {summary && <p className="sr-only">{summary}</p>}
            <div aria-hidden={summary ? true : undefined} className="h-full">
              {children}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
