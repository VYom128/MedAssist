import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Modal from '../../../components/ui/Modal';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { useCreateDoctorMutation } from '../api';
import {
  ACCOUNT_FIELDS,
  addDoctorSchema,
  emptyProfile,
  PROFILE_FIELDS,
  toProfileInput,
  type AddDoctorFormInput,
  type AddDoctorFormValues,
} from '../schemas';
import DoctorProfileFields from './DoctorProfileFields';

const defaults = (): AddDoctorFormInput => ({
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  ...emptyProfile(),
});

/**
 * POST /doctors in two steps: (1) the login account, (2) the profile. The server creates both
 * together and emails the doctor a link to set their password.
 */
export default function AddDoctorModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [createDoctor, { isLoading }] = useCreateDoctorMutation();
  const navigate = useNavigate();
  const form = useForm<AddDoctorFormInput, unknown, AddDoctorFormValues>({
    resolver: zodResolver(addDoctorSchema),
    defaultValues: defaults(),
  });
  const {
    register,
    handleSubmit,
    trigger,
    reset,
    setError,
    formState: { errors },
  } = form;

  const close = () => {
    reset(defaults());
    setStep(1);
    onClose();
  };

  const next = async () => {
    if (await trigger([...ACCOUNT_FIELDS])) setStep(2);
  };

  const onSubmit = handleSubmit(
    async (v) => {
      try {
        const doctor = await createDoctor({
          firstName: v.firstName,
          lastName: v.lastName,
          email: v.email,
          ...(v.phone ? { phone: v.phone } : {}),
          ...toProfileInput(v),
        }).unwrap();
        toast.success(
          `Dr ${doctor.name} added. A welcome email with a link to set their password was sent to ${doctor.email}.`,
          { duration: 6000 },
        );
        close();
        navigate(`/admin/doctors/${doctor.id}`);
      } catch (err) {
        if (isApiQueryError(err) && err.code === 'CONFLICT') {
          const fields = (err.details as { fields?: string[] } | undefined)?.fields ?? [];
          if (fields.includes('email')) {
            setError('email', { message: 'An account with this email already exists' });
            setStep(1);
            return;
          }
          if (fields.includes('registrationNumber')) {
            setError('registrationNumber', {
              message: 'Another doctor has this registration number',
            });
            return;
          }
        }
        const all = [...ACCOUNT_FIELDS, ...PROFILE_FIELDS];
        if (applyServerFieldErrors(err, setError, all)) {
          if (ACCOUNT_FIELDS.some((f) => form.getFieldState(f).error)) setStep(1);
        } else {
          setError('root', { message: getQueryErrorMessage(err) });
        }
      }
    },
    () => {
      if (ACCOUNT_FIELDS.some((f) => form.getFieldState(f).error)) setStep(1);
    },
  );

  return (
    <Modal
      open={open}
      size="lg"
      title="Add doctor"
      onClose={close}
      footer={
        step === 1 ? (
          <>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={() => void next()}>Next: profile</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button type="submit" form="add-doctor-form" loading={isLoading}>
              Add doctor
            </Button>
          </>
        )
      }
    >
      <FormProvider {...form}>
        <form id="add-doctor-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink" aria-live="polite">
              Step {step} of 2: {step === 1 ? 'Account' : 'Profile'}
            </p>
            <div aria-hidden="true" className="mt-2 grid grid-cols-2 gap-1.5">
              <span className="h-1.5 rounded-full bg-primary-600" />
              <span
                className={`h-1.5 rounded-full transition-colors duration-250 ease-standard ${step === 2 ? 'bg-primary-600' : 'bg-neutral-100'}`}
              />
            </div>
          </div>
          {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
          {step === 1 ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="First name"
                  error={errors.firstName?.message}
                  {...register('firstName')}
                />
                <Input
                  label="Last name"
                  error={errors.lastName?.message}
                  {...register('lastName')}
                />
              </div>
              <Input
                label="Email"
                type="email"
                error={errors.email?.message}
                {...register('email')}
              />
              <Input
                label="Mobile number (optional)"
                type="tel"
                error={errors.phone?.message}
                {...register('phone')}
              />
              <p className="text-xs text-muted">
                The doctor gets an email with a link to set their password (valid 72 hours).
              </p>
            </div>
          ) : (
            <DoctorProfileFields />
          )}
        </form>
      </FormProvider>
    </Modal>
  );
}
