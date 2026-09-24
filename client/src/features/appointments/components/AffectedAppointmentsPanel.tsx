import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import StatusPill from '../../../components/ui/StatusPill';
import { linkClass } from '../../../components/ui/linkClass';
import { formatDateTime } from '../../../utils/dates';
import { selectCurrentUser } from '../../auth/authSlice';
import type { AffectedAppointment } from '../api';
import { appointmentsBase } from '../paths';

/**
 * Booked appointments hit by new leave or a new weekly schedule (spec §4.13): reception must
 * reschedule or cancel each one. Amber panel with a link to every appointment.
 */
export default function AffectedAppointmentsPanel({
  items,
  context,
}: {
  items: AffectedAppointment[];
  context: 'leave' | 'schedule';
}) {
  const user = useAppSelector(selectCurrentUser);
  if (items.length === 0) return null;
  const base = appointmentsBase(user?.role);
  const n = items.length;
  return (
    <Alert
      tone="warning"
      title={`${n} booked appointment${n === 1 ? '' : 's'} ${
        context === 'leave'
          ? `fall${n === 1 ? 's' : ''} in this leave`
          : `fall${n === 1 ? 's' : ''} outside the new hours`
      }`}
    >
      <p>Reception has been told; each one needs to be rescheduled or cancelled.</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            <Link to={`${base}/${a.id}`} className={linkClass}>
              {a.appointmentNumber}
            </Link>
            <span className="tabular">{formatDateTime(a.startAt)}</span>
            {a.patientShortName && <span>· {a.patientShortName}</span>}
            <StatusPill domain="appointment" status={a.status} size="sm" />
          </li>
        ))}
      </ul>
    </Alert>
  );
}
