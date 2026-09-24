import { CalendarClock, CalendarPlus, Phone } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import Code from '../../../components/ui/Code';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import StatusPill from '../../../components/ui/StatusPill';
import Tabs from '../../../components/ui/Tabs';
import { clinicDate, formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { formatPhone } from '../../../utils/phone';
import { selectCurrentUser } from '../../auth/authSlice';
import { useGetPublicSettingsQuery } from '../../settings/api';
import { useCancelAppointmentMutation, useListAppointmentsQuery, type Appointment } from '../api';
import RescheduleModal from '../components/RescheduleModal';
import { patientChangeRules } from '../paths';

const TABS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
];

/** One of the patient's appointments with what they may do online. */
function AppointmentCard({
  a,
  onCancel,
  onReschedule,
}: {
  a: Appointment;
  onCancel: (a: Appointment) => void;
  onReschedule: (a: Appointment) => void;
}) {
  const { data: clinic } = useGetPublicSettingsQuery();
  const rules = patientChangeRules(a, clinic?.appointment);
  return (
    <li className="rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-card text-ink">{formatDateTime(a.startAt)}</p>
          <p className="mt-0.5 text-sm text-body">
            {a.doctor.name}
            {a.department ? ` · ${a.department.name}` : ''}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Code>{a.appointmentNumber}</Code>
            <span>{a.service.name}</span>
            {a.tokenNumber && <span className="tabular">Token {a.tokenNumber}</span>}
          </p>
        </div>
        <StatusPill domain="appointment" status={a.status} />
      </div>
      {(rules.canCancel || rules.canReschedule) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {rules.canReschedule && (
            <Button size="sm" variant="secondary" onClick={() => onReschedule(a)}>
              Change time
            </Button>
          )}
          {rules.canCancel && (
            <Button size="sm" variant="ghost" onClick={() => onCancel(a)}>
              Cancel
            </Button>
          )}
        </div>
      )}
      {rules.tooLate && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
          <Phone className="h-4 w-4" aria-hidden="true" />
          This appointment is less than {clinic?.appointment.minCancelHours} hours away. To change
          or cancel it, please call the clinic
          {clinic?.phone ? ` on ${formatPhone(clinic.phone)}` : ''}.
        </p>
      )}
    </li>
  );
}

/**
 * /patient/appointments (spec §13.1): upcoming and past appointments. Cancel and change time only
 * while allowed (`patientChangeRules`); otherwise the clinic's phone number.
 */
export default function MyAppointmentsPage() {
  const user = useAppSelector(selectCurrentUser);
  const { data: clinic } = useGetPublicSettingsQuery();
  const [tab, setTab] = useState('upcoming');
  const today = clinicDate();
  const upcoming = useListAppointmentsQuery(
    { from: today, status: 'scheduled,checked_in,in_consultation', limit: 50 },
    { skip: tab !== 'upcoming' },
  );
  const past = useListAppointmentsQuery(
    { status: 'completed,cancelled,no_show', sort: '-startAt', limit: 50 },
    { skip: tab !== 'past' },
  );
  const query = tab === 'upcoming' ? upcoming : past;
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [moving, setMoving] = useState<Appointment | null>(null);
  const [cancel, cancelState] = useCancelAppointmentMutation();
  const pending =
    user?.patientLinkStatus === 'pending_verification' ||
    (isApiQueryError(query.error) && query.error.code === 'PATIENT_LINK_PENDING');
  const canBook = clinic?.appointment.allowPatientSelfBooking !== false && !pending;

  return (
    <section>
      <PageHeader
        title="My appointments"
        actions={
          canBook && (
            <Link to="/patient/appointments/book" className={buttonClass()}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" /> Book appointment
            </Link>
          )
        }
      />
      {pending ? (
        <Alert tone="warning" title="Please verify your identity at the clinic">
          Your appointments will show here once reception has checked your photo ID.
        </Alert>
      ) : (
        <Tabs label="Appointments" tabs={TABS} value={tab} onChange={setTab}>
          {query.isLoading && <ListSkeleton label="Loading appointments…" />}
          {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
          {query.data && query.data.items.length === 0 && (
            <EmptyState
              icon={CalendarClock}
              title={tab === 'upcoming' ? 'No upcoming appointments' : 'No past appointments'}
              action={
                tab === 'upcoming' && canBook ? (
                  <Link to="/patient/appointments/book" className={buttonClass('secondary')}>
                    Book an appointment
                  </Link>
                ) : undefined
              }
            />
          )}
          {query.data && query.data.items.length > 0 && (
            <ul className="grid gap-3 lg:grid-cols-2">
              {query.data.items.map((a) => (
                <AppointmentCard
                  key={a.id}
                  a={a}
                  onCancel={(x) => {
                    setCancelError(null);
                    setCancelling(x);
                  }}
                  onReschedule={setMoving}
                />
              ))}
            </ul>
          )}
        </Tabs>
      )}

      <ReasonDialog
        open={cancelling !== null}
        title="Cancel appointment"
        label="Reason (optional)"
        confirmLabel="Cancel appointment"
        tone="danger"
        minLength={0}
        loading={cancelState.isLoading}
        error={cancelError}
        onCancel={() => setCancelling(null)}
        onSubmit={(reason) => {
          if (!cancelling) return;
          cancel({ id: cancelling.id, ...(reason ? { reason } : {}) })
            .unwrap()
            .then(() => {
              toast.success('Appointment cancelled');
              setCancelling(null);
            })
            .catch((err: unknown) => setCancelError(getQueryErrorMessage(err)));
        }}
      >
        {cancelling && (
          <>
            Cancel your appointment on {formatDateTime(cancelling.startAt)}? This cannot be undone.
          </>
        )}
      </ReasonDialog>
      {moving && (
        <RescheduleModal
          key={moving.id}
          appointment={moving}
          open
          forPatient
          onClose={() => setMoving(null)}
        />
      )}
    </section>
  );
}
