import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useResetPasswordMutation } from '../api';
import AuthCard from '../components/AuthCard';
import PasswordField from '../components/PasswordField';
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
      await resetPassword({ token, password }).unwrap();
      navigate('/login', {
        replace: true,
        state: { notice: 'Your password has been set. Please sign in.' },
      });
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['password'])) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <AuthCard
      title="Choose a new password"
      footer={
        <Link to="/forgot-password" className="font-semibold text-brand-600 hover:underline">
          Need a new link?
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <Button type="submit" fullWidth loading={isLoading}>
          Set password
        </Button>
      </form>
    </AuthCard>
  );
}
