import { useState } from 'react';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Textarea from '../../../components/ui/Textarea';
import { clinicDate, formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import DoctorPicker from '../../doctors/components/DoctorPicker';
import { useGetSlotsQuery, useRescheduleAppointmentMutation, type Appointment } from '../api';
import { staffReason } from '../schemas';
import DateAvailabilityPicker from './DateAvailabilityPicker';
import SlotPicker from './SlotPicker';

/**
 * Staff move an appointment (spec §4.5): same service, another date/time or doctor, with a
 * reason. The old slot is released only if the new one is taken (server transaction); if the time
 * was just taken the free times reload. The parent gives it a new `key` each time it opens.
 */
export default function RescheduleModal({
  appointment,
  open,
  onClose,
}: {
  appointment: Appointment;
  open: boolean;
  onClose: () => void;
}) {
  const [departmentId, setDepartmentId] = useState(appointment.department?.id ?? '');
  const [doctorId, setDoctorId] = useState(appointment.doctor.id);
  const [date, setDate] = useState(() =>
    clinicDate(appointment.startAt) < clinicDate() ? clinicDate() : clinicDate(appointment.startAt),
  );
  const [startAt, setStartAt] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ startAt?: string; reason?: string; root?: string }>({});
  const [reschedule, { isLoading }] = useRescheduleAppointmentMutation();
  const serviceId = appointment.service.id ?? undefined;

  const slots = useGetSlotsQuery(
    { doctorId, date, ...(serviceId ? { serviceId } : {}) },
    { skip: !open || !doctorId || !date },
  );

  const submit = async () => {
    const next: typeof errors = {};
    if (!startAt) next.startAt = 'Choose a new time';
    const checked = staffReason.safeParse(reason);
    if (!checked.success) next.reason = checked.error.issues[0]?.message;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      const moved = await reschedule({
        id: appointment.id,
        body: {
          startAt,
          reason: reason.trim(),
          ...(doctorId !== appointment.doctor.id ? { doctorId } : {}),
        },
      }).unwrap();
      toast.success(`Moved to ${formatDateTime(moved.startAt)}`);
      onClose();
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'SLOT_UNAVAILABLE') {
        setStartAt('');
        setErrors({ startAt: err.message });
        return; // the mutation's tags refresh the free times, even on failure
      }
      setErrors({ root: getQueryErrorMessage(err) });
    }
  };

  return (
    <Modal
      open={open}
      title={`Reschedule ${appointment.appointmentNumber}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isLoading}>
            Reschedule
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted">
          Now: <span className="font-medium text-ink">{formatDateTime(appointment.startAt)}</span>{' '}
          with {appointment.doctor.name} ({appointment.service.name}).
        </p>
        {errors.root && <Alert tone="error">{errors.root}</Alert>}
        <DoctorPicker
          departmentId={departmentId}
          doctorId={doctorId}
          onDepartmentChange={setDepartmentId}
          onDoctorChange={(id) => {
            setDoctorId(id);
            setStartAt('');
          }}
        />
        {doctorId && (
          <DateAvailabilityPicker
            doctorId={doctorId}
            serviceId={serviceId}
            value={date}
            onChange={(d) => {
              setDate(d);
              setStartAt('');
            }}
          />
        )}
        {doctorId && date && (
          <SlotPicker
            label="New time"
            slots={slots.data?.slots}
            loading={slots.isFetching && !slots.data}
            value={startAt}
            error={errors.startAt}
            onChange={(v) => {
              setStartAt(v);
              setErrors((e) => ({ ...e, startAt: undefined }));
            }}
          />
        )}
        <Textarea
          label="Reason"
          hint="Kept with the appointment's history."
          value={reason}
          error={errors.reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}
