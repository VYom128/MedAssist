import { ArrowRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Code from '../../../components/ui/Code';
import DescriptionList from '../../../components/ui/DescriptionList';
import SectionCard from '../../../components/ui/SectionCard';
import StatusPill from '../../../components/ui/StatusPill';
import { linkClass } from '../../../components/ui/linkClass';
import {
  APPOINTMENT_PRIORITY_LABELS,
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_TYPE_LABELS,
  GENDER_SHORT,
} from '../../../constants/catalog';
import { ROLES } from '../../../constants/roles';
import { formatDateTime, formatTime } from '../../../utils/dates';
import { formatPhone } from '../../../utils/phone';
import { selectCurrentUser } from '../../auth/authSlice';
import { ageSex, patientsBase } from '../../patients/paths';
import type { Appointment } from '../api';
import AppointmentActions from './AppointmentActions';
import PriorityPill from './PriorityPill';

/** Number, status, patient, doctor, time, visit details, actions and history of an appointment. */
export default function AppointmentDetails({ appointment: a }: { appointment: Appointment }) {
  const user = useAppSelector(selectCurrentUser);
  const canOpenPatient = user?.role === ROLES.RECEPTIONIST || user?.role === ROLES.ADMIN;
  const p = a.patient;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Code>{a.appointmentNumber}</Code>
        <StatusPill domain="appointment" status={a.status} />
        <PriorityPill priority={a.priority} />
        {a.isOverbook && <StatusPill domain="appointmentFlag" status="overbook" />}
      </div>

      <AppointmentActions appointment={a} />

      <DescriptionList
        items={[
          {
            label: 'Patient',
            value: p ? (
              <span>
                {canOpenPatient ? (
                  <Link to={`${patientsBase(user?.role)}/${p.id}`} className={linkClass}>
                    {p.fullName}
                  </Link>
                ) : (
                  p.fullName
                )}
                <span className="block text-xs font-normal text-muted">
                  {p.mrn} · {ageSex(p.age, GENDER_SHORT[p.gender])}
                  {p.phone ? ` · ${formatPhone(p.phone)}` : ''}
                </span>
              </span>
            ) : null,
          },
          { label: 'Doctor', value: a.doctor.name },
          { label: 'When', value: `${formatDateTime(a.startAt)} – ${formatTime(a.endAt)}` },
          { label: 'Service', value: `${a.service.name} (${a.service.durationMinutes} min)` },
          { label: 'Department', value: a.department?.name },
          { label: 'Type', value: APPOINTMENT_TYPE_LABELS[a.type] },
          { label: 'Booked via', value: APPOINTMENT_SOURCE_LABELS[a.source] },
          { label: 'Priority', value: a.priority ? APPOINTMENT_PRIORITY_LABELS[a.priority] : null },
          {
            label: 'Token',
            value: a.tokenNumber ? <span className="tabular">{a.tokenNumber}</span> : null,
          },
          { label: 'Checked in', value: a.checkedInAt ? formatDateTime(a.checkedInAt) : null },
          { label: 'Reason for visit', value: a.reason, wide: true },
          ...(a.cancellation
            ? [
                {
                  label: 'Cancelled',
                  value: `${formatDateTime(a.cancellation.at)}${a.cancellation.reason ? ` – ${a.cancellation.reason}` : ''}`,
                  wide: true,
                },
              ]
            : []),
        ]}
      />

      {Boolean(
        a.statusHistory?.length || a.rescheduleHistory?.length || a.priorityHistory?.length,
      ) && (
        <SectionCard title="History" icon={History} iconTone="neutral">
          <ol className="space-y-3 text-sm" aria-label="Status history">
            {(a.statusHistory ?? []).map((h, i) => (
              <li key={`s${i}`} className="flex flex-wrap items-center gap-2">
                <StatusPill domain="appointment" status={h.status} size="sm" />
                <span className="tabular text-muted">{formatDateTime(h.at)}</span>
                {h.note && <span className="text-body">– {h.note}</span>}
              </li>
            ))}
          </ol>
          {(a.rescheduleHistory?.length ?? 0) > 0 && (
            <ul
              className="mt-4 space-y-2 border-t border-line pt-4 text-sm"
              aria-label="Reschedules"
            >
              {a.rescheduleHistory!.map((r, i) => (
                <li key={`r${i}`} className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-ink">Moved</span>
                  <span className="tabular">{formatDateTime(r.fromStartAt)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted" aria-label="to" />
                  <span className="tabular">{formatDateTime(r.toStartAt)}</span>
                  {r.reason && <span className="text-muted">– {r.reason}</span>}
                </li>
              ))}
            </ul>
          )}
          {(a.priorityHistory?.length ?? 0) > 0 && (
            <ul
              className="mt-4 space-y-2 border-t border-line pt-4 text-sm"
              aria-label="Priority changes"
            >
              {a.priorityHistory!.map((h, i) => (
                <li key={`p${i}`}>
                  Priority {APPOINTMENT_PRIORITY_LABELS[h.from]} →{' '}
                  {APPOINTMENT_PRIORITY_LABELS[h.to]}{' '}
                  <span className="tabular text-muted">({formatDateTime(h.at)})</span>
                  {h.reason && <span className="text-muted"> – {h.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}
