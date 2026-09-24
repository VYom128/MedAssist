import Input from '../../../components/ui/Input';
import Switch from '../../../components/ui/Switch';
import Textarea from '../../../components/ui/Textarea';
import { MAX_FOLLOW_UP_DAYS, NOTE_TEXT_LIMITS } from '../../../constants/catalog';
import { addDaysToDate, clinicDate } from '../../../utils/dates';
import type { FollowUp, NoteChanges } from '../api';
import { fieldId, followUpProblem } from '../fields';

/** Follow-up plan (spec §4.7): needed? then after N days OR on a date, plus instructions. */
export default function FollowUpFields({
  followUp,
  onChange,
  onBlur,
}: {
  followUp: FollowUp;
  onChange: (changes: NoteChanges) => void;
  onBlur?: () => void;
}) {
  const set = (patch: Partial<FollowUp>) => onChange({ followUp: { ...followUp, ...patch } });
  const problem = followUpProblem(followUp);
  const mode = followUp.date !== null ? 'date' : 'days';
  return (
    <div className="space-y-4">
      <Switch
        label="Follow-up needed"
        checked={followUp.required}
        onChange={(required) =>
          onChange({
            followUp: required
              ? { ...followUp, required }
              : {
                  required: false,
                  afterDays: null,
                  date: null,
                  instructions: followUp.instructions,
                },
          })
        }
      />
      {followUp.required && (
        <>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">When</legend>
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="follow-up-mode"
                checked={mode === 'days'}
                onChange={() => set({ date: null, afterDays: followUp.afterDays ?? 7 })}
                className="h-4 w-4 accent-primary-600"
              />
              After a number of days
            </label>
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="follow-up-mode"
                checked={mode === 'date'}
                onChange={() => set({ afterDays: null, date: addDaysToDate(clinicDate(), 7) })}
                className="h-4 w-4 accent-primary-600"
              />
              On a date
            </label>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'days' ? (
              <Input
                id={fieldId('followUp.afterDays')}
                label="After (days)"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_FOLLOW_UP_DAYS}
                value={followUp.afterDays ?? ''}
                onChange={(e) => {
                  const n = e.target.value === '' ? null : Math.round(Number(e.target.value));
                  if (n === null || (n >= 1 && n <= MAX_FOLLOW_UP_DAYS)) set({ afterDays: n });
                }}
                onBlur={onBlur}
              />
            ) : (
              <Input
                id={fieldId('followUp.date')}
                label="Date"
                type="date"
                min={addDaysToDate(clinicDate(), 1)}
                value={followUp.date ?? ''}
                error={problem ?? undefined}
                onChange={(e) => set({ date: e.target.value || null })}
                onBlur={onBlur}
              />
            )}
          </div>
        </>
      )}
      <Textarea
        id={fieldId('followUp.instructions')}
        label="Instructions"
        autoGrow
        maxLength={NOTE_TEXT_LIMITS.followUpInstructions}
        value={followUp.instructions ?? ''}
        onChange={(e) => set({ instructions: e.target.value || null })}
        onBlur={onBlur}
      />
    </div>
  );
}
