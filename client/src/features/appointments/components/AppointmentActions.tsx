import {
  ArrowUpDown,
  CalendarClock,
  CircleCheck,
  Stethoscope,
  Undo2,
  UserCheck,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import ReasonDialog from '../../../components/ui/ReasonDialog';
import { APPOINTMENT_REASON_MIN } from '../../../constants/catalog';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import {
  useAppointmentActionMutation,
  useCancelAppointmentMutation,
  type Appointment,
  type AppointmentAction,
} from '../api';
import { actionsFor, type AppointmentActionKind } from '../paths';
import PriorityDialog from './PriorityDialog';
import RescheduleModal from './RescheduleModal';

interface ConfirmSpec {
  action: AppointmentAction;
  title: string;
  label: string;
  tone: 'primary' | 'danger';
  body: ReactNode;
  done: (a: Appointment) => string;
}

const BUTTONS: Record<
  AppointmentActionKind,
  { label: string; icon: LucideIcon; variant: 'primary' | 'secondary' | 'danger' }
> = {
  'check-in': { label: 'Check in', icon: UserCheck, variant: 'primary' },
  start: { label: 'Start consultation', icon: Stethoscope, variant: 'primary' },
  complete: { label: 'Complete', icon: CircleCheck, variant: 'primary' },
  reschedule: { label: 'Reschedule', icon: CalendarClock, variant: 'secondary' },
  priority: { label: 'Change priority', icon: ArrowUpDown, variant: 'secondary' },
  'no-show': { label: 'Mark no-show', icon: UserX, variant: 'secondary' },
  'undo-no-show': { label: 'Undo no-show', icon: Undo2, variant: 'secondary' },
  cancel: { label: 'Cancel appointment', icon: XCircle, variant: 'danger' },
};

/**
 * The buttons valid for the caller's role and the appointment's status (see `actionsFor`), each
 * behind a confirmation. Server errors (e.g. the slot was taken again) show in the dialog.
 */
export default function AppointmentActions({ appointment: a }: { appointment: Appointment }) {
  const user = useAppSelector(selectCurrentUser);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<'reschedule' | 'priority' | 'cancel' | null>(null);
  /** Changes on every opening, so the dialogs start with a fresh form. */
  const [opening, setOpening] = useState(0);
  const [runAction, action] = useAppointmentActionMutation();
  const [cancel, cancelling] = useCancelAppointmentMutation();
  const available = actionsFor(user?.role, a);
  const who = a.patient?.fullName ?? 'the patient';

  const specs: Partial<Record<AppointmentActionKind, ConfirmSpec>> = {
    'check-in': {
      action: 'check-in',
      title: 'Check in',
      label: 'Check in',
      tone: 'primary',
      body: (
        <>
          Check in {who}? They get the next token for {a.doctor.name}'s queue.
        </>
      ),
      done: (x) => `Checked in – token ${x.tokenNumber ?? '–'}`,
    },
    start: {
      action: 'start',
      title: 'Start consultation',
      label: 'Start',
      tone: 'primary',
      body: <>Call {who} in now?</>,
      done: () => 'Consultation started',
    },
    complete: {
      action: 'complete',
      title: 'Complete consultation',
      label: 'Complete',
      tone: 'primary',
      body: <>Mark this consultation as completed?</>,
      done: () => 'Consultation completed',
    },
    'no-show': {
      action: 'no-show',
      title: 'Mark as no-show',
      label: 'Mark no-show',
      tone: 'danger',
      body: (
        <>
          {who} did not come for the {formatDateTime(a.startAt)} appointment. The slot is freed and
          the patient is emailed. You can undo this today only.
        </>
      ),
      done: () => 'Marked as no-show',
    },
    'undo-no-show': {
      action: 'undo-no-show',
      title: 'Undo no-show',
      label: 'Undo no-show',
      tone: 'primary',
      body: <>Put this appointment back to scheduled? This only works if its slot is still free.</>,
      done: () => 'No-show undone',
    },
  };

  const click = (kind: AppointmentActionKind) => {
    setError(null);
    if (kind === 'reschedule' || kind === 'priority' || kind === 'cancel') {
      setOpening((n) => n + 1);
      setOpen(kind);
    } else setConfirm(specs[kind] ?? null);
  };

  const runConfirmed = async () => {
    if (!confirm) return;
    try {
      const updated = await runAction({ id: a.id, action: confirm.action }).unwrap();
      toast.success(confirm.done(updated));
      setConfirm(null);
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };

  if (available.length === 0) return null;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {available.map((kind) => {
          const { label, icon: Icon, variant } = BUTTONS[kind];
          return (
            <Button key={kind} variant={variant} size="sm" onClick={() => click(kind)}>
              <Icon className="h-4 w-4" aria-hidden="true" /> {label}
            </Button>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        confirmLabel={confirm?.label}
        tone={confirm?.tone}
        loading={action.isLoading}
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirm(null)}
      >
        {error && (
          <div className="mb-3">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {confirm?.body}
      </ConfirmDialog>

      <ReasonDialog
        open={open === 'cancel'}
        title={`Cancel ${a.appointmentNumber}`}
        label="Reason for cancelling"
        confirmLabel="Cancel appointment"
        tone="danger"
        minLength={user?.role === 'patient' ? 0 : APPOINTMENT_REASON_MIN}
        loading={cancelling.isLoading}
        error={error}
        onCancel={() => setOpen(null)}
        onSubmit={(reason) => {
          setError(null);
          cancel({ id: a.id, reason })
            .unwrap()
            .then(() => {
              toast.success('Appointment cancelled');
              setOpen(null);
            })
            .catch((err: unknown) => setError(getQueryErrorMessage(err)));
        }}
      >
        This cannot be undone. The slot is freed and {who} is emailed.
      </ReasonDialog>

      <RescheduleModal
        key={`reschedule-${opening}`}
        appointment={a}
        open={open === 'reschedule'}
        onClose={() => setOpen(null)}
      />
      <PriorityDialog
        key={`priority-${opening}`}
        appointment={a}
        open={open === 'priority'}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
