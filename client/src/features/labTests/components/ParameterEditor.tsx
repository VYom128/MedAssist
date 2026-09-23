import { Plus, Trash2 } from 'lucide-react';
import { Controller, get, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import TagInput from '../../../components/ui/TagInput';
import { LAB_VALUE_TYPES, optionsOf, RANGE_GENDERS } from '../../../constants/catalog';
import { emptyRange, type LabTestFormInput } from '../schemas';

const VALUE_TYPE_LABELS = { number: 'Number', text: 'Text', option: 'Choice from a list' };
const GENDER_LABELS = { any: 'Any', male: 'Male', female: 'Female' };

function useError() {
  const {
    formState: { errors },
  } = useFormContext<LabTestFormInput>();
  return (path: string) => get(errors, path)?.message as string | undefined;
}

/** Reference ranges of one numeric parameter (a nested field array). */
function RangeRows({ index }: { index: number }) {
  const { control, register } = useFormContext<LabTestFormInput>();
  const error = useError();
  const { fields, append, remove } = useFieldArray({
    control,
    name: `parameters.${index}.ranges`,
  });
  const base = `parameters.${index}.ranges` as const;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">Reference ranges</p>
      {fields.length === 0 && (
        <p className="text-sm text-slate-500">No range: values are shown without a flag.</p>
      )}
      {fields.map((field, j) => (
        <fieldset
          key={field.id}
          aria-label={`Parameter ${index + 1}, range ${j + 1}`}
          className="rounded-lg border border-slate-200 bg-slate-50 p-3"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <Select
              label="Gender"
              options={optionsOf(RANGE_GENDERS, GENDER_LABELS)}
              error={error(`${base}.${j}.gender`)}
              {...register(`${base}.${j}.gender`)}
            />
            <Input
              label="Age from"
              inputMode="numeric"
              error={error(`${base}.${j}.ageMinYears`)}
              {...register(`${base}.${j}.ageMinYears`)}
            />
            <Input
              label="Age to"
              inputMode="numeric"
              error={error(`${base}.${j}.ageMaxYears`)}
              {...register(`${base}.${j}.ageMaxYears`)}
            />
            <Input
              label="Low"
              inputMode="decimal"
              error={error(`${base}.${j}.low`)}
              {...register(`${base}.${j}.low`)}
            />
            <Input
              label="High"
              inputMode="decimal"
              error={error(`${base}.${j}.high`)}
              {...register(`${base}.${j}.high`)}
            />
            <Input
              label="Critical low"
              inputMode="decimal"
              error={error(`${base}.${j}.criticalLow`)}
              {...register(`${base}.${j}.criticalLow`)}
            />
            <Input
              label="Critical high"
              inputMode="decimal"
              error={error(`${base}.${j}.criticalHigh`)}
              {...register(`${base}.${j}.criticalHigh`)}
            />
            <div className="flex items-end">
              <Button
                variant="ghost"
                className="!px-2"
                onClick={() => remove(j)}
                aria-label={`Remove range ${j + 1} of parameter ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <Input
            label="Reference text (optional)"
            placeholder="e.g. < 200 desirable"
            className="mt-3"
            error={error(`${base}.${j}.text`)}
            {...register(`${base}.${j}.text`)}
          />
        </fieldset>
      ))}
      {fields.length < 20 && (
        <Button
          variant="secondary"
          className="!px-3 !py-1"
          onClick={() => append(emptyRange())}
          aria-label={`Add range to parameter ${index + 1}`}
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add range
        </Button>
      )}
    </div>
  );
}

/** One parameter of a lab test: key, name, unit, type and its options or reference ranges. */
export default function ParameterEditor({
  index,
  onRemove,
  canRemove,
}: {
  index: number;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const { control, register } = useFormContext<LabTestFormInput>();
  const error = useError();
  const valueType = useWatch({ control, name: `parameters.${index}.valueType` });
  const base = `parameters.${index}` as const;

  return (
    <fieldset
      aria-label={`Parameter ${index + 1}`}
      className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Parameter {index + 1}</h3>
        {canRemove && (
          <Button
            variant="ghost"
            className="!px-2 !py-1"
            onClick={onRemove}
            aria-label={`Remove parameter ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
          </Button>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Input
          label="Key"
          placeholder="hb"
          error={error(`${base}.key`)}
          {...register(`${base}.key`)}
        />
        <Input
          label="Name"
          placeholder="Haemoglobin"
          className="sm:col-span-2"
          error={error(`${base}.name`)}
          {...register(`${base}.name`)}
        />
        <Input
          label="Unit"
          placeholder="g/dL"
          error={error(`${base}.unit`)}
          {...register(`${base}.unit`)}
        />
        <Select
          label="Value type"
          options={optionsOf(LAB_VALUE_TYPES, VALUE_TYPE_LABELS)}
          error={error(`${base}.valueType`)}
          {...register(`${base}.valueType`)}
        />
      </div>
      {valueType === 'option' && (
        <Controller
          control={control}
          name={`${base}.options`}
          render={({ field }) => (
            <TagInput
              label="Options"
              value={field.value}
              onChange={field.onChange}
              maxTags={20}
              maxLength={40}
              placeholder="e.g. Negative, then Enter"
              error={error(`${base}.options`)}
            />
          )}
        />
      )}
      {valueType === 'number' && <RangeRows index={index} />}
    </fieldset>
  );
}
