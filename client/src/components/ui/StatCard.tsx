import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import IconChip from './IconChip';
import { TONE_CLASSES, type Tone } from './statusStyles';

export interface StatTrend {
  direction: 'up' | 'down' | 'flat';
  /** Visible text, e.g. "+12% vs last month". */
  label: string;
  /** Whether this change is good news (colours it green) or bad (red). Default neutral. */
  sentiment?: 'positive' | 'negative' | 'neutral';
}

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus };
const SENTIMENT = {
  positive: 'text-success-700',
  negative: 'text-danger-700',
  neutral: 'text-muted',
};

/**
 * One number with its label (dashboards). Only for real API values — never placeholder figures.
 * Optional trend line, status dot (e.g. "needs attention") and link to the underlying list.
 */
export default function StatCard({
  label,
  value,
  icon,
  tone = 'primary',
  hint,
  trend,
  status,
  to,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  hint?: ReactNode;
  trend?: StatTrend;
  /** Small dot + text next to the label, e.g. `{ tone: 'warning', label: 'Overdue' }`. */
  status?: { tone: Tone; label: string };
  to?: string;
}) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  const body = (
    <div className="flex items-start gap-4">
      {icon && <IconChip icon={icon} tone={tone} size="lg" />}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-muted">
          {label}
          {status && (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${TONE_CLASSES[status.tone].dot}`}
              />
              {status.label}
            </span>
          )}
        </p>
        <p className="tabular mt-1 text-stat text-ink">{value}</p>
        {(trend || hint) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
            {trend && TrendIcon && (
              <span
                className={`inline-flex items-center gap-1 font-semibold ${SENTIMENT[trend.sentiment ?? 'neutral']}`}
              >
                <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {trend.label}
              </span>
            )}
            {hint && <span className="text-muted">{hint}</span>}
          </div>
        )}
      </div>
    </div>
  );

  const card = 'block rounded-card border border-line bg-surface p-5 shadow-card';
  return to ? (
    <Link
      to={to}
      className={`${card} transition-[box-shadow,border-color,transform] duration-150 ease-standard hover:border-primary-200 hover:shadow-card-hover focus-visible:outline-2 motion-safe:hover:-translate-y-0.5 focus-visible:outline-offset-2 focus-visible:outline-primary-600`}
    >
      {body}
    </Link>
  ) : (
    <div className={card}>{body}</div>
  );
}
