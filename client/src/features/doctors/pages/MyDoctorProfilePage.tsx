import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useAppSelector } from '../../../app/hooks';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import TagInput from '../../../components/ui/TagInput';
import Textarea from '../../../components/ui/Textarea';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { useGetDoctorQuery, useUpdateDoctorMutation, type Doctor } from '../api';
import { ownProfileSchema, type OwnProfileValues } from '../schemas';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{children}</dd>
    </div>
  );
}

const toForm = (d: Doctor): OwnProfileValues => ({ bio: d.bio ?? '', languages: [...d.languages] });

/**
 * /doctor/profile – a doctor edits only their bio and languages (spec §7.6); everything else is
 * shown read-only and changed by the clinic admin. Account status and booking controls are
 * admin-only and not shown.
 */
export default function MyDoctorProfilePage() {
  const me = useAppSelector((s) => s.auth.user);
  const {
    data: doctor,
    isLoading,
    isError,
    error,
    refetch,
  } = useGetDoctorQuery(me?.id ?? '', {
    skip: !me,
  });
  const [update, { isLoading: saving }] = useUpdateDoctorMutation();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<OwnProfileValues>({ resolver: zodResolver(ownProfileSchema) });

  useEffect(() => {
    if (doctor) reset(toForm(doctor));
  }, [doctor, reset]);

  const onSubmit = handleSubmit(async (values) => {
    if (!doctor) return;
    try {
      await update({ id: doctor.id, body: values }).unwrap();
      toast.success('Profile saved');
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['bio', 'languages'])) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <section className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="My doctor profile"
        description="What patients see when they book with you."
      />
      {isLoading && <ListSkeleton label="Loading profile…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {doctor && (
        <div className="space-y-6">
          <Card title="About you">
            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
              <Textarea label="Bio" rows={5} error={errors.bio?.message} {...register('bio')} />
              <Controller
                control={control}
                name="languages"
                render={({ field }) => (
                  <TagInput
                    label="Languages"
                    value={field.value ?? []}
                    onChange={field.onChange}
                    maxLength={30}
                    error={errors.languages?.message}
                  />
                )}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={!isDirty} loading={saving}>
                  Save
                </Button>
              </div>
            </form>
          </Card>
          <Card title="Clinic details">
            <p className="mb-3 text-sm text-slate-500">Ask the clinic admin to change these.</p>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="Department">{doctor.department?.name ?? '—'}</Detail>
              <Detail label="Specialization">{doctor.specialization}</Detail>
              <Detail label="Qualifications">{doctor.qualifications.join(', ') || '—'}</Detail>
              <Detail label="Experience">
                {doctor.experienceYears === null ? '—' : `${doctor.experienceYears} years`}
              </Detail>
              <Detail label="Consultation fee">
                {doctor.consultationFeePaise === null
                  ? '—'
                  : formatINR(doctor.consultationFeePaise)}
              </Detail>
            </dl>
          </Card>
        </div>
      )}
    </section>
  );
}
