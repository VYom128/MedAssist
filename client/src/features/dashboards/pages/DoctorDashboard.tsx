import {
  ClipboardList,
  FilePen,
  ListOrdered,
  MessageSquare,
  Stethoscope,
  TestTubes,
  UserCheck,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { buttonClass } from '../../../components/ui/buttonClass';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDate, formatDateTime, formatTime } from '../../../utils/dates';
import { useGetDoctorDashboardQuery } from '../api';
import { appointmentSlices, slicesSummary } from '../charts';
import DashboardHeader from '../components/DashboardHeader';
import {
  ChartWidget,
  ListWidget,
  StatusDonut,
  StatWidget,
  WidgetError,
} from '../components/widgets';
import Skeleton from '../../../components/ui/Skeleton';

/**
 * Doctor dashboard (spec §14) – only the doctor's own records: today's queue, the next patient,
 * results to review (critical first), unsigned drafts (over 24 h highlighted), open follow-ups
 * and this week's appointments by status.
 */
export default function DoctorDashboard() {
  const q = useGetDoctorDashboardQuery();
  const d = q.data;

  return (
    <section className="space-y-6">
      <DashboardHeader />

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <StatWidget
            q={q}
            label="Waiting"
            icon={UserCheck}
            tone="warning"
            render={() => ({
              value: d!.queueToday.waiting,
              hint: `${d!.queueToday.scheduled} more booked today`,
              to: '/doctor/queue',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Seen today"
            icon={Stethoscope}
            tone="success"
            render={() => ({
              value: d!.queueToday.done,
              hint: `${d!.queueToday.inConsultation} in consultation`,
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Results to review"
            icon={TestTubes}
            tone={d && d.resultsToReview.critical > 0 ? 'danger' : 'info'}
            render={() => ({
              value: d!.resultsToReview.count,
              ...(d!.resultsToReview.critical > 0
                ? {
                    status: {
                      tone: 'danger' as const,
                      label: `${d!.resultsToReview.critical} critical`,
                    },
                  }
                : {}),
              to: '/doctor/lab-results',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Unsigned notes"
            icon={FilePen}
            tone="warning"
            render={() => ({
              value: d!.unsignedDrafts.count,
              ...(d!.unsignedDrafts.olderThan24h > 0
                ? {
                    status: {
                      tone: 'warning' as const,
                      label: `${d!.unsignedDrafts.olderThan24h} over 24 h`,
                    },
                  }
                : {}),
              to: '/doctor/notes',
            })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Open follow-up requests"
            icon={MessageSquare}
            tone="info"
            render={() => ({ value: d!.openFollowups, to: '/doctor/follow-ups' })}
          />
        </li>
        <li>
          <StatWidget
            q={q}
            label="Appointments this week"
            icon={ClipboardList}
            render={() => ({
              value: d!.weekAppointments.total,
              hint: `${formatDate(`${d!.weekAppointments.from}T12:00:00Z`, 'UTC')} – ${formatDate(`${d!.weekAppointments.to}T12:00:00Z`, 'UTC')}`,
              to: '/doctor/appointments',
            })}
          />
        </li>
      </ul>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <NextPatientCard q={q} />

        <ListWidget
          q={q}
          className="lg:col-span-2"
          title="Results to review"
          description="Critical values first"
          icon={TestTubes}
          iconTone="info"
          actions={
            <Link to="/doctor/lab-results" className={`text-sm ${linkClass}`}>
              All results
            </Link>
          }
          isEmpty={() => d!.resultsToReview.items.length === 0}
          emptyText="No results waiting for your review."
        >
          {() => (
            <ul className="divide-y divide-line">
              {d!.resultsToReview.items.map((o) => (
                <li
                  key={o.id}
                  className={`flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0 ${
                    o.hasCritical ? '-mx-2 rounded-control bg-danger-50 px-2' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <Link to={`/doctor/lab-orders/${o.id}`} className={`text-sm ${linkClass}`}>
                      {o.patientName ?? '—'}
                    </Link>
                    <p className="tabular text-xs text-muted">
                      {o.orderNumber}
                      {o.orderedAt ? ` · ordered ${formatDateTime(o.orderedAt)}` : ''}
                    </p>
                  </div>
                  <span className="flex flex-wrap gap-1.5">
                    {o.hasCritical && <StatusPill domain="priority" status="critical" size="sm" />}
                    <StatusPill domain="labOrder" status={o.status as 'released'} size="sm" />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ListWidget>

        <ListWidget
          q={q}
          className="lg:col-span-2"
          title="Unsigned notes"
          description={
            d
              ? `Sign within ${d.unsignedDrafts.documentationWindowHours} h of the visit`
              : undefined
          }
          icon={FilePen}
          iconTone="warning"
          actions={
            <Link to="/doctor/notes" className={`text-sm ${linkClass}`}>
              All notes
            </Link>
          }
          isEmpty={() => d!.unsignedDrafts.items.length === 0}
          emptyText="Every note is signed."
        >
          {() => (
            <ul className="divide-y divide-line">
              {d!.unsignedDrafts.items.map((e) => (
                <li
                  key={e.encounterId}
                  className={`flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0 ${
                    e.olderThan24h ? '-mx-2 rounded-control bg-warning-50 px-2' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <Link
                      to={`/doctor/consult/${e.appointmentId}`}
                      className={`text-sm ${linkClass}`}
                    >
                      {e.patientName ?? '—'}
                    </Link>
                    <p className="tabular text-xs text-muted">
                      Started {formatDateTime(e.createdAt)}
                    </p>
                  </div>
                  {e.olderThan24h && (
                    <StatusPill domain="dashboardFlag" status="draft_overdue" size="sm" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </ListWidget>

        <ChartWidget
          q={q}
          title="This week"
          description="Your appointments by status"
          isEmpty={() => d!.weekAppointments.byStatus.total === 0}
          emptyText="No appointments this week."
          summary={() =>
            `${d!.weekAppointments.byStatus.total} appointments this week: ${slicesSummary(appointmentSlices(d!.weekAppointments.byStatus))}.`
          }
        >
          {() => (
            <StatusDonut
              slices={appointmentSlices(d!.weekAppointments.byStatus)}
              total={d!.weekAppointments.byStatus.total}
            />
          )}
        </ChartWidget>
      </div>
    </section>
  );
}

/** Who is next in the doctor's queue, with a link to the queue. */
function NextPatientCard({ q }: { q: ReturnType<typeof useGetDoctorDashboardQuery> }) {
  const next = q.data?.nextPatient;
  return (
    <SectionCard
      title="Next patient"
      icon={UserRound}
      iconTone="consult"
      actions={
        <Link to="/doctor/queue" className={`text-sm ${linkClass}`}>
          My queue
        </Link>
      }
    >
      {q.isLoading ? (
        <div role="status">
          <span className="sr-only">Loading next patient…</span>
          <Skeleton className="h-16" />
        </div>
      ) : q.isError ? (
        <WidgetError error={q.error} onRetry={() => void q.refetch()} />
      ) : !next ? (
        <p className="rounded-control border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
          Nobody is waiting.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <span
              className="tabular flex h-14 min-w-14 items-center justify-center rounded-card bg-warning-50 px-3 text-stat text-warning-700"
              aria-label={`Token ${next.tokenNumber ?? '–'}`}
            >
              {next.tokenNumber ?? '–'}
            </span>
            <div className="min-w-0">
              <p className="truncate text-card text-ink">{next.patientName ?? '—'}</p>
              <p className="tabular text-sm text-muted">
                {next.appointmentNumber} · {formatTime(next.startAt)}
              </p>
              {next.priority !== 'normal' && (
                <StatusPill domain="priority" status={next.priority as 'priority'} size="sm" />
              )}
            </div>
          </div>
          <Link to="/doctor/queue" className={buttonClass('primary', 'sm')}>
            <ListOrdered className="h-4 w-4" aria-hidden="true" /> Open queue
          </Link>
        </div>
      )}
    </SectionCard>
  );
}
