import { CalendarClock, HandCoins, MessageSquare, Timer, UserCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import StatusPill from '../../../components/ui/StatusPill';
import { CHART_THEME } from '../../../components/ui/chartTheme';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDate, formatTime } from '../../../utils/dates';
import { formatINR } from '../../../utils/money';
import { useGetReceptionDashboardQuery, type ReceptionDashboard as Data } from '../api';
import { statusColor, statusLabel } from '../charts';
import DashboardHeader from '../components/DashboardHeader';
import { ChartWidget, ListWidget, SliceLegend, StatWidget } from '../components/widgets';

/** The per-doctor columns of the stacked bar, in lifecycle order. */
const SERIES = [
  { key: 'scheduled', status: 'scheduled' },
  { key: 'checkedIn', status: 'checked_in' },
  { key: 'inConsultation', status: 'in_consultation' },
  { key: 'completed', status: 'completed' },
  { key: 'noShow', status: 'no_show' },
  { key: 'cancelled', status: 'cancelled' },
] as const;

const totals = (d: Data) =>
  SERIES.map((s) => ({
    key: s.key,
    label: statusLabel('appointment', s.status),
    color: statusColor('appointment', s.status),
    value: d.appointmentsByDoctor.reduce((sum, x) => sum + x[s.key], 0),
  }));

/**
 * Reception dashboard (spec §14): check-ins waiting, today's appointments per doctor by status,
 * the next two hours, invoices issued today and still unpaid, open follow-up requests.
 */
export default function ReceptionDashboard() {
  const q = useGetReceptionDashboardQuery();
  const d = q.data;
  const todayTotal = () => d!.appointmentsByDoctor.reduce((s, x) => s + x.total, 0);

  return (
    <section className="space-y-6">
      <DashboardHeader />

      <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <li>
          <StatWidget
            q={q}
            label="Waiting to be seen"
            icon={UserCheck}
            tone="warning"
            render={() => ({
              value: d!.checkInsWaiting,
              hint: 'Checked in',
              to: '/reception/queue',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Appointments today"
            icon={CalendarClock}
            render={() => ({ value: todayTotal(), to: '/reception/appointments' })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Unpaid invoices today"
            icon={HandCoins}
            tone="danger"
            render={() => ({
              value: d!.unpaidToday.count,
              hint: 'Issued today with a balance',
              to: '/reception/invoices',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Open follow-up requests"
            icon={MessageSquare}
            tone="info"
            render={() => ({ value: d!.openFollowups, to: '/reception/follow-ups' })}
          />
        </li>
      </ul>

      <ChartWidget
        q={q}
        title="Today by doctor"
        description="Appointments per doctor, by status"
        height="h-auto"
        isEmpty={() => d!.appointmentsByDoctor.length === 0}
        emptyText="No appointments today."
        summary={() =>
          d!.appointmentsByDoctor
            .map(
              (x) =>
                `${x.doctorName}: ${x.total} (${x.completed} completed, ${x.checkedIn} waiting)`,
            )
            .join('; ')
        }
      >
        {() => (
          <div className="grid gap-4 lg:grid-cols-[1fr_14rem]">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={d!.appointmentsByDoctor.map((x) => ({
                    ...x,
                    name: x.doctorName.replace(/^Dr /, ''),
                  }))}
                >
                  <CartesianGrid {...CHART_THEME.grid} />
                  <XAxis
                    dataKey="name"
                    {...CHART_THEME.axis}
                    interval={0}
                    tick={{ ...CHART_THEME.axis.tick, fontSize: 11 }}
                  />
                  <YAxis {...CHART_THEME.axis} width={32} allowDecimals={false} />
                  <Tooltip {...CHART_THEME.tooltip} />
                  {SERIES.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={statusLabel('appointment', s.status)}
                      stackId="status"
                      fill={statusColor('appointment', s.status)}
                      maxBarSize={CHART_THEME.bar.maxBarSize}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <SliceLegend slices={totals(d!)} total={todayTotal()} />
          </div>
        )}
      </ChartWidget>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <ListWidget
          q={q}
          title="Next 2 hours"
          description="Booked and not checked in yet"
          icon={Timer}
          iconTone="info"
          actions={
            <Link to="/reception/appointments" className={`text-sm ${linkClass}`}>
              All appointments
            </Link>
          }
          isEmpty={() => d!.upcoming.length === 0}
          emptyText="No more appointments in the next two hours."
        >
          {() => (
            <ul className="divide-y divide-line">
              {d!.upcoming.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link to={`/reception/appointments/${a.id}`} className={`text-sm ${linkClass}`}>
                      <span className="tabular">{formatTime(a.startAt)}</span> ·{' '}
                      {a.patientName ?? '—'}
                    </Link>
                    <p className="text-xs text-muted">
                      <span className="tabular">{a.appointmentNumber}</span>
                      {a.doctorName ? ` · ${a.doctorName}` : ''}
                    </p>
                  </div>
                  <StatusPill domain="appointment" status={a.status} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </ListWidget>

        <ListWidget
          q={q}
          title="Unpaid invoices today"
          description={d ? `${d.unpaidToday.count} issued today with a balance` : undefined}
          icon={HandCoins}
          iconTone="warning"
          actions={
            <Link to="/reception/invoices" className={`text-sm ${linkClass}`}>
              All invoices
            </Link>
          }
          isEmpty={() => d!.unpaidToday.items.length === 0}
          emptyText="Every invoice issued today is paid."
        >
          {() => (
            <ul className="divide-y divide-line">
              {d!.unpaidToday.items.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link to={`/reception/invoices/${i.id}`} className={`text-sm ${linkClass}`}>
                      <span className="tabular">{i.invoiceNumber ?? 'Invoice'}</span> ·{' '}
                      {i.patientName ?? '—'}
                    </Link>
                    <p className="tabular text-xs text-muted">Issued {formatDate(i.issuedAt)}</p>
                  </div>
                  <span className="tabular text-sm font-semibold text-ink">
                    {formatINR(i.balancePaise)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ListWidget>
      </div>
    </section>
  );
}
