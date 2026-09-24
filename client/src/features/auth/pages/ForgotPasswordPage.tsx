import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { getQueryErrorMessage } from '../../../utils/http';
import { useForgotPasswordMutation } from '../api';
import AuthCard from '../components/AuthCard';
import { authLinkClass } from '../components/authStyles';
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
      icon={KeyRound}
      subtitle="Enter your email and we will send you a link to reset it."
      footer={
        <Link to="/login" className={authLinkClass}>
          Back to sign in
        </Link>
      }
    >
      {isSuccess ? (
        <Alert tone="success" title="Check your email">
          {message}. The link expires in 30 minutes.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-2">
          {error && (
            <div className="pb-3 motion-safe:animate-fade-in">
              <Alert tone="error">{getQueryErrorMessage(error)}</Alert>
            </div>
          )}
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            reserveMessage
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
