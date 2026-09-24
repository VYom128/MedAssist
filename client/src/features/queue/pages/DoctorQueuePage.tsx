import { BellRing, CircleCheck, Clock, Hourglass, Stethoscope, Users } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Code from '../../../components/ui/Code';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import StatCard from '../../../components/ui/StatCard';
import { linkClass } from '../../../components/ui/linkClass';
import { useQueueRooms } from '../../../hooks/useSocketInvalidation';
import { clinicDate, formatCalendarDate, formatTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useAppointmentActionMutation } from '../../appointments/api';
import PriorityPill from '../../appointments/components/PriorityPill';
import { selectCurrentUser } from '../../auth/authSlice';
import { useCallNextMutation, useGetQueueQuery, type QueueItem } from '../api';
import QueueCard from '../components/QueueCard';

/**
 * /doctor/queue (spec §4.6 step 3, §13.4 #3): the patient with the doctor now (Complete), a
 * prominent "Call next", the waiting list in queue order and today's numbers. Updates live.
 */
export default function DoctorQueuePage() {
  const user = useAppSelector(selectCurrentUser);
  const today = clinicDate();
  const { data, isLoading, isError, error, refetch } = useGetQueueQuery({ date: today });
  useQueueRooms(user ? [{ doctorId: user.id, date: today }] : []);
  const [callNext, calling] = useCallNextMutation();
  const [act, acting] = useAppointmentActionMutation();
  const [completing, setCompleting] = useState<QueueItem | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const current = data?.inConsultation[0];
  const onCallNext = async () => {
    try {
      const called = await callNext().unwrap();
      if (called) {
        toast.success(
          `Token ${called.tokenNumber ?? '–'}: ${called.patient?.fullName ?? 'next patient'}`,
        );
      } else {
        toast('Nobody is waiting');
      }
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    }
  };
  const onComplete = async () => {
    if (!completing) return;
    try {
      await act({ id: completing.appointmentId, action: 'complete' }).unwrap();
      toast.success('Consultation completed');
      setCompleting(null);
    } catch (err) {
      setCompleteError(getQueryErrorMessage(err));
    }
  };

  return (
    <section className="space-y-8">
      <PageHeader
        title="My queue"
        description={`Today, ${formatCalendarDate(today)}${data?.doctor.roomNumber ? ` · Room ${data.doctor.roomNumber}` : ''}. Updates live.`}
        actions={
          <Button
            onClick={() => void onCallNext()}
            loading={calling.isLoading}
            disabled={!data || Boolean(current)}
          >
            <BellRing className="h-4 w-4" aria-hidden="true" /> Call next
          </Button>
        }
      />
      {isLoading && <ListSkeleton label="Loading your queue…" rows={4} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && (
        <>
          <ul className="grid gap-4 sm:grid-cols-3">
            <li>
              <StatCard
                label="Waiting"
                value={data.waiting.length}
                icon={Hourglass}
                tone="warning"
              />
            </li>
            <li>
              <StatCard
                label="Completed today"
                value={data.done.length}
                icon={CircleCheck}
                tone="success"
              />
            </li>
            <li>
              <StatCard
                label="Average consultation"
                value={`${data.averageConsultMinutes} min`}
                icon={Clock}
                tone="info"
                hint={
                  data.averageBasis === 'history' ? 'Last 30 days' : 'Slot length (no history yet)'
                }
              />
            </li>
          </ul>

          <SectionCard title="With you now" icon={Stethoscope} iconTone="consult">
            {current ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <span
                    className="tabular flex h-16 min-w-16 items-center justify-center rounded-card bg-consult-50 px-3 text-stat text-consult-700"
                    aria-label={`Token ${current.tokenNumber ?? '–'}`}
                  >
                    {current.tokenNumber ?? '–'}
                  </span>
                  <div>
                    <p className="text-card text-ink">{current.patient.shortName}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                      <Code>{current.patient.mrn}</Code>
                      <PriorityPill priority={current.priority} size="sm" />
                      <span className="tabular">Since {formatTime(current.startedAt)}</span>
                    </p>
                    <Link
                      to={`/doctor/appointments/${current.appointmentId}`}
                      className={`mt-1 inline-block text-sm ${linkClass}`}
                    >
                      Open appointment
                    </Link>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setCompleteError(null);
                    setCompleting(current);
                  }}
                >
                  <CircleCheck className="h-4 w-4" aria-hidden="true" /> Complete
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Nobody is with you. Use “Call next” to call the next patient.
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Waiting"
            description="In queue order: emergency, priority, then by appointment time."
            icon={Users}
            iconTone="warning"
          >
            {data.waiting.length === 0 ? (
              <EmptyState icon={Users} title="Nobody is waiting" />
            ) : (
              <ol className="grid gap-2 md:grid-cols-2">
                {data.waiting.map((item) => (
                  <li key={item.appointmentId}>
                    <QueueCard item={item} />
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </>
      )}
      <ConfirmDialog
        open={completing !== null}
        title="Complete consultation"
        confirmLabel="Complete"
        loading={acting.isLoading}
        onConfirm={() => void onComplete()}
        onCancel={() => setCompleting(null)}
      >
        {completeError && (
          <div className="mb-3">
            <Alert tone="error">{completeError}</Alert>
          </div>
        )}
        Mark the consultation with {completing?.patient.shortName} (token {completing?.tokenNumber})
        as completed?
      </ConfirmDialog>
    </section>
  );
}
