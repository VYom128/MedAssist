import { CloudOff, RotateCw, type LucideIcon } from 'lucide-react';
import { Component, type ComponentProps, type ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import Button from '../../../components/ui/Button';
import ChartCard from '../../../components/ui/ChartCard';
import SectionCard from '../../../components/ui/SectionCard';
import Skeleton from '../../../components/ui/Skeleton';
import StatCard from '../../../components/ui/StatCard';
import { CHART_THEME } from '../../../components/ui/chartTheme';
import type { Tone } from '../../../components/ui/statusStyles';
import { getQueryErrorMessage } from '../../../utils/http';
import type { Slice } from '../charts';

/**
 * Dashboard widgets (spec §14, Phase 10). Each widget shows its own skeleton, empty state and
 * error with a retry, and sits in its own error boundary: a widget that cannot render (e.g. a
 * field missing from the response) shows its own error while the rest of the page still works.
 * Content is a render function, so it only runs once the data is there.
 */

/** The bits of an RTK Query result a widget needs. */
export interface WidgetQuery {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch: () => unknown;
}

const RENDER_ERROR = { status: 0, code: 'RENDER', message: 'This widget could not be shown.' };

/** Catches a widget's render error; "Try again" refetches and re-renders. */
class WidgetBoundary extends Component<
  {
    fallback: (error: unknown, retry: () => void) => ReactNode;
    children: ReactNode;
    onRetry: () => unknown;
  },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    // Shown in the widget; nothing is logged (the data may name patients).
  }
  retry = () => {
    this.setState({ failed: false });
    void this.props.onRetry();
  };
  override render() {
    return this.state.failed ? this.props.fallback(RENDER_ERROR, this.retry) : this.props.children;
  }
}

/** Small error block with a retry, for use inside a card. */
export function WidgetError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
      <CloudOff className="h-6 w-6 text-danger-600" aria-hidden="true" />
      <p role="alert" className="text-sm text-muted">
        {getQueryErrorMessage(error)}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        <RotateCw className="h-4 w-4" aria-hidden="true" /> Try again
      </Button>
    </div>
  );
}

type StatProps = Omit<ComponentProps<typeof StatCard>, 'label' | 'icon' | 'tone'>;

/** A StatCard fed by a query: a skeleton while loading, its own error with retry. */
export function StatWidget({
  q,
  label,
  icon,
  tone,
  render,
}: {
  q: WidgetQuery;
  label: string;
  icon: LucideIcon;
  tone?: Tone;
  render: () => StatProps;
}) {
  const retry = () => void q.refetch();
  const frame = (body: ReactNode) => (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <p className="text-sm font-medium text-muted">{label}</p>
      {body}
    </div>
  );
  if (q.isLoading) {
    return frame(
      <div role="status" className="mt-2 space-y-2">
        <span className="sr-only">Loading {label}…</span>
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>,
    );
  }
  const error = (err: unknown, onRetry: () => void) =>
    frame(
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <p role="alert" className="text-sm text-muted">
          {getQueryErrorMessage(err)}
        </p>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Retry
        </Button>
      </div>,
    );
  if (q.isError) return error(q.error, retry);
  return (
    <WidgetBoundary fallback={error} onRetry={q.refetch}>
      <StatReady label={label} icon={icon} tone={tone} render={render} />
    </WidgetBoundary>
  );
}

/** Evaluates `render` inside the boundary. */
function StatReady({
  render,
  ...props
}: {
  label: string;
  icon: LucideIcon;
  tone?: Tone;
  render: () => StatProps;
}) {
  return <StatCard {...props} {...render()} />;
}

/** A SectionCard list fed by a query: skeleton rows, empty text, its own error with retry. */
export function ListWidget({
  q,
  title,
  description,
  icon,
  iconTone,
  actions,
  isEmpty,
  emptyText,
  hideWhenEmpty = false,
  className,
  children,
}: {
  q: WidgetQuery;
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  iconTone?: Tone;
  actions?: ReactNode;
  isEmpty: () => boolean;
  emptyText?: string;
  /** Optional cards (patient home) disappear when there is nothing to show. */
  hideWhenEmpty?: boolean;
  className?: string;
  children: () => ReactNode;
}) {
  const retry = () => void q.refetch();
  const card = (body: ReactNode) => (
    <SectionCard
      title={title}
      description={description}
      icon={icon}
      iconTone={iconTone}
      actions={actions}
      className={className}
    >
      {body}
    </SectionCard>
  );
  if (q.isLoading) {
    return card(
      <div role="status" className="space-y-3">
        <span className="sr-only">Loading {title}…</span>
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>,
    );
  }
  if (q.isError) return card(<WidgetError error={q.error} onRetry={retry} />);
  return (
    <WidgetBoundary
      fallback={(err, onRetry) => card(<WidgetError error={err} onRetry={onRetry} />)}
      onRetry={q.refetch}
    >
      <ListReady card={card} isEmpty={isEmpty} emptyText={emptyText} hideWhenEmpty={hideWhenEmpty}>
        {children}
      </ListReady>
    </WidgetBoundary>
  );
}

