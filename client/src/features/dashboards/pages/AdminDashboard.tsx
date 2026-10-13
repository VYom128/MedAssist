import {
  Bot,
  CalendarClock,
  FlaskConical,
  HandCoins,
  IndianRupee,
  ShieldAlert,
  UserPlus,
  UserX,
  Wallet,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CHART_COLORS, CHART_THEME } from '../../../components/ui/chartTheme';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDateTime, formatInClinic } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { useGetAdminDashboardQuery } from '../api';
import {
  appointmentSlices,
  changeVs,
  compactINR,
  formatHours,
  formatRate,
  slicesSummary,
} from '../charts';
import DashboardHeader from '../components/DashboardHeader';
import { ChartWidget, ListWidget, StatusDonut, StatWidget } from '../components/widgets';

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'access.denied': 'Access denied',
};

/** "2026-10-05" → "5 Oct" for chart axes (a calendar date, no timezone shift). */
const shortDay = (d: string) => formatInClinic(`${d}T12:00:00Z`, 'd MMM', 'UTC');

/**
 * Admin dashboard (spec §14): today's appointments by status, money collected (today, this month
 * vs the same days last month), outstanding, new patients, 30-day no-show rate, lab turnaround,
 * AI use, the 30-day revenue trend, doctor utilisation and the latest denied-access alerts. One
 * call (/dashboard/admin); every widget handles its own states.
 */
