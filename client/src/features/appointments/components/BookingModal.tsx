import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
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
} from '../../../constants/catalog';
import { applyServerFieldErrors } from '../../../utils/forms';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { useGetDoctorQuery } from '../../doctors/api';
import DoctorPicker from '../../doctors/components/DoctorPicker';
import type { PatientListItem } from '../../patients/api';
import PatientPicker from '../../patients/components/PatientPicker';
import { useListServicesQuery } from '../../services/api';
import {
  useBookAppointmentMutation,
  useGetSlotsQuery,
  useListAppointmentsQuery,
  useUpdateAppointmentMutation,
  type Appointment,
} from '../api';
import { bookingSchema, type BookingFormValues } from '../schemas';
import DateAvailabilityPicker from './DateAvailabilityPicker';
import SlotPicker from './SlotPicker';

/** Values a caller can prefill (a clicked calendar slot, a patient page). */
export interface BookingPrefill {
  patient?: PatientListItem | null;
  departmentId?: string;
  doctorId?: string;
  date?: string;
  startAt?: string;
}

const PRIORITY_OPTIONS = optionsOf(APPOINTMENT_PRIORITIES, APPOINTMENT_PRIORITY_LABELS);
const FIELDS = [
  'patientId',
  'doctorId',
  'serviceId',
  'startAt',
  'type',
  'followUpOf',
  'reason',
] as const;

const defaults = (p: BookingPrefill = {}): BookingFormValues => ({
  patientId: p.patient?.id ?? '',
  departmentId: p.departmentId ?? '',
  doctorId: p.doctorId ?? '',
  serviceId: '',
  date: p.date ?? '',
  startAt: p.startAt ?? '',
  type: 'new',
  followUpOf: '',
  reason: '',
  priority: 'normal',
});

const RADIO_CARD =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-body transition-colors hover:border-line-control has-checked:border-primary-600 has-checked:bg-primary-50 has-checked:text-primary-700 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary-600';

/**
 * Reception books an appointment (spec §4.5, §13.4): patient → department → doctor → service →
 * date (free times per day) → time → type, reason, priority. If the time was just taken
 * (409 SLOT_UNAVAILABLE) the free times reload and everything else stays filled in. The parent
 * gives it a new `key` for each booking, so it starts from `prefill`.
 */
