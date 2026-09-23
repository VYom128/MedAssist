import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import Select from '../../../components/ui/Select';
import { ROLE_LABELS, STAFF_ROLES } from '../../../constants/roles';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useCreateUserMutation } from '../api';
import { staffSchema, withoutEmptyPhone, type StaffFormValues } from '../schemas';

const ROLE_OPTIONS = STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

/** POST /users – the new user gets an email with a link to set their password. */
export default function AddStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [createUser, { isLoading }] = useCreateUserMutation();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '', role: undefined },
  });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const user = await createUser(withoutEmptyPhone(values) as StaffFormValues).unwrap();
      toast.success(
        `${user.firstName} ${user.lastName} added. A set-password link has been emailed.`,
      );
      close();
    } catch (err) {
      const fields = ['firstName', 'lastName', 'email', 'phone', 'role'] as const;
      if (!applyServerFieldErrors(err, setError, fields)) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <Modal
      open={open}
      title="Add staff"
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="add-staff-form" loading={isLoading}>
            Add staff
          </Button>
        </>
      }
    >
      <form id="add-staff-form" onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" error={errors.firstName?.message} {...register('firstName')} />
          <Input label="Last name" error={errors.lastName?.message} {...register('lastName')} />
        </div>
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Input
          label="Mobile number (optional)"
          type="tel"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Select
          label="Role"
          placeholder="Choose a role"
          options={ROLE_OPTIONS}
          error={errors.role?.message}
          {...register('role')}
        />
        <p className="text-xs text-slate-500">
          They will get an email with a link to set their password (valid 72 hours).
        </p>
      </form>
    </Modal>
  );
}
