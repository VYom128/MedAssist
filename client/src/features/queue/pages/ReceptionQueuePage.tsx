import { CalendarClock, DoorOpen, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link, useSearchParams } from 'react-router-dom';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import SectionCard from '../../../components/ui/SectionCard';
import Table, { type Column } from '../../../components/ui/Table';
import Tabs from '../../../components/ui/Tabs';
import { linkClass } from '../../../components/ui/linkClass';
import { APPOINTMENT_REASON_MIN } from '../../../constants/catalog';
import { useQueueRooms } from '../../../hooks/useSocketInvalidation';
import { clinicDate, formatCalendarDate, formatTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import {
  useAppointmentActionMutation,
  useCancelAppointmentMutation,
  useListAppointmentsQuery,
  type Appointment,
} from '../../appointments/api';
import PriorityDialog from '../../appointments/components/PriorityDialog';
import { useListDoctorsQuery, type Doctor } from '../../doctors/api';
import { useGetQueueQuery, type QueueItem } from '../api';
import QueueColumns from '../components/QueueColumns';
import WalkInModal from '../components/WalkInModal';

/** One doctor's queue today. In the overview, doctors with nobody in the queue are left out. */
function DoctorQueue({
  doctor,
  date,
  overview,
  onPriority,
  onLeft,
}: {
  doctor: Doctor;
  date: string;
  overview: boolean;
  onPriority: (item: QueueItem) => void;
  onLeft: (item: QueueItem) => void;
}) {
  const { data, isLoading, isError, error, refetch } = useGetQueueQuery({
    doctor: doctor.id,
    date,
  });
  const empty = data && !data.waiting.length && !data.inConsultation.length && !data.done.length;
  if (overview && empty) return null;
  return (
    <SectionCard
      title={doctor.name}
      description={
        data?.doctor.roomNumber ? `Room ${data.doctor.roomNumber}` : doctor.specialization
      }
      icon={DoorOpen}
    >
      {isLoading && <ListSkeleton label={`Loading ${doctor.name}'s queue…`} rows={2} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && empty && (
        <EmptyState
          icon={Users}
          title="Nobody in the queue yet"
          description="Check patients in below."
        />
      )}
      {data && !empty && (
        // A new key per doctor/date, so "changed" highlights start fresh.
        <QueueColumns
          key={`${doctor.id}:${date}`}
          queue={data}
          compact={overview}
          waitingActions={(item) => (
            <>
              <Button size="sm" variant="secondary" onClick={() => onPriority(item)}>
                Change priority
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onLeft(item)}>
                Patient left
              </Button>
            </>
          )}
        />
      )}
    </SectionCard>
  );
}

/** Today's booked patients who have not arrived yet, with a Check in button each. */
function TodaysAppointments({ doctorId, date }: { doctorId?: string; date: string }) {
  const { data, isLoading, isError, error, refetch } = useListAppointmentsQuery({
    from: date,
    to: date,
    status: 'scheduled',
    limit: 100,
    ...(doctorId ? { doctor: doctorId } : {}),
  });
  const [act] = useAppointmentActionMutation();
  const [busy, setBusy] = useState<string | null>(null);

  const checkIn = async (a: Appointment) => {
    setBusy(a.id);
    try {
      const updated = await act({ id: a.id, action: 'check-in' }).unwrap();
      toast.success(
        `${a.patient?.fullName ?? 'Patient'} checked in – token ${updated.tokenNumber ?? '–'}`,
      );
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const patientCell = (a: Appointment) => (
    <div className="min-w-0">
      <Link to={`/reception/appointments/${a.id}`} className={linkClass}>
        {a.patient?.fullName}
      </Link>
      <div className="mt-0.5 text-xs text-muted">
        <Code>{a.patient?.mrn}</Code>
      </div>
    </div>
  );
  const columns: Column<Appointment>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (a) => <span className="tabular">{formatTime(a.startAt)}</span>,
    },
    { key: 'patient', header: 'Patient', hideOnCard: true, cell: patientCell },
    { key: 'doctor', header: 'Doctor', cell: (a) => a.doctor.name },
    {
      key: 'action',
      header: 'Action',
      cardFooter: true,
      cell: (a) => (
        <Button size="sm" loading={busy === a.id} onClick={() => void checkIn(a)}>
          Check in
        </Button>
      ),
    },
  ];

  return (
    <SectionCard
      title="Today's appointments"
      description="Booked patients who have not checked in yet."
      icon={CalendarClock}
    >
      {isLoading && <ListSkeleton label="Loading today's appointments…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <p className="text-sm text-muted">Everyone booked for today has checked in.</p>
      )}
      {data && data.items.length > 0 && (
        <Table
          caption="Today's appointments"
          columns={columns}
          rows={data.items}
          rowKey={(a) => a.id}
          cardHeader={patientCell}
        />
      )}
    </SectionCard>
  );
}

