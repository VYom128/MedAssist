import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_THEME } from '../../../components/ui/chartTheme';
import { compactINR } from '../../dashboards/charts';
import type { ReportRow } from '../api';
import { formatValue, type ChartSeries, type ValueKind } from '../definitions';

/** Axis numbers: short rupees, whole percents, plain numbers. */
function axisValue(v: number, kind: ValueKind): string {
  if (kind === 'money') return compactINR(v);
  if (kind === 'percent') return `${Math.round(v * 100)}%`;
  return String(v);
}

/**
 * The chart of a report (Recharts, design-system colours): a line over time, bars per group, or
 * bars stacked by status. Hidden from screen readers by ChartCard; the table below has the
 * numbers and the legend names every series.
 */
export default function ReportChart({
  kind,
  series,
  valueKind,
  rows,
}: {
  kind: 'line' | 'bar' | 'stacked';
  series: ChartSeries[];
  valueKind: ValueKind;
  rows: (ReportRow & { name: string })[];
}) {
  const tooltip = (
    <Tooltip
      {...CHART_THEME.tooltip}
      formatter={(v, name) => [formatValue(Number(v), valueKind), String(name)]}
    />
  );
  const axes = (
    <>
      <CartesianGrid {...CHART_THEME.grid} />
      <XAxis
        dataKey="name"
        {...CHART_THEME.axis}
        minTickGap={12}
        tick={{ ...CHART_THEME.axis.tick, fontSize: 11 }}
      />
      <YAxis
        {...CHART_THEME.axis}
        width={valueKind === 'money' ? 56 : 40}
        allowDecimals={valueKind !== 'number'}
        tickFormatter={(v: number) => axisValue(v, valueKind)}
      />
      {tooltip}
      {series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />}
    </>
  );
  return (
    <ResponsiveContainer width="100%" height="100%">
      {kind === 'line' ? (
        <LineChart data={rows}>
          {axes}
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              {...CHART_THEME.line}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={rows}>
          {axes}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.color}
              stackId={kind === 'stacked' ? 'stack' : undefined}
              radius={kind === 'stacked' ? undefined : CHART_THEME.bar.radius}
              maxBarSize={CHART_THEME.bar.maxBarSize}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
