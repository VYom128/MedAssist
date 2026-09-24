import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { LockKeyhole } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useResetPasswordMutation } from '../api';
import AuthCard from '../components/AuthCard';
import { authLinkClass } from '../components/authStyles';
import PasswordInput from '../../../components/ui/PasswordInput';
import { resetPasswordSchema, type ResetPasswordValues } from '../schemas';

/** Reset link from email (also used to set the first password of new staff accounts). */
export default function ResetPasswordPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const [resetPassword, { isLoading }] = useResetPasswordMutation();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await resetPassword({ token, newPassword: password }).unwrap();
      toast.success('Your password has been set. Please sign in.');
      navigate('/login', { replace: true });
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['password'], { newPassword: 'password' })) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="Pick a password you don't use anywhere else."
      icon={LockKeyhole}
      footer={
        <Link to="/forgot-password" className={authLinkClass}>
          Need a new link?
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-2">
        {errors.root && (
          <div className="pb-3 motion-safe:animate-fade-in">
            <Alert tone="error">{errors.root.message}</Alert>
          </div>
        )}
        <PasswordInput
          label="New password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number. Avoid your name or email."
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordInput
          label="Confirm new password"
          autoComplete="new-password"
          reserveMessage
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" fullWidth loading={isLoading} className="mt-2">
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}
