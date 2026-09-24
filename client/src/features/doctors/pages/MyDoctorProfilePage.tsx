import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useAppSelector } from '../../../app/hooks';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import DescriptionList from '../../../components/ui/DescriptionList';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import TagInput from '../../../components/ui/TagInput';
import Textarea from '../../../components/ui/Textarea';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { formatINR } from '../../../utils/money';
import { useGetDoctorQuery, useUpdateDoctorMutation, type Doctor } from '../api';
import { ownProfileSchema, type OwnProfileValues } from '../schemas';

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
    <section className="mx-auto w-full max-w-form">
      <PageHeader
        title="My doctor profile"
        description="What patients see when they book with you."
      />
      {isLoading && <ListSkeleton label="Loading profile…" rows={3} />}
      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}
      {doctor && (
        <div className="space-y-6">
          <form onSubmit={onSubmit} noValidate>
            <SectionCard
              title="About you"
              description="Your bio and the languages you consult in."
              icon={UserRound}
              bodyClassName="space-y-4"
              footer={
                <Button type="submit" disabled={!isDirty} loading={saving}>
                  Save
                </Button>
              }
            >
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
            </SectionCard>
          </form>
          <SectionCard
            title="Clinic details"
            description="Ask the clinic admin to change these."
            icon={Building2}
          >
            <DescriptionList
              items={[
                { label: 'Department', value: doctor.department?.name },
                { label: 'Specialization', value: doctor.specialization },
                { label: 'Qualifications', value: doctor.qualifications.join(', ') },
                {
                  label: 'Experience',
                  value: doctor.experienceYears === null ? null : `${doctor.experienceYears} years`,
                },
                {
                  label: 'Consultation fee',
                  value:
                    doctor.consultationFeePaise === null ? null : (
                      <span className="tabular">{formatINR(doctor.consultationFeePaise)}</span>
                    ),
                },
              ]}
            />
          </SectionCard>
        </div>
      )}
    </section>
  );
}
