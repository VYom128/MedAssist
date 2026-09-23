import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import { ROLE_LABELS } from '../../../constants/roles';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage } from '../../../utils/http';
import { useGetMeQuery, useUpdateMeMutation } from '../api';
import { profileSchema, type ProfileValues } from '../schemas';

export default function ProfilePage() {
  const { data: me, isLoading, isError, error, refetch } = useGetMeQuery();
  const [updateMe, { isLoading: saving, isSuccess }] = useUpdateMeMutation();
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
    <section className="mx-auto w-full max-w-lg">
      <PageHeader title="My profile" />
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        {isLoading && (
          <div className="space-y-3" role="status">
            <span className="sr-only">Loading profile…</span>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        )}

        {isError && (
          <div className="space-y-3">
            <Alert tone="error">{getQueryErrorMessage(error)}</Alert>
            <Button variant="secondary" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}

        {me && (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {isSuccess && !isDirty && <Alert tone="success">Profile updated.</Alert>}
            {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Email</dt>
                <dd className="font-medium break-all">{me.email}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Role</dt>
                <dd className="font-medium">{ROLE_LABELS[me.role]}</dd>
              </div>
            </dl>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="First name"
                error={errors.firstName?.message}
                {...register('firstName')}
              />
              <Input label="Last name" error={errors.lastName?.message} {...register('lastName')} />
            </div>
            <Input
              label="Mobile number"
              type="tel"
              error={errors.phone?.message}
              {...register('phone')}
            />
            <Button type="submit" loading={saving} disabled={!isDirty}>
              Save changes
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
