import { BadgeCheck, Clock, FlaskConical, ListChecks, Siren, TestTubeDiagonal } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_THEME } from '../../../components/ui/chartTheme';
import { linkClass } from '../../../components/ui/linkClass';
import { LAB_OPEN_STATUSES, useGetLabDashboardQuery, type LabDashboard as Data } from '../api';
import { statusColor, statusLabel, type Slice } from '../charts';
import DashboardHeader from '../components/DashboardHeader';
import { ChartWidget, SliceLegend, StatWidget } from '../components/widgets';

const slices = (d: Data): Slice[] =>
  LAB_OPEN_STATUSES.map((s) => ({
    key: s,
    label: statusLabel('labOrder', s),
    value: d.countsByStatus[s] ?? 0,
    color: statusColor('labOrder', s),
  }));

/**
 * Lab dashboard (spec §14): open orders by status, urgent and overdue ones, results waiting for a
 * second technician's verification, samples collected and reports released today.
 */
export default function LabDashboard() {
  const q = useGetLabDashboardQuery();
  const d = q.data;
  return (
    <section className="space-y-6">
      <DashboardHeader />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <StatWidget
            q={q}
            label="Open orders"
            icon={ListChecks}
            render={() => ({ value: d!.openTotal, to: '/lab/worklist' })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Urgent pending"
            icon={Siren}
            tone="danger"
            render={() => ({ value: d!.urgentPending, to: '/lab/worklist' })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Over turnaround target"
            icon={Clock}
            tone="warning"
            render={() => ({
              value: d!.overdueTat,
              ...(d!.overdueTat > 0
                ? { status: { tone: 'warning' as const, label: 'Overdue' } }
                : {}),
              to: '/lab/reports',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Waiting for your verification"
            icon={BadgeCheck}
            tone="consult"
            render={() => ({
              value: d!.pendingVerificationByOthers,
              hint: 'Entered by another technician',
              to: '/lab/worklist',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Samples collected today"
            icon={TestTubeDiagonal}
            tone="info"
            render={() => ({ value: d!.collectedToday })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Reports released today"
            icon={FlaskConical}
            tone="success"
            render={() => ({ value: d!.releasedToday })}
          />
        </li>
      </ul>

      <ChartWidget
        q={q}
        title="Open orders by status"
        height="h-auto"
        actions={
          <Link to="/lab/worklist" className={`text-sm ${linkClass}`}>
            Worklist
          </Link>
        }
        isEmpty={() => d!.openTotal === 0}
        emptyText="No open lab orders."
        summary={() =>
          slices(d!)
            .map((s) => `${s.label} ${s.value}`)
            .join(', ')
        }
      >
        {() => (
          <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={slices(d!)}>
                  <CartesianGrid {...CHART_THEME.grid} />
                  <XAxis
                    dataKey="label"
                    {...CHART_THEME.axis}
                    interval={0}
                    tick={{ ...CHART_THEME.axis.tick, fontSize: 11 }}
                  />
                  <YAxis {...CHART_THEME.axis} width={32} allowDecimals={false} />
                  <Tooltip {...CHART_THEME.tooltip} />
                  <Bar
                    dataKey="value"
                    name="Orders"
                    radius={CHART_THEME.bar.radius}
                    maxBarSize={CHART_THEME.bar.maxBarSize}
                    isAnimationActive={false}
                  >
                    {slices(d!).map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <SliceLegend slices={slices(d!)} total={d!.openTotal} />
          </div>
        )}
      </ChartWidget>
    </section>
  );
}