/** Evaluates the render functions inside the boundary. */
function ListReady({
  card,
  isEmpty,
  emptyText,
  hideWhenEmpty,
  children,
}: {
  card: (body: ReactNode) => ReactNode;
  isEmpty: () => boolean;
  emptyText?: string;
  hideWhenEmpty: boolean;
  children: () => ReactNode;
}) {
  const empty = isEmpty();
  if (empty && hideWhenEmpty) return null;
  return (
    <>
      {card(
        empty ? (
          <p className="rounded-control border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
            {emptyText}
          </p>
        ) : (
          children()
        ),
      )}
    </>
  );
}

/** A ChartCard fed by a query, with a text summary for screen readers. */
export function ChartWidget({
  q,
  title,
  description,
  actions,
  height,
  className,
  isEmpty,
  emptyText,
  summary,
  children,
}: {
  q: WidgetQuery;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  height?: string;
  className?: string;
  isEmpty: () => boolean;
  emptyText?: string;
  summary: () => string;
  children: () => ReactNode;
}) {
  const common = { title, description, actions, height, className, emptyText };
  if (q.isLoading || q.isError) {
    return (
      <ChartCard
        {...common}
        loading={q.isLoading}
        error={q.isError ? (q.error ?? true) : undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }
  return (
    <WidgetBoundary
      fallback={(err, onRetry) => <ChartCard {...common} error={err} onRetry={onRetry} />}
      onRetry={q.refetch}
    >
      <ChartReady {...common} isEmpty={isEmpty} summary={summary}>
        {children}
      </ChartReady>
    </WidgetBoundary>
  );
}

/** Evaluates the render functions inside the boundary. */
function ChartReady({
  isEmpty,
  summary,
  children,
  ...common
}: Omit<ComponentProps<typeof ChartCard>, 'children' | 'summary' | 'empty'> & {
  isEmpty: () => boolean;
  summary: () => string;
  children: () => ReactNode;
}) {
  const empty = isEmpty();
  return (
    <ChartCard {...common} empty={empty} summary={empty ? undefined : summary()}>
      {empty ? null : children()}
    </ChartCard>
  );
}

/** Legend with numbers next to a status chart, so no slice depends on colour alone. */
export function SliceLegend({ slices, total }: { slices: Slice[]; total?: number }) {
  return (
    <ul className="space-y-1.5 text-sm" aria-label="Legend">
      {slices.map((s) => (
        <li key={s.key} className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="truncate text-body">{s.label}</span>
          </span>
          <span className="tabular font-semibold text-ink">{s.value}</span>
        </li>
      ))}
      {total !== undefined && (
        <li className="flex items-center justify-between gap-3 border-t border-line pt-1.5">
          <span className="text-muted">Total</span>
          <span className="tabular font-semibold text-ink">{total}</span>
        </li>
      )}
    </ul>
  );
}

/**
 * Donut of status counts beside its legend (numbers in the legend, so the chart itself can stay
 * hidden from screen readers). Stacks on phones.
 */
export function StatusDonut({ slices, total }: { slices: Slice[]; total: number }) {
  const shown = slices.filter((s) => s.value > 0);
  return (
    <div className="grid h-full grid-cols-1 items-center gap-4 sm:grid-cols-2">
      <div className="relative h-40 sm:h-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={shown}
              dataKey="value"
              nameKey="label"
              innerRadius="60%"
              outerRadius="90%"
              paddingAngle={shown.length > 1 ? 2 : 0}
              stroke="none"
              isAnimationActive={false}
            >
              {shown.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip {...CHART_THEME.tooltip} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-stat text-ink">{total}</span>
          <span className="text-xs text-muted">total</span>
        </div>
      </div>
      <SliceLegend slices={slices} />
    </div>
  );
}
