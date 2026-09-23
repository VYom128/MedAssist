import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Textarea from '../../../components/ui/Textarea';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import {
  useCreateDepartmentMutation,
  useUpdateDepartmentMutation,
  type AdminDepartment,
} from '../api';
import { departmentSchema, type DepartmentFormValues } from '../schemas';

const FIELDS = ['name', 'code', 'description'] as const;

/** Create (no `department`) or edit a department. */
export default function DepartmentFormModal({
  open,
  department,
  onClose,
}: {
  open: boolean;
  department?: AdminDepartment | null;
  onClose: () => void;
}) {
  const [create, { isLoading: creating }] = useCreateDepartmentMutation();
  const [update, { isLoading: updating }] = useUpdateDepartmentMutation();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<DepartmentFormValues>({ resolver: zodResolver(departmentSchema) });

  useEffect(() => {
    if (open) {
      reset({
        name: department?.name ?? '',
        code: department?.code ?? '',
        description: department?.description ?? '',
      });
    }
  }, [open, department, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (department) {
        await update({ id: department.id, body: values }).unwrap();
        toast.success('Department updated');
      } else {
        await create(values).unwrap();
        toast.success(`${values.name} added`);
      }
      onClose();
    } catch (err) {
      // 409 duplicate: the server names the clashing fields.
      if (isApiQueryError(err) && err.code === 'CONFLICT') {
        const fields = (err.details as { fields?: string[] } | undefined)?.fields ?? [];
        for (const f of fields.filter((x): x is (typeof FIELDS)[number] =>
          (FIELDS as readonly string[]).includes(x),
        )) {
          setError(f, { message: `Another department already uses this ${f}` });
        }
        if (fields.length > 0) return;
      }
      if (!applyServerFieldErrors(err, setError, FIELDS)) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  const title = department ? `Edit ${department.name}` : 'Add department';
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="department-form"
            loading={creating || updating}
            disabled={Boolean(department) && !isDirty}
          >
            {department ? 'Save changes' : 'Add department'}
          </Button>
        </>
      }
    >
      <form id="department-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Name"
            className="sm:col-span-2"
            error={errors.name?.message}
            {...register('name')}
          />
          <Input
            label="Code"
            maxLength={10}
            autoCapitalize="characters"
            hint="2–10 letters"
            error={errors.code?.message}
            {...register('code')}
          />
        </div>
        <Textarea
          label="Description (optional)"
          error={errors.description?.message}
          {...register('description')}
        />
      </form>
    </Modal>
  );
}
