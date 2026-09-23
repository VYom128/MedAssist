import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { Link, useParams } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import Input from '../../../components/ui/Input';
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{children}</dd>
    </div>
  );
}

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

  const back = (
    <Link
      to="/admin/users"
      className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All users
    </Link>
  );

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-4xl space-y-3" role="status">
        <span className="sr-only">Loading user…</span>
        <div className="h-8 w-48 animate-pulse rounded bg-slate-100" />
        <div className="h-48 animate-pulse rounded-xl bg-slate-100" />
      </section>
    );
  }

  if (isError || !user) {
    const notFound = isApiQueryError(error) && error.status === 404;
    return (
      <section className="mx-auto w-full max-w-4xl space-y-3">
        {back}
        <Alert tone="error">
          {notFound ? 'This user does not exist.' : getQueryErrorMessage(error)}
        </Alert>
        {!notFound && (
          <Button variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl space-y-4">
      {back}
      <PageHeader
        title={`${user.firstName} ${user.lastName}`}
        description={user.email}
        actions={<UserActions user={user} showEdit={false} />}
      />

      <Card title="Account">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Role">
            <Badge tone="info">{ROLE_LABELS[user.role]}</Badge>
          </Detail>
          <Detail label="Status">
            <UserStatusBadge user={user} />
            {user.mustChangePassword && (
              <span className="ml-1">
                <Badge tone="warning">Password change pending</Badge>
              </span>
            )}
          </Detail>
          <Detail label="Last login">{formatDateTime(user.lastLoginAt)}</Detail>
          <Detail label="Created">{formatDateTime(user.createdAt)}</Detail>
          <Detail label="Failed login attempts">{user.failedLoginAttempts}</Detail>
          {user.isLocked && <Detail label="Locked until">{formatDateTime(user.lockUntil)}</Detail>}
        </dl>
      </Card>

      <Card title="Edit details">
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {errors.root && <Alert tone="error">{errors.root.message}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              error={errors.firstName?.message}
              {...register('firstName')}
            />
            <Input label="Last name" error={errors.lastName?.message} {...register('lastName')} />
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
          <p className="text-xs text-slate-500">
            The role cannot be changed; create a new account instead.
          </p>
          <Button type="submit" loading={saving} disabled={!isDirty}>
            Save changes
          </Button>
        </form>
      </Card>
    </section>
  );
}
