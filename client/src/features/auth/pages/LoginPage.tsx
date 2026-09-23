import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { ROLE_HOME } from '../../../constants/roles';
import { applyServerFieldErrors, safeNextPath } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useLoginMutation } from '../api';
import AuthCard from '../components/AuthCard';
import PasswordField from '../components/PasswordField';
import { loginSchema, type LoginValues } from '../schemas';

export default function LoginPage() {
  const [login, { isLoading }] = useLoginMutation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const { user } = await login(values).unwrap();
      const home = ROLE_HOME[user.role];
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
          <Link to="/register" className="font-semibold text-brand-600 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {notice && <Alert tone="success">{notice}</Alert>}
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-brand-600 hover:underline">
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
