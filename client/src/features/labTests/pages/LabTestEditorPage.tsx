import { zodResolver } from '@hookform/resolvers/zod';
import { FlaskConical, ListTree, Plus } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, FormProvider, useFieldArray, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useNavigate, useParams } from 'react-router-dom';
import StatusToggleButton from '../../../components/StatusToggleButton';
import Alert from '../../../components/ui/Alert';
import BackLink from '../../../components/ui/BackLink';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import MoneyInput from '../../../components/ui/MoneyInput';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import Select from '../../../components/ui/Select';
import Textarea from '../../../components/ui/Textarea';
import { LAB_SAMPLE_TYPES, LAB_TEST_CATEGORIES, optionsOf } from '../../../constants/catalog';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { applyServerFieldErrorsByPath } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import {
  useCreateLabTestMutation,
  useGetLabTestQuery,
  useLabTestActionMutation,
  useUpdateLabTestMutation,
  type LabTest,
} from '../api';
import ParameterEditor from '../components/ParameterEditor';
import {
  emptyLabTest,
  emptyParameter,
  labTestSchema,
  toLabTestForm,
  toLabTestInput,
  type LabTestFormInput,
  type LabTestFormValues,
} from '../schemas';

const TOP_FIELDS = [
  'code',
  'name',
  'category',
  'sampleType',
  'pricePaise',
  'turnaroundHours',
  'preparation',
];

/** /admin/lab-tests/new and /admin/lab-tests/:id – catalogue entry with parameters and ranges. */
export default function LabTestEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const query = useGetLabTestQuery(id ?? '', { skip: isNew });

  return (
    <section className="mx-auto w-full max-w-form">
      <BackLink to="/admin/lab-tests" label="Lab tests" />
      {isNew ? (
        <LabTestForm />
      ) : (
        <>
          {query.isLoading && <ListSkeleton label="Loading lab test…" rows={4} />}
          {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
          {query.data && <LabTestForm test={query.data} />}
        </>
      )}
    </section>
  );
}

function LabTestForm({ test }: { test?: LabTest }) {
  const navigate = useNavigate();
  const [create, { isLoading: creating }] = useCreateLabTestMutation();
  const [update, { isLoading: updating }] = useUpdateLabTestMutation();
  const [toggle] = useLabTestActionMutation();
  const form = useForm<LabTestFormInput, unknown, LabTestFormValues>({
    resolver: zodResolver(labTestSchema),
    defaultValues: test ? toLabTestForm(test) : emptyLabTest(),
  });
  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitSuccessful },
  } = form;
  const parameters = useFieldArray({ control, name: 'parameters' });
  const saving = creating || updating;
  const leaveDialog = useUnsavedChanges(isDirty && !saving && !isSubmitSuccessful);

  useEffect(() => {
    if (test) reset(toLabTestForm(test));
  }, [test, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const body = toLabTestInput(values);
      if (test) {
        const saved = await update({ id: test.id, body }).unwrap();
        reset(toLabTestForm(saved));
        toast.success('Lab test saved');
      } else {
        const saved = await create(body).unwrap();
        toast.success(`${saved.name} added`);
        navigate(`/admin/lab-tests/${saved.id}`, { replace: true });
      }
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'CONFLICT') {
        setError('code', { message: 'Another lab test already uses this code' });
        return;
      }
      const handled = applyServerFieldErrorsByPath(err, setError, (path) =>
        path.startsWith('parameters') || TOP_FIELDS.includes(path) ? path : null,
      );
      if (!handled) setError('root', { message: getQueryErrorMessage(err) });
    }
  });

  return (
    <FormProvider {...form}>
      <PageHeader
        title={test ? test.name : 'New lab test'}
        description="Parameters, units and reference ranges are used to flag results."
        actions={
          test && test.isActive !== undefined ? (
            <StatusToggleButton
              name={test.name}
              active={test.isActive}
              onToggle={(action) => toggle({ id: test.id, action }).unwrap()}
            />
          ) : undefined
        }
      />
      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <SectionCard
          title="Test"
          description="What is ordered and billed, and how long results take."
          icon={FlaskConical}
          iconTone="consult"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Code"
              hint="e.g. CBC"
              error={errors.code?.message}
              {...register('code')}
            />
            <Input
              label="Test name"
              className="sm:col-span-2"
              error={errors.name?.message}
              {...register('name')}
            />
            <Select
              label="Category"
              options={optionsOf(LAB_TEST_CATEGORIES)}
              error={errors.category?.message}
              {...register('category')}
            />
            <Select
              label="Sample type"
              options={optionsOf(LAB_SAMPLE_TYPES)}
              error={errors.sampleType?.message}
              {...register('sampleType')}
            />
            <Controller
              control={control}
              name="pricePaise"
              render={({ field }) => (
                <MoneyInput
                  label="Price"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  error={errors.pricePaise?.message}
                />
              )}
            />
            <Input
              label="Turnaround (hours)"
              inputMode="numeric"
              error={errors.turnaroundHours?.message}
              {...register('turnaroundHours')}
            />
            <Textarea
              label="Patient preparation (optional)"
              rows={2}
              className="sm:col-span-2"
              placeholder="e.g. Fasting 10–12 hours"
              error={errors.preparation?.message}
              {...register('preparation')}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Parameters"
          description="Each value the lab records, with its unit and reference ranges."
          icon={ListTree}
          bodyClassName="space-y-4"
        >
          {errors.parameters?.root?.message && (
            <Alert tone="error">{errors.parameters.root.message}</Alert>
          )}
          {errors.parameters?.message && <Alert tone="error">{errors.parameters.message}</Alert>}
          {parameters.fields.map((field, i) => (
            <ParameterEditor
              key={field.id}
              index={i}
              canRemove={parameters.fields.length > 1}
              onRemove={() => parameters.remove(i)}
            />
          ))}
          <Button variant="secondary" onClick={() => parameters.append(emptyParameter())}>
            <Plus className="h-4 w-4" aria-hidden="true" /> Add parameter
          </Button>
        </SectionCard>

        <div className="sticky bottom-0 z-10 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-surface/90 px-4 py-3 backdrop-blur-md sm:mx-0 sm:flex-row sm:justify-end sm:rounded-card sm:border sm:shadow-card-hover">
          <Button variant="secondary" onClick={() => navigate('/admin/lab-tests')}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={Boolean(test) && !isDirty}>
            {test ? 'Save changes' : 'Create lab test'}
          </Button>
        </div>
      </form>
      {leaveDialog}
    </FormProvider>
  );
}