export default function AdminDashboard() {
  const q = useGetAdminDashboardQuery();
  const d = q.data;

  return (
    <section className="space-y-6">
      <DashboardHeader />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <li>
          <StatWidget
            q={q}
            label="Appointments today"
            icon={CalendarClock}
            render={() => ({
              value: d!.appointmentsToday.total,
              hint: `${d!.appointmentsToday.completed} completed · ${d!.appointmentsToday.checked_in} waiting`,
              to: '/admin/appointments',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Collected today"
            icon={IndianRupee}
            tone="success"
            render={() => ({
              value: formatINR(d!.revenue.todayPaise),
              hint: 'Payments minus refunds',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Collected this month"
            icon={Wallet}
            tone="success"
            render={() => ({
              value: formatINR(d!.revenue.thisMonthPaise),
              trend: changeVs(
                d!.revenue.thisMonthPaise,
                d!.revenue.lastMonthToDatePaise,
                'last month',
              ),
              hint: `Last month: ${formatINR(d!.revenue.lastMonthPaise)}`,
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Outstanding"
            icon={HandCoins}
            tone="warning"
            render={() => ({
              value: formatINR(d!.revenue.outstandingPaise),
              hint: `${d!.revenue.outstandingInvoices} unpaid invoice${d!.revenue.outstandingInvoices === 1 ? '' : 's'}`,
              to: '/admin/invoices',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="New patients this month"
            icon={UserPlus}
            tone="info"
            render={() => ({ value: d!.newPatientsThisMonth, to: '/admin/patients' })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="No-show rate (30 days)"
            icon={UserX}
            tone="danger"
            render={() => ({
              value: formatRate(d!.noShowRate30d.rate),
              hint: `${d!.noShowRate30d.noShow} of ${d!.noShowRate30d.noShow + d!.noShowRate30d.completed} visits`,
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Lab turnaround (median, 30 days)"
            icon={FlaskConical}
            tone="consult"
            render={() => ({
              value: formatHours(d!.labTurnaround.medianHours),
              hint: `90th percentile ${formatHours(d!.labTurnaround.p90Hours)} · ${d!.labTurnaround.overdue} over target`,
              ...(d!.labTurnaround.overdue > 0
                ? { status: { tone: 'warning' as const, label: 'Over target' } }
                : {}),
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="AI calls today"
            icon={Bot}
            tone="neutral"
            render={() => ({
              value: `${d!.ai.today.calls} / ${d!.ai.today.limit}`,
              hint: `${d!.ai.calls} in 30 days · ${d!.ai.failed} failed`,
              to: '/admin/ai-monitor',
            })}
          />
        </li>
      </ul>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <ChartWidget
          q={q}
          className="lg:col-span-2"
          title="Revenue, last 30 days"
          description="Net collected per day (payments minus refunds)"
          isEmpty={() => d!.revenueTrend.every((p) => p.netPaise === 0)}
          emptyText="No payments in the last 30 days."
          summary={() => {
            const total = d!.revenueTrend.reduce((s, p) => s + p.netPaise, 0);
            const best = d!.revenueTrend.reduce((a, b) => (b.netPaise > a.netPaise ? b : a));
            return `Total ${formatINR(total)} in 30 days; highest ${formatINR(best.netPaise)} on ${shortDay(best.date)}.`;
          }}
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d!.revenueTrend.map((p) => ({ ...p, day: shortDay(p.date) }))}>
                <CartesianGrid {...CHART_THEME.grid} />
                <XAxis dataKey="day" {...CHART_THEME.axis} minTickGap={24} />
                <YAxis
                  {...CHART_THEME.axis}
                  width={56}
                  tickFormatter={(v: number) => compactINR(v)}
                />
                <Tooltip
                  {...CHART_THEME.tooltip}
                  formatter={(v) => [formatINR(Number(v)), 'Net collected']}
                />
                <Line
                  type="monotone"
                  dataKey="netPaise"
                  name="Net collected"
                  stroke={CHART_COLORS[0]}
                  {...CHART_THEME.line}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartWidget>

        <ChartWidget
          q={q}
          title="Appointments today"
          description="By status"
          isEmpty={() => d!.appointmentsToday.total === 0}
          emptyText="No appointments today."
          summary={() =>
            `${d!.appointmentsToday.total} appointments today: ${slicesSummary(appointmentSlices(d!.appointmentsToday))}.`
          }
        >
          {() => (
            <StatusDonut
              slices={appointmentSlices(d!.appointmentsToday)}
              total={d!.appointmentsToday.total}
            />
          )}
        </ChartWidget>

        <ChartWidget
          q={q}
          className="lg:col-span-2"
          title="Doctor utilisation, last 30 days"
          description="Booked minutes ÷ scheduled minutes"
          height="h-72"
          isEmpty={() => d!.doctorUtilisation.length === 0}
          emptyText="No doctor schedules in the last 30 days."
          summary={() =>
            d!.doctorUtilisation
              .map((x) => `${x.doctorName} ${formatRate(x.utilisation, 0)}`)
              .join(', ')
          }
        >
          {() => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={d!.doctorUtilisation.map((x) => ({
                  name: x.doctorName.replace(/^Dr /, ''),
                  percent: x.utilisation === null ? 0 : Math.round(x.utilisation * 1000) / 10,
                }))}
              >
                <CartesianGrid {...CHART_THEME.grid} />
                <XAxis
                  dataKey="name"
                  {...CHART_THEME.axis}
                  interval={0}
                  tick={{ ...CHART_THEME.axis.tick, fontSize: 11 }}
                />
                <YAxis {...CHART_THEME.axis} width={40} unit="%" domain={[0, 100]} />
                <Tooltip
                  {...CHART_THEME.tooltip}
                  formatter={(v) => [`${String(v)}%`, 'Utilisation']}
                />
                <Bar
                  dataKey="percent"
                  name="Utilisation"
                  fill={CHART_COLORS[0]}
                  radius={CHART_THEME.bar.radius}
                  maxBarSize={CHART_THEME.bar.maxBarSize}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartWidget>

        <ListWidget
          q={q}
          title="Audit alerts"
          description="Latest denied access attempts"
          icon={ShieldAlert}
          iconTone="danger"
          actions={
            <Link to="/admin/audit-logs?outcome=denied" className={`text-sm ${linkClass}`}>
              Audit logs
            </Link>
          }
          isEmpty={() => d!.auditAlerts.length === 0}
          emptyText="No denied access attempts."
        >
          {() => (
            <ul className="divide-y divide-line">
              {d!.auditAlerts.slice(0, 6).map((a) => (
                <li key={a.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-ink">
                    {AUDIT_ACTION_LABELS[a.action] ?? a.action}
                    {a.resourceType ? ` · ${a.resourceType}` : ''}
                    {a.resourceNumber ? ` ${a.resourceNumber}` : ''}
                  </p>
                  <p className="tabular text-xs text-muted">
                    {[a.actorName, a.actorRole].filter(Boolean).join(' · ')} ·{' '}
                    {formatDateTime(a.at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </ListWidget>
      </div>
    </section>
  );
}
