import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { ROLE_HOME } from '../../../constants/roles';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useChangePasswordMutation } from '../api';
import { selectCurrentUser } from '../authSlice';
import PasswordInput from '../../../components/ui/PasswordInput';
import { changePasswordSchema, type ChangePasswordValues } from '../schemas';

export default function ChangePasswordPage() {
  const user = useAppSelector(selectCurrentUser);
  const navigate = useNavigate();
  const [changePassword, { isLoading }] = useChangePasswordMutation();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) });

  const forced = user?.mustChangePassword ?? false;

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      const result = await changePassword({ currentPassword, newPassword }).unwrap();
      reset();
      toast.success('Your password has been changed. Other devices have been signed out.');
      navigate(ROLE_HOME[result.user.role], { replace: true });
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['currentPassword', 'newPassword'])) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <section className="mx-auto w-full max-w-lg">
      <PageHeader
        title="Change password"
        description="Changing your password signs you out on all other devices."
      />
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {forced && (
            <Alert tone="warning" title="Please set a new password">
              Your account was set up with a temporary password, or an administrator asked for a new
              one. Choose your own password to continue; the rest of MedAssist opens afterwards.
            </Alert>
          )}
          {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
          <PasswordInput
            label="Current password"
            autoComplete="current-password"
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            hint="At least 8 characters, with a letter and a number. Avoid your name or email."
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <PasswordInput
            label="Confirm new password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <Button type="submit" loading={isLoading}>
            Change password
          </Button>
        </form>
      </div>
    </section>
  );
}
