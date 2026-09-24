import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { UserRound } from 'lucide-react';
import Alert from '../../../components/ui/Alert';
import Avatar from '../../../components/ui/Avatar';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import SectionCard from '../../../components/ui/SectionCard';
import { ROLE_LABELS } from '../../../constants/roles';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useGetMeQuery, useUpdateMeMutation } from '../api';
import { profileSchema, type ProfileValues } from '../schemas';

export default function ProfilePage() {
  const { data: me, isLoading, isError, error, refetch } = useGetMeQuery();
  const [updateMe, { isLoading: saving }] = useUpdateMeMutation();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) });

  useEffect(() => {
    if (me) reset({ firstName: me.firstName, lastName: me.lastName, phone: me.phone ?? '' });
  }, [me, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await updateMe(values).unwrap();
      toast.success('Profile updated');
      reset({
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone ?? '',
      });
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['firstName', 'lastName', 'phone'])) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  return (
    <section className="mx-auto w-full max-w-2xl">
      <PageHeader title="My profile" description="Your account details." />

      {isLoading && <ListSkeleton label="Loading profile…" rows={3} />}

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {me && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-5 text-center shadow-card sm:flex-row sm:text-left lg:p-6">
            <Avatar name={`${me.firstName} ${me.lastName}`} size="xl" />
            <div className="min-w-0">
              <p className="text-section break-words">
                {me.firstName} {me.lastName}
              </p>
              <p className="mt-0.5 text-sm break-all text-muted">{me.email}</p>
              <div className="mt-2">
                <Badge tone="primary">{ROLE_LABELS[me.role]}</Badge>
              </div>
            </div>
          </div>

          <form onSubmit={onSubmit} noValidate>
            <SectionCard
              title="Personal details"
              description="Your email address and role can't be changed here."
              icon={UserRound}
              footer={
                <Button type="submit" loading={saving} disabled={!isDirty}>
                  Save changes
                </Button>
              }
            >
              <div className="space-y-4">
                {errors.root && (
                  <div className="motion-safe:animate-fade-in">
                    <Alert tone="error">{errors.root.message}</Alert>
                  </div>
                )}
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
                  label="Mobile number"
                  type="tel"
                  error={errors.phone?.message}
                  {...register('phone')}
                />
              </div>
            </SectionCard>
          </form>
        </div>
      )}
    </section>
  );
}
