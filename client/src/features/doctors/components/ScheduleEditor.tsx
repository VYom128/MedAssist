import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
} from 'react-hook-form';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import TimeInput from '../../../components/ui/TimeInput';
import { WEEKDAY_NAMES } from '../../../constants/catalog';
import { clinicDate, minutesOf } from '../../../utils/dates';
import { applyServerFieldErrorsByPath } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import type { ScheduleInput } from '../api';
import {
  scheduleFormSchema,
  toScheduleInput,
  weeklyHours,
  type ScheduleFormValues,
} from '../schemas';

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** A sensible next session: 09:00–13:00 first, then 17:00–20:00, then an hour after the last. */
function nextSession(existing: { start: string; end: string }[]) {
  if (existing.length === 0) return { start: '09:00', end: '13:00' };
  const lastEnd = Math.max(...existing.map((s) => minutesOf(s.end) || 0));
  const start = Math.max(lastEnd + 60, 17 * 60);
  if (start + 60 > 24 * 60 - 5) return { start: '20:00', end: '21:00' };
  return { start: hhmm(start), end: hhmm(Math.min(start + 180, 23 * 60 + 55)) };
}

function DayRow({
  index,
  control,
  register,
  errors,
}: {
  index: number;
  control: Control<ScheduleFormValues>;
  register: UseFormRegister<ScheduleFormValues>;
  errors: ReturnType<typeof useForm<ScheduleFormValues>>['formState']['errors'];
}) {
  const { fields, append, remove } = useFieldArray({ control, name: `days.${index}.sessions` });
  const weekday = useWatch({ control, name: `days.${index}.weekday` });
  const sessions = useWatch({ control, name: `days.${index}.sessions` }) ?? [];
  const name = WEEKDAY_NAMES[weekday] ?? '';
  const dayErrors = errors.days?.[index]?.sessions;

  return (
    <fieldset
      aria-label={name}
      className="grid gap-3 border-b border-slate-100 py-4 last:border-0 sm:grid-cols-[8rem_1fr]"
    >
      <legend className="sr-only">{name}</legend>
      <div className="flex items-center justify-between sm:block">
        <p aria-hidden="true" className="font-medium text-slate-800">
          {name}
        </p>
        <p className="text-xs text-slate-500">{fields.length === 0 ? 'Day off' : ''}</p>
      </div>
      <div className="space-y-3">
        {fields.map((field, i) => (
          <div key={field.id} className="flex flex-wrap items-start gap-3">
            <TimeInput
              label="Start"
              className="w-32"
              error={dayErrors?.[i]?.start?.message}
              {...register(`days.${index}.sessions.${i}.start`)}
            />
            <TimeInput
              label="End"
              className="w-32"
              error={dayErrors?.[i]?.end?.message}
              {...register(`days.${index}.sessions.${i}.end`)}
            />
            <Button
              variant="ghost"
              className="mt-6 !px-2"
              onClick={() => remove(i)}
              aria-label={`Remove ${name} session ${i + 1}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        {dayErrors?.message && <p className="text-sm text-rose-600">{dayErrors.message}</p>}
        {fields.length < 6 && (
          <Button
            variant="secondary"
            className="!px-3 !py-1"
            onClick={() => append(nextSession(sessions))}
            aria-label={`Add ${name} session`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Add session
          </Button>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Weekly template editor (spec §6.9): Mon–Sun rows, several sessions a day, inline overlap
 * errors, an "effective from" date and a preview of the weekly hours. `onSave` receives the PUT
 * body; a rejected promise's VALIDATION_ERROR details are shown on the fields.
 */
export default function ScheduleEditor({
  initial,
  onSave,
  saving,
}: {
  initial: ScheduleFormValues;
  onSave: (body: ScheduleInput) => Promise<unknown>;
  saving: boolean;
}) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<ScheduleFormValues>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: initial,
  });
  const days = useWatch({ control, name: 'days' });
  const today = clinicDate();

  useEffect(() => {
    reset(initial);
  }, [initial, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (values.effectiveFrom < today) {
      setError('effectiveFrom', { message: 'Choose today or a later date' });
      return;
    }
    try {
      await onSave(toScheduleInput(values));
    } catch (err) {
      // Server paths refer to the payload's days (weekday order); map them back to rows.
      const payload = toScheduleInput(values);
      const handled = applyServerFieldErrorsByPath(err, setError, (path) => {
        const m = /^days\.(\d+)\.(.*)$/.exec(path);
        if (!m) return path === 'effectiveFrom' ? path : null;
        const weekday = payload.days[Number(m[1])]?.weekday;
        const row = values.days.findIndex((d) => d.weekday === weekday);
        return row >= 0 ? `days.${row}.${m[2]}` : null;
      });
      if (!handled) setError('root', { message: getQueryErrorMessage(err) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      {errors.root && (
        <div className="mb-4">
          <Alert tone="error">{errors.root.message}</Alert>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[16rem_1fr] sm:items-end">
        <Input
          label="Effective from"
          type="date"
          min={today}
          error={errors.effectiveFrom?.message}
          {...register('effectiveFrom')}
        />
        <p className="text-sm text-slate-600" aria-live="polite">
          Total: <span className="font-semibold">{weeklyHours({ days: days ?? [] })} hours</span> a
          week
        </p>
      </div>
      <div className="mt-2">
        {initial.days.map((d, i) => (
          <DayRow key={d.weekday} index={i} control={control} register={register} errors={errors} />
        ))}
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={!isDirty || saving} onClick={() => reset(initial)}>
          Discard changes
        </Button>
        <Button type="submit" loading={saving}>
          Save schedule
        </Button>
      </div>
    </form>
  );
}
