import { zodResolver } from '@hookform/resolvers/zod';
import { PencilLine, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { useParams } from 'react-router-dom';
import Alert from '../../../components/ui/Alert';
import BackLink from '../../../components/ui/BackLink';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import DescriptionList from '../../../components/ui/DescriptionList';
import ErrorState from '../../../components/ui/ErrorState';
import Input from '../../../components/ui/Input';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import RecordHeader from '../../../components/ui/RecordHeader';
import SectionCard from '../../../components/ui/SectionCard';
import { ROLE_LABELS } from '../../../constants/roles';
import { formatDateTime } from '../../../utils/dates';
import { applyServerFieldErrors } from '../../../utils/forms';
import { getQueryErrorMessage, isApiQueryError } from '../../../utils/http';
import { useGetUserQuery, useUpdateUserMutation, type AdminUser } from '../api';
import UserActions from '../components/UserActions';
import UserStatusBadge from '../components/UserStatusBadge';
import { userEditSchema, withoutEmptyPhone, type UserEditValues } from '../schemas';

const toForm = (u: AdminUser): UserEditValues => ({
  firstName: u.firstName,
  lastName: u.lastName,
  email: u.email,
  phone: u.phone ?? '',
});

/** /admin/users/:id – account details, edit form and account actions. */
export default function UserDetailPage() {
  const { id = '' } = useParams();
  const { data: user, isLoading, isError, error, refetch } = useGetUserQuery(id);
  const [updateUser, { isLoading: saving }] = useUpdateUserMutation();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<UserEditValues>({ resolver: zodResolver(userEditSchema) });

  useEffect(() => {
    if (user) reset(toForm(user));
  }, [user, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const updated = await updateUser({ id, body: withoutEmptyPhone(values) }).unwrap();
      reset(toForm(updated));
      toast.success('User updated');
    } catch (err) {
      if (!applyServerFieldErrors(err, setError, ['firstName', 'lastName', 'email', 'phone'])) {
        setError('root', { message: getQueryErrorMessage(err) });
      }
    }
  });

  const back = <BackLink to="/admin/users" label="All users" />;

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-5xl">
        <ListSkeleton label="Loading user…" rows={3} />
      </section>
    );
  }

  if (isError || !user) {
    const notFound = isApiQueryError(error) && error.status === 404;
    return (
      <section className="mx-auto w-full max-w-5xl">
        {back}
        {notFound ? (
          <Alert tone="error">This user does not exist.</Alert>
        ) : (
          <ErrorState error={error} onRetry={() => void refetch()} />
        )}
      </section>
    );
  }

  const name = `${user.firstName} ${user.lastName}`;
  return (
    <section className="mx-auto w-full max-w-5xl">
      {back}
      <RecordHeader
        name={name}
        meta={<span className="break-all">{user.email}</span>}
        pills={
          <>
            <Badge tone="primary">{ROLE_LABELS[user.role]}</Badge>
            <UserStatusBadge user={user} />
            {user.mustChangePassword && <Badge tone="warning">Password change pending</Badge>}
          </>
        }
        actions={<UserActions user={user} showEdit={false} />}
      />

      <div className="space-y-6">
        <SectionCard title="Account" icon={ShieldCheck}>
          <DescriptionList
            columns={3}
            items={[
              { label: 'Last login', value: formatDateTime(user.lastLoginAt) },
              { label: 'Created', value: formatDateTime(user.createdAt) },
              {
                label: 'Failed login attempts',
                value: <span className="tabular">{user.failedLoginAttempts}</span>,
              },
              ...(user.isLocked
                ? [{ label: 'Locked until', value: formatDateTime(user.lockUntil) }]
                : []),
            ]}
          />
        </SectionCard>

        <form onSubmit={onSubmit} noValidate>
          <SectionCard
            title="Edit details"
            description="The role cannot be changed; create a new account instead."
            icon={PencilLine}
            footer={
              <Button type="submit" loading={saving} disabled={!isDirty}>
                Save changes
              </Button>
            }
          >
            <div className="space-y-4">
              {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
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
                <Input
                  label="Email"
                  type="email"
                  error={errors.email?.message}
                  {...register('email')}
                />
                <Input
                  label="Mobile number"
                  type="tel"
                  error={errors.phone?.message}
                  {...register('phone')}
                />
              </div>
            </div>
          </SectionCard>
        </form>
      </div>
    </section>
  );
}