/**
 * /reception/queue (spec §4.6, §13.4 #3): today's queues – all doctors (overview) or one doctor –
 * as Waiting / In consultation / Done, updated live; today's arrivals to check in; walk-ins.
 */
export default function ReceptionQueuePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('doctor') || 'all';
  const today = clinicDate();
  const doctors = useListDoctorsQuery({ limit: 100 });
  const list = doctors.data?.items ?? [];
  const shown = tab === 'all' ? list : list.filter((d) => d.id === tab);
  useQueueRooms(shown.map((d) => ({ doctorId: d.id, date: today })));

  const [walkInKey, setWalkInKey] = useState(0);
  const [walkInOpen, setWalkInOpen] = useState(false);
  const [priorityFor, setPriorityFor] = useState<QueueItem | null>(null);
  const [leaving, setLeaving] = useState<QueueItem | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [cancel, cancelling] = useCancelAppointmentMutation();

  return (
    <section className="space-y-8">
      <PageHeader
        title="Queue"
        description={`Today, ${formatCalendarDate(today)}. Updates live.`}
        actions={
          <Button
            onClick={() => {
              setWalkInKey((n) => n + 1);
              setWalkInOpen(true);
            }}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Walk-in
          </Button>
        }
      />

      {doctors.isLoading && <ListSkeleton label="Loading doctors…" rows={2} />}
      {doctors.isError && (
        <ErrorState error={doctors.error} onRetry={() => void doctors.refetch()} />
      )}
      {doctors.data && (
        <Tabs
          label="Doctor"
          tabs={[
            { id: 'all', label: 'All doctors' },
            ...list.map((d) => ({ id: d.id, label: d.name })),
          ]}
          value={tab}
          onChange={(id) => setParams(id === 'all' ? {} : { doctor: id }, { replace: true })}
        >
          <div className="space-y-6">
            {shown.map((d) => (
              <DoctorQueue
                key={d.id}
                doctor={d}
                date={today}
                overview={tab === 'all'}
                onPriority={setPriorityFor}
                onLeft={(item) => {
                  setLeaveError(null);
                  setLeaving(item);
                }}
              />
            ))}
            {tab === 'all' && (
              <p className="text-sm text-muted">
                Doctors with nobody in the queue are not shown. Pick a doctor above to see theirs.
              </p>
            )}
          </div>
        </Tabs>
      )}

      <TodaysAppointments doctorId={tab === 'all' ? undefined : tab} date={today} />

      <WalkInModal
        key={walkInKey}
        open={walkInOpen}
        doctorId={tab === 'all' ? '' : tab}
        onClose={() => setWalkInOpen(false)}
      />
      {priorityFor && (
        <PriorityDialog
          key={priorityFor.appointmentId}
          appointment={{
            id: priorityFor.appointmentId,
            status: priorityFor.status,
            priority: priorityFor.priority,
          }}
          open
          onClose={() => setPriorityFor(null)}
        />
      )}
      <ReasonDialog
        open={leaving !== null}
        title="Patient left"
        label="Reason"
        confirmLabel="Cancel appointment"
        tone="danger"
        minLength={APPOINTMENT_REASON_MIN}
        loading={cancelling.isLoading}
        error={leaveError}
        onCancel={() => setLeaving(null)}
        onSubmit={(reason) => {
          if (!leaving) return;
          cancel({ id: leaving.appointmentId, reason })
            .unwrap()
            .then(() => {
              toast.success(`Token ${leaving.tokenNumber ?? ''} removed from the queue`);
              setLeaving(null);
            })
            .catch((err: unknown) => setLeaveError(getQueryErrorMessage(err)));
        }}
      >
        {leaving && (
          <>
            {leaving.patient.shortName} (token {leaving.tokenNumber}) leaves the queue and the
            appointment is cancelled. This cannot be undone.
          </>
        )}
      </ReasonDialog>
    </section>
  );
}