export default function BookingModal({
  open,
  onClose,
  prefill,
  onBooked,
}: {
  open: boolean;
  onClose: () => void;
  prefill?: BookingPrefill;
  onBooked?: (appointment: Appointment) => void;
}) {
  const [patient, setPatient] = useState<PatientListItem | null>(prefill?.patient ?? null);
  const [book, { isLoading: booking }] = useBookAppointmentMutation();
  const [update, { isLoading: updating }] = useUpdateAppointmentMutation();
  const {
    control,
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: defaults(prefill),
  });
  const [departmentId, doctorId, serviceId, date, startAt, type] = useWatch({
    control,
    name: ['departmentId', 'doctorId', 'serviceId', 'date', 'startAt', 'type'],
  });

  // Services of the doctor's department, and clinic-wide ones.
  const services = useListServicesQuery({ limit: 100 }, { skip: !open });
  const doctor = useGetDoctorQuery(doctorId, { skip: !open || !doctorId });
  const doctorDept = doctor.data?.department?.id ?? null;
  // Consultations of the department first (the usual choice), then the rest.
  const serviceOptions = useMemo(
    () =>
      (services.data?.items ?? [])
        .filter((s) => !s.department || (doctorDept && s.department.id === doctorDept))
        .sort((a, b) => Number(b.type === 'consultation') - Number(a.type === 'consultation'))
        .map((s) => ({ value: s.id, label: `${s.name} (${s.durationMinutes} min)` })),
    [services.data, doctorDept],
  );
  useEffect(() => {
    if (!doctorId || !doctorDept || serviceOptions.length === 0) return;
    if (!serviceOptions.some((o) => o.value === serviceId)) {
      setValue('serviceId', serviceOptions[0]!.value);
    }
  }, [doctorId, doctorDept, serviceOptions, serviceId, setValue]);

  const slots = useGetSlotsQuery(
    { doctorId, date, serviceId },
    { skip: !open || !doctorId || !date || !serviceId },
  );
  // A prefilled time (clicked in the calendar) must be one of the free slots.
  const staleStart = Boolean(
    slots.data && startAt && !slots.data.slots.some((s) => s.startAt === startAt),
  );

  const previous = useListAppointmentsQuery(
    { patient: patient?.id, status: 'completed', limit: 20, sort: '-startAt' },
    { skip: !open || !patient || type !== 'follow_up' },
  );

  const onSubmit = handleSubmit(async (values) => {
    if (staleStart) {
      setError('startAt', { type: 'manual', message: 'Choose one of the free times' });
      return;
    }
    try {
      const created = await book({
        patientId: values.patientId,
        doctorId: values.doctorId,
        serviceId: values.serviceId,
        startAt: values.startAt,
        type: values.type,
        reason: values.reason || undefined,
        ...(values.type === 'follow_up' ? { followUpOf: values.followUpOf } : {}),
      }).unwrap();
      // Priority is not part of booking (POST /appointments); set it right after.
      if (values.priority !== 'normal') {
        await update({ id: created.id, body: { priority: values.priority } })
          .unwrap()
          .catch(() => toast.error('Booked, but the priority could not be set'));
      }
      toast.success(`Booked ${created.appointmentNumber} for ${formatDateTime(created.startAt)}`);
      onBooked?.(created);
      onClose();
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'SLOT_UNAVAILABLE') {
        setValue('startAt', '');
        setError('startAt', { type: 'server', message: err.message });
        return; // the mutation's tags refresh the free times, even on failure
      }
      if (applyServerFieldErrors(err, setError, FIELDS)) return;
      setError('root', { message: getQueryErrorMessage(err) });
    }
  });

  return (
    <Modal
      open={open}
      title="Book appointment"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="booking-form" loading={booking || updating}>
            Book appointment
          </Button>
        </>
      }
    >
      <form id="booking-form" onSubmit={onSubmit} noValidate className="space-y-6">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}

        <PatientPicker
          value={patient}
          error={errors.patientId?.message}
          registerHref="/reception/patients/new"
          onChange={(p) => {
            setPatient(p);
            setValue('patientId', p?.id ?? '', { shouldValidate: Boolean(p) });
            setValue('followUpOf', '');
          }}
        />

        <DoctorPicker
          departmentId={departmentId}
          doctorId={doctorId}
          doctorError={errors.doctorId?.message}
          onDepartmentChange={(id) => setValue('departmentId', id)}
          onDoctorChange={(id, doctor) => {
            setValue('doctorId', id, { shouldValidate: Boolean(id) });
            setValue('startAt', '');
            if (doctor?.department && !departmentId) setValue('departmentId', doctor.department.id);
          }}
        />

        {doctorId && (
          <Select
            label="Service"
            placeholder="Choose a service"
            options={serviceOptions}
            error={errors.serviceId?.message}
            {...register('serviceId', { onChange: () => setValue('startAt', '') })}
          />
        )}

        {doctorId && serviceId && (
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <div>
                <DateAvailabilityPicker
                  doctorId={doctorId}
                  serviceId={serviceId}
                  value={field.value}
                  onChange={(d) => {
                    field.onChange(d);
                    setValue('startAt', '');
                  }}
                />
                {errors.date && (
                  <p className="mt-1.5 text-sm text-danger-700" role="alert">
                    {errors.date.message}
                  </p>
                )}
              </div>
            )}
          />
        )}

        {doctorId && serviceId && date && (
          <div>
            {staleStart && (
              <Alert tone="warning" title="Pick another time">
                The time you picked is not free for this service. Choose one of the free times.
              </Alert>
            )}
            <SlotPicker
              slots={slots.data?.slots}
              loading={slots.isFetching && !slots.data}
              value={startAt}
              error={errors.startAt?.message}
              onChange={(value) => {
                setValue('startAt', value);
                clearErrors('startAt');
              }}
            />
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-ink">Visit type</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <label className={RADIO_CARD}>
              <input
                type="radio"
                value="new"
                className="h-4 w-4 accent-primary-600"
                {...register('type')}
              />
              New visit
            </label>
            <label className={RADIO_CARD}>
              <input
                type="radio"
                value="follow_up"
                className="h-4 w-4 accent-primary-600"
                {...register('type')}
              />
              Follow-up
            </label>
          </div>
        </fieldset>

        {type === 'follow_up' && (
          <Select
            label="Follow-up of"
            placeholder={
              !patient
                ? 'Choose the patient first'
                : previous.isFetching
                  ? 'Loading visits…'
                  : previous.data?.items.length
                    ? 'Choose the earlier visit'
                    : 'No completed visits'
            }
            options={(previous.data?.items ?? []).map((a) => ({
              value: a.id,
              label: `${a.appointmentNumber} · ${formatDateTime(a.startAt)} · ${a.doctor.name}`,
            }))}
            error={errors.followUpOf?.message}
            {...register('followUpOf')}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Priority" options={PRIORITY_OPTIONS} {...register('priority')} />
        </div>
        <Textarea
          label="Reason for visit (optional)"
          hint="In the patient's words, e.g. “Fever for 3 days”."
          error={errors.reason?.message}
          {...register('reason')}
        />
      </form>
    </Modal>
  );
}
