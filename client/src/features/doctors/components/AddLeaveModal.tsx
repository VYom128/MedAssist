import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import TimeInput from '../../../components/ui/TimeInput';
import { LEAVE_TYPE_LABELS, LEAVE_TYPES, optionsOf } from '../../../constants/catalog';
import { clinicDate } from '../../../utils/dates';
import { getClinicTimezone } from '../../../utils/clinicTimezone';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import type { AffectedAppointment } from '../../appointments/api';
import { useCreateLeaveMutation } from '../api';
import { leaveFormSchema, toLeaveInput, type LeaveFormValues } from '../schemas';

const defaults = (): LeaveFormValues => ({
  mode: 'fullDay',
  date: clinicDate(),
  endDate: '',
  startTime: '09:00',
  endTime: '13:00',
  type: 'leave',
  reason: '',
});

/**
 * POST /doctors/:id/leaves (spec §4.13): whole day(s), or a time range on one day, entered in
 * clinic time (times are converted to UTC before sending).
 */
/** A radio option drawn as a selectable card (the native radio stays visible and focusable). */
const RADIO_CARD =
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-3 font-medium text-body transition-colors hover:border-line-control has-checked:border-primary-600 has-checked:bg-primary-50 has-checked:text-primary-700 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary-600';

export default function AddLeaveModal({
  doctorId,
  open,
  onClose,
  onSaved,
}: {
  doctorId: string;
  open: boolean;
  onClose: () => void;
  /** Gets the booked appointments the leave affects (spec §4.13). */
  onSaved?: (affected: AffectedAppointment[]) => void;
}) {
  const [createLeave, { isLoading }] = useCreateLeaveMutation();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<LeaveFormValues>({
    resolver: zodResolver(leaveFormSchema),
    defaultValues: defaults(),
  });
  const mode = useWatch({ control, name: 'mode' });

  useEffect(() => {
    if (open) reset(defaults());
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await createLeave({ id: doctorId, body: toLeaveInput(values) }).unwrap();
      toast.success('Leave recorded');
      onSaved?.(saved.affectedAppointments);
      onClose();
    } catch (err) {
      const fields = ['date', 'endDate', 'startTime', 'endTime', 'type', 'reason'] as const;
      const rename: Record<string, (typeof fields)[number]> = {
        startAt: mode === 'fullDay' ? 'date' : 'startTime',
        endAt: mode === 'fullDay' ? 'endDate' : 'endTime',
      };
      const applied = applyServerFieldErrors(err, setError, fields, rename);
      if (!applied) setError('root', { message: getQueryErrorMessage(err) });
    }
  });

  return (
    <Modal
      open={open}
      title="Add leave"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="leave-form" loading={isLoading}>
            Add leave
          </Button>
        </>
      }
    >
      <form id="leave-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <fieldset>
          <legend className="text-sm font-medium text-ink">Length</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-sm">
            <label className={RADIO_CARD}>
              <input
                type="radio"
                value="fullDay"
                className="h-4 w-4 accent-primary-600"
                {...register('mode')}
              />{' '}
              Full day(s)
            </label>
            <label className={RADIO_CARD}>
              <input
                type="radio"
                value="range"
                className="h-4 w-4 accent-primary-600"
                {...register('mode')}
              />{' '}
              Part of a day
            </label>
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={mode === 'fullDay' ? 'First day' : 'Date'}
            type="date"
            min={clinicDate()}
            error={errors.date?.message}
            {...register('date')}
          />
          {mode === 'fullDay' ? (
            <Input
              label="Last day (optional)"
              type="date"
              min={clinicDate()}
              error={errors.endDate?.message}
              {...register('endDate')}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <TimeInput
                label="From"
                error={errors.startTime?.message}
                {...register('startTime')}
              />
              <TimeInput label="To" error={errors.endTime?.message} {...register('endTime')} />
            </div>
          )}
        </div>
        <Select
          label="Type"
          options={optionsOf(LEAVE_TYPES, LEAVE_TYPE_LABELS)}
          error={errors.type?.message}
          {...register('type')}
        />
        <Textarea
          label="Reason (optional)"
          rows={2}
          error={errors.reason?.message}
          {...register('reason')}
        />
        <p className="text-xs text-muted">
          Times are in the clinic timezone ({getClinicTimezone()}).
        </p>
      </form>
    </Modal>
  );
}
