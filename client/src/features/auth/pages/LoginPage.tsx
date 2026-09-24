import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { homeFor } from '../../../routes/home';
import { applyServerFieldErrors, safeNextPath } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useLoginMutation } from '../api';
import AuthCard from '../components/AuthCard';
import { authLinkClass } from '../components/authStyles';
import PasswordInput from '../../../components/ui/PasswordInput';
import { loginSchema, type LoginValues } from '../schemas';

export default function LoginPage() {
  const [login, { isLoading }] = useLoginMutation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const { user } = await login(values).unwrap();
      const home = homeFor(user);
      navigate(
        user.mustChangePassword ? '/change-password' : (safeNextPath(params.get('next')) ?? home),
        {
          replace: true,
        },
      );
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['email', 'password'])) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <AuthCard
      title="Sign in"
      subtitle="Use your MedAssist account"
      footer={
        <>
          New patient?{' '}
          <Link to="/register" className={authLinkClass}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-2">
        {errors.root && (
          <div className="pb-3 motion-safe:animate-fade-in">
            <Alert tone="error">{errors.root.message}</Alert>
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
        <PasswordInput
          label="Password"
          autoComplete="current-password"
          reserveMessage
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex justify-end pb-2">
          <Link to="/forgot-password" className={`text-sm ${authLinkClass}`}>
            Forgot password?
          </Link>
        </div>
        <Button type="submit" fullWidth loading={isLoading}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
