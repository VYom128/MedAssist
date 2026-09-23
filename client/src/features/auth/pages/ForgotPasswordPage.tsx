import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { getQueryErrorMessage } from '../../../utils/http';
import { useForgotPasswordMutation } from '../api';
import AuthCard from '../components/AuthCard';
import { forgotPasswordSchema, type ForgotPasswordValues } from '../schemas';

export default function ForgotPasswordPage() {
  const [forgotPassword, { isLoading, isSuccess, data: message, error }] =
    useForgotPasswordMutation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordValues>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(async (values) => {
    await forgotPassword(values)
      .unwrap()
      .catch(() => undefined);
  });

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we will send you a link to reset it."
      footer={
        <Link to="/login" className="font-semibold text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {isSuccess ? (
        <Alert tone="success" title="Check your email">
          {message}. The link expires in 30 minutes.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {error && <Alert tone="error">{getQueryErrorMessage(error)}</Alert>}
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Button type="submit" fullWidth loading={isLoading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
