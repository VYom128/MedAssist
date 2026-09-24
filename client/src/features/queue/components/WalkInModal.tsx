import { useMemo, useState } from 'react';
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
import { formatTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { useWalkInMutation } from '../../appointments/api';
import { useGetDoctorQuery } from '../../doctors/api';
import DoctorPicker from '../../doctors/components/DoctorPicker';
import type { PatientListItem } from '../../patients/api';
import PatientPicker from '../../patients/components/PatientPicker';
import { useListServicesQuery } from '../../services/api';

const PRIORITY_OPTIONS = optionsOf(APPOINTMENT_PRIORITIES, APPOINTMENT_PRIORITY_LABELS);

/**
 * Register a patient who has just arrived (spec §4.5): they get the doctor's next free slot in the
 * session running now, or an overbook place, and are checked in with a token straight away. The
 * parent gives it a new `key` each time it opens.
 */
export default function WalkInModal({
  open,
  onClose,
  doctorId: initialDoctor = '',
}: {
  open: boolean;
  onClose: () => void;
  doctorId?: string;
}) {
  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [departmentId, setDepartmentId] = useState('');
  const [doctorId, setDoctorId] = useState(initialDoctor);
  const [serviceId, setServiceId] = useState('');
  const [priority, setPriority] = useState<AppointmentPriority>('normal');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [walkIn, { isLoading }] = useWalkInMutation();

  const services = useListServicesQuery({ limit: 100 }, { skip: !open });
  const doctor = useGetDoctorQuery(doctorId, { skip: !open || !doctorId });
  const dept = doctor.data?.department?.id;
  const serviceOptions = useMemo(
    () =>
      (services.data?.items ?? [])
        .filter((s) => !s.department || s.department.id === dept)
        .sort((a, b) => Number(b.type === 'consultation') - Number(a.type === 'consultation'))
        .map((s) => ({ value: s.id, label: `${s.name} (${s.durationMinutes} min)` })),
    [services.data, dept],
  );
  // Default to the department's consultation until reception picks another service.
  const effectiveService =
    serviceOptions.find((o) => o.value === serviceId)?.value ?? serviceOptions[0]?.value ?? '';

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!patient) next.patient = 'Choose a patient';
    if (!doctorId) next.doctor = 'Choose a doctor';
    if (!effectiveService) next.service = 'Choose a service';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    try {
      const created = await walkIn({
        patientId: patient!.id,
        doctorId,
        serviceId: effectiveService,
        priority,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }).unwrap();
      toast.success(
        `${patient!.fullName} checked in – token ${created.tokenNumber ?? '–'}` +
          (created.isOverbook ? ' (overbooked)' : ` for ${formatTime(created.startAt)}`),
      );
      onClose();
    } catch (err) {
      setErrors({ root: getQueryErrorMessage(err) });
    }
  };

  return (
    <Modal
      open={open}
      title="Walk-in patient"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={isLoading}>
            Check in walk-in
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted">
          The patient gets the doctor's next free time in the session running now, or one of the
          session's overbook places, and is checked in straight away.
        </p>
        {errors.root && <Alert tone="error">{errors.root}</Alert>}
        <PatientPicker
          value={patient}
          onChange={setPatient}
          error={errors.patient}
          registerHref="/reception/patients/new"
        />
        <DoctorPicker
          departmentId={departmentId}
          doctorId={doctorId}
          doctorError={errors.doctor}
          onDepartmentChange={setDepartmentId}
          onDoctorChange={(id) => {
            setDoctorId(id);
            setServiceId('');
          }}
        />
        {doctorId && (
          <Select
            label="Service"
            options={serviceOptions}
            value={effectiveService}
            error={errors.service}
            onChange={(e) => setServiceId(e.target.value)}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Priority"
            options={PRIORITY_OPTIONS}
            value={priority}
            onChange={(e) => setPriority(e.target.value as AppointmentPriority)}
          />
        </div>
        <Textarea
          label="Reason for visit (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}
