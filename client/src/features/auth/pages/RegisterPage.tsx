import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { ROLE_HOME } from '../../../constants/roles';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useRegisterMutation } from '../api';
import AuthCard from '../components/AuthCard';
import PasswordField from '../components/PasswordField';
import { registerSchema, type RegisterValues } from '../schemas';

const FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'dateOfBirth',
  'password',
  'acceptTerms',
] as const;

/** Patient self-signup (spec §4.4). */
export default function RegisterPage() {
  const [registerPatient, { isLoading }] = useRegisterMutation();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async ({ confirmPassword: _confirm, ...values }) => {
    try {
      await registerPatient({ ...values, acceptTerms: true }).unwrap();
      navigate(ROLE_HOME.patient, { replace: true });
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, FIELDS)) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <AuthCard
      title="Create your patient account"
      subtitle="Book appointments and see your prescriptions, lab reports and bills."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            autoComplete="given-name"
            error={errors.firstName?.message}
            {...register('firstName')}
          />
          <Input
            label="Last name"
            autoComplete="family-name"
            error={errors.lastName?.message}
            {...register('lastName')}
          />
        </div>
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <Input
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          error={errors.phone?.message}
          {...register('phone')}
        />
        <Input
          label="Date of birth"
          type="date"
          autoComplete="bday"
          max={new Date().toISOString().slice(0, 10)}
          error={errors.dateOfBirth?.message}
          {...register('dateOfBirth')}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number. Avoid your name or email."
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordField
          label="Confirm password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <div>
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600"
              aria-invalid={errors.acceptTerms ? true : undefined}
              aria-describedby={errors.acceptTerms ? 'accept-terms-error' : undefined}
              {...register('acceptTerms')}
            />
            <span>
              I agree to the terms of use and to MedAssist storing my details to provide care.
            </span>
          </label>
          {errors.acceptTerms && (
            <p id="accept-terms-error" className="mt-1 text-sm text-rose-600">
              {errors.acceptTerms.message}
            </p>
          )}
        </div>
        <Button type="submit" fullWidth loading={isLoading}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
