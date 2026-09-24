import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import FormSection from '../../../components/ui/FormSection';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import MoneyInput from '../../../components/ui/MoneyInput';
import Select from '../../../components/ui/Select';
import { optionsOf, SERVICE_TYPE_LABELS, SERVICE_TYPES } from '../../../constants/catalog';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { bpsToPercent } from '../../../utils/money';
import { useListDepartmentsQuery } from '../../departments/api';
import { useCreateServiceMutation, useUpdateServiceMutation, type AdminService } from '../api';
import {
  serviceSchema,
  toServiceInput,
  type ServiceFormInput,
  type ServiceFormValues,
} from '../schemas';

const FIELDS = [
  'code',
  'name',
  'department',
  'type',
  'durationMinutes',
  'pricePaise',
  'taxPercent',
] as const;

/** Create (no `service`) or edit a service. Price is typed in rupees and sent in paise. */
export default function ServiceFormModal({
  open,
  service,
  onClose,
}: {
  open: boolean;
  service?: AdminService | null;
  onClose: () => void;
}) {
  const [create, { isLoading: creating }] = useCreateServiceMutation();
  const [update, { isLoading: updating }] = useUpdateServiceMutation();
  const departments = useListDepartmentsQuery({ limit: 100 }, { skip: !open });
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<ServiceFormInput, unknown, ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
  });

  useEffect(() => {
    if (!open) return;
    reset({
      code: service?.code ?? '',
      name: service?.name ?? '',
      department: service?.department?.id ?? '',
      type: service?.type ?? 'consultation',
      durationMinutes: service?.durationMinutes ?? 15,
      pricePaise: service?.pricePaise ?? null,
      taxPercent: service?.taxRateBps != null ? String(bpsToPercent(service.taxRateBps)) : '',
    });
  }, [open, service, reset]);

  const departmentOptions = [
    { value: '', label: 'Clinic-wide (no department)' },
    ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
    // Keep the current (possibly inactive) department selectable when editing.
    ...(service?.department && !departments.data?.items.some((d) => d.id === service.department?.id)
      ? [{ value: service.department.id, label: `${service.department.name} (inactive)` }]
      : []),
  ];

  const onSubmit = handleSubmit(async (values) => {
    try {
      const body = toServiceInput(values);
      if (service) {
        await update({ id: service.id, body }).unwrap();
        toast.success('Service updated');
      } else {
        await create(body).unwrap();
        toast.success(`${values.name} added`);
      }
      onClose();
    } catch (err) {
      if (isApiQueryError(err) && err.code === 'CONFLICT') {
        setError('code', { message: 'Another service already uses this code' });
        return;
      }
      if (!applyServerFieldErrors(err, setError, FIELDS, { taxRateBps: 'taxPercent' })) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <Modal
      open={open}
      size="lg"
      title={service ? `Edit ${service.name}` : 'Add service'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="service-form"
            loading={creating || updating}
            disabled={Boolean(service) && !isDirty}
          >
            {service ? 'Save changes' : 'Add service'}
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={onSubmit} noValidate className="space-y-6">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <FormSection title="Service">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Code"
              hint="e.g. CONS-GEN"
              autoCapitalize="characters"
              error={errors.code?.message}
              {...register('code')}
            />
            <Input
              label="Name"
              className="sm:col-span-2"
              error={errors.name?.message}
              {...register('name')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Department"
              options={departmentOptions}
              error={errors.department?.message}
              {...register('department')}
            />
            <Select
              label="Type"
              options={optionsOf(SERVICE_TYPES, SERVICE_TYPE_LABELS)}
              error={errors.type?.message}
              {...register('type')}
            />
          </div>
        </FormSection>
        <FormSection
          title="Price and time"
          description="Price changes apply to new invoices only; existing invoices keep the price they were issued with."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Controller
              control={control}
              name="pricePaise"
              render={({ field }) => (
                <MoneyInput
                  label="Price"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  name={field.name}
                  ref={field.ref}
                  error={errors.pricePaise?.message}
                />
              )}
            />
            <Input
              label="Duration (minutes)"
              type="number"
              inputMode="numeric"
              error={errors.durationMinutes?.message}
              {...register('durationMinutes', { valueAsNumber: true })}
            />
            <Input
              label="Tax (%)"
              inputMode="decimal"
              placeholder="Clinic default"
              hint="Leave empty to use the clinic default"
              error={errors.taxPercent?.message}
              {...register('taxPercent')}
            />
          </div>
        </FormSection>
      </form>
    </Modal>
  );
}
