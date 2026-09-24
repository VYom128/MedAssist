import { CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';
import SectionCard from '../../../components/ui/SectionCard';
import Skeleton from '../../../components/ui/Skeleton';
import StatusPill from '../../../components/ui/StatusPill';
import { linkClass } from '../../../components/ui/linkClass';
import { clinicDate, formatDateTime } from '../../../utils/dates';
import { useListAppointmentsQuery } from '../api';

/** The patient's next scheduled appointment (patient dashboard). */
export default function NextAppointmentCard({ canBook }: { canBook: boolean }) {
  const { data, isLoading, isError } = useListAppointmentsQuery({
    from: clinicDate(),
    status: 'scheduled',
    limit: 1,
  });
  const next = data?.items[0];
  return (
    <SectionCard
      title="Next appointment"
      icon={CalendarClock}
      actions={
        <Link to="/patient/appointments" className={`text-sm ${linkClass}`}>
          All appointments
        </Link>
      }
    >
      {isLoading && <Skeleton className="h-12 w-full" />}
      {isError && <p className="text-sm text-muted">Your appointments could not be loaded.</p>}
      {data && !next && (
        <p className="text-sm text-muted">
          No upcoming appointments.{' '}
          {canBook && (
            <Link to="/patient/appointments/book" className={linkClass}>
              Book one
            </Link>
          )}
        </p>
      )}
      {next && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="tabular text-card text-ink">{formatDateTime(next.startAt)}</p>
            <p className="mt-0.5 text-sm text-body">
              {next.doctor.name}
              {next.department ? ` · ${next.department.name}` : ''}
            </p>
          </div>
          <StatusPill domain="appointment" status={next.status} />
        </div>
      )}
    </SectionCard>
  );
}
