import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_PRIORITY_LABELS,
  optionsOf,
  type AppointmentPriority,
} from '../../../constants/catalog';
import { getQueryErrorMessage } from '../../../utils/http';
import { useSetQueuePriorityMutation } from '../../queue/api';
import { useUpdateAppointmentMutation, type Appointment } from '../api';
import { staffReason } from '../schemas';

const OPTIONS = optionsOf(APPOINTMENT_PRIORITIES, APPOINTMENT_PRIORITY_LABELS);

/**
 * Change an appointment's queue priority. Once the patient is checked in it goes through the
 * queue endpoint and needs a reason (spec §7.9); before that it is a plain update. The parent
 * gives it a new `key` each time it opens, so the form starts fresh.
 */
export default function PriorityDialog({
  appointment,
  open,
  onClose,
}: {
  appointment: Appointment;
  open: boolean;
  onClose: () => void;
}) {
  const inQueue = appointment.status === 'checked_in';
  const [priority, setPriority] = useState<AppointmentPriority>(appointment.priority ?? 'normal');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [update, updating] = useUpdateAppointmentMutation();
  const [setQueuePriority, queueing] = useSetQueuePriorityMutation();

  const submit = async () => {
    setError(null);
    if (priority === (appointment.priority ?? 'normal')) {
      setError('Choose a different priority');
      return;
    }
    if (inQueue) {
      const checked = staffReason.safeParse(reason);
      if (!checked.success) {
        setReasonError(checked.error.issues[0]?.message);
        return;
      }
    }
    try {
      if (inQueue) {
        await setQueuePriority({
          appointmentId: appointment.id,
          priority,
          reason: reason.trim(),
        }).unwrap();
      } else {
        await update({ id: appointment.id, body: { priority } }).unwrap();
      }
      toast.success(`Priority set to ${APPOINTMENT_PRIORITY_LABELS[priority]}`);
      onClose();
    } catch (err) {
      setError(getQueryErrorMessage(err));
    }
  };

  return (
    <Modal
      open={open}
      title="Change priority"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={updating.isLoading || queueing.isLoading}>
            Save priority
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <p className="text-sm text-muted">
          Emergency patients are seen first, then priority (e.g. elderly), then everyone else in
          order of their appointment time.
        </p>
        <Select
          label="Priority"
          options={OPTIONS}
          value={priority}
          onChange={(e) => setPriority(e.target.value as AppointmentPriority)}
        />
        {inQueue && (
          <Textarea
            label="Reason"
            hint="Required once the patient is in the queue."
            value={reason}
            error={reasonError}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </div>
    </Modal>
  );
}
