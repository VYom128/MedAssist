import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppDispatch } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { homeFor } from '../../../routes/home';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { formatPhone, normalisePhone, PHONE_PREFIX } from '../../../utils/phone';
import { useGetPublicSettingsQuery } from '../../settings/api';
import { useRegisterMutation } from '../api';
import { credentialsReceived } from '../authSlice';
import AuthCard from '../components/AuthCard';
import { authLinkClass } from '../components/authStyles';
import PasswordChecklist from '../components/PasswordChecklist';
import PasswordInput from '../../../components/ui/PasswordInput';
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

function Consent({
  id,
  error,
  children,
  field,
}: {
  id: string;
  error?: string;
  children: React.ReactNode;
  field: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3 rounded-control py-1 text-sm text-body">
        <input
          type="checkbox"
          className="mt-px h-5 w-5 shrink-0 cursor-pointer rounded accent-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...field}
        />
        <span>{children}</span>
      </label>
      {error && (
        <p id={`${id}-error`} className="mt-1 pl-8 text-sm text-danger-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** Patient self-signup (spec §4.4). */
export default function RegisterPage() {
  const [registerPatient, { isLoading }] = useRegisterMutation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { data: clinic } = useGetPublicSettingsQuery();
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { phone: PHONE_PREFIX },
  });
  const [password = '', email, firstName] = useWatch({
    control,
    name: ['password', 'email', 'firstName'],
  });

  const onSubmit = handleSubmit(
    async ({ confirmPassword: _confirm, consentDataProcessing: _consent, ...values }) => {
      try {
        const result = await registerPatient({
          ...values,
          phone: normalisePhone(values.phone) ?? values.phone,
          acceptTerms: true,
          consent: { dataProcessing: true },
        }).unwrap();
        // homeFor() sends a pending sign-up to the photo-ID screen; the public-only route
        // redirects to the same place, so the two never disagree.
        dispatch(credentialsReceived({ accessToken: result.accessToken, user: result.user }));
        navigate(homeFor(result.user), { replace: true });
      } catch (err) {
        if (applyServerFieldErrors(err, setError, FIELDS)) return;
        // The generic "we couldn't create your account" (matched record already has an account).
        const contact =
          isApiQueryError(err) && err.status === 422 && clinic?.phone
            ? ` You can call ${clinic.name} on ${formatPhone(clinic.phone)}.`
            : '';
        setError('root', { message: `${getQueryErrorMessage(err)}${contact}` });
      }
    },
  );

  return (
    <AuthCard
      title="Create your patient account"
      icon={UserPlus}
      wide
      subtitle="Book appointments and see your prescriptions, lab reports and bills."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className={authLinkClass}>
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {errors.root && (
          <div className="motion-safe:animate-fade-in">
            <Alert tone="error">{errors.root.message}</Alert>
          </div>
        )}
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
          hint="Numbers without a country code are Indian (+91)."
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
        <PasswordInput
          label="Password"
          autoComplete="new-password"
          hint={<PasswordChecklist password={password} email={email} firstName={firstName} />}
          error={errors.password?.message}
          {...register('password')}
        />
        <PasswordInput
          label="Confirm password"
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />
        <div className="space-y-2 rounded-control border border-line bg-surface-muted p-4">
          <Consent
            id="accept-terms"
            error={errors.acceptTerms?.message}
            field={register('acceptTerms')}
          >
            I agree to the terms of use.
          </Consent>
          <Consent
            id="consent-data"
            error={errors.consentDataProcessing?.message}
            field={register('consentDataProcessing')}
          >
            I consent to MedAssist storing and processing my health information to provide my care.
          </Consent>
        </div>
        <Button type="submit" fullWidth loading={isLoading}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
