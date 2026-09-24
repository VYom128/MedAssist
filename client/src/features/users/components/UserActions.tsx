import { KeyRound, LockOpen, Pencil, UserCheck, UserX } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useAppSelector } from '../../../app/hooks';
import Button from '../../../components/ui/Button';
import { buttonClass } from '../../../components/ui/buttonClass';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { getQueryErrorMessage } from '../../../utils/http';
import { selectCurrentUser } from '../../auth/authSlice';
import { useUserActionMutation, type AdminUser } from '../api';

type Action = 'deactivate' | 'activate' | 'unlock' | 'reset-password';

const CONFIRM: Record<Action, { title: string; body: string; label: string; danger?: boolean }> = {
  deactivate: {
    title: 'Deactivate user?',
    body: 'They will be signed out everywhere and cannot log in until reactivated.',
    label: 'Deactivate',
    danger: true,
  },
  activate: {
    title: 'Activate user?',
    body: 'They will be able to log in again.',
    label: 'Activate',
  },
  unlock: {
    title: 'Unlock account?',
    body: 'Clears the lock from failed login attempts.',
    label: 'Unlock',
  },
  'reset-password': {
    title: 'Send password reset?',
    body: 'We will email them a link to set a new password (valid 30 minutes).',
    label: 'Send email',
  },
};

/** Row/detail actions: edit, deactivate/activate, unlock (only when locked), send reset. */
export default function UserActions({
  user,
  showEdit = true,
}: {
  user: AdminUser;
  showEdit?: boolean;
}) {
  const me = useAppSelector(selectCurrentUser);
  const [run, { isLoading }] = useUserActionMutation();
  const [pending, setPending] = useState<Action | null>(null);
  const name = `${user.firstName} ${user.lastName}`;
  const isSelf = me?.id === user.id;

  const confirm = async () => {
    if (!pending) return;
    try {
      const message = await run({ id: user.id, action: pending }).unwrap();
      toast.success(message);
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {showEdit && (
        <Link
          to={`/admin/users/${user.id}`}
          aria-label={`Edit ${name}`}
          className={buttonClass('secondary', 'sm')}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
        </Link>
      )}
      {user.isActive && !isSelf && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPending('deactivate')}
          aria-label={`Deactivate ${name}`}
        >
          <UserX className="h-4 w-4" aria-hidden="true" /> Deactivate
        </Button>
      )}
      {!user.isActive && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPending('activate')}
          aria-label={`Activate ${name}`}
        >
          <UserCheck className="h-4 w-4" aria-hidden="true" /> Activate
        </Button>
      )}
      {user.isLocked && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPending('unlock')}
          aria-label={`Unlock ${name}`}
        >
          <LockOpen className="h-4 w-4" aria-hidden="true" /> Unlock
        </Button>
      )}
      {user.isActive && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setPending('reset-password')}
          aria-label={`Send password reset to ${name}`}
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" /> Reset
        </Button>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? CONFIRM[pending].title : ''}
        confirmLabel={pending ? CONFIRM[pending].label : ''}
        tone={pending && CONFIRM[pending].danger ? 'danger' : 'primary'}
        loading={isLoading}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      >
        <p>
          <span className="font-semibold text-ink">{name}</span> ({user.email})
        </p>
        <p className="mt-2">{pending ? CONFIRM[pending].body : ''}</p>
      </ConfirmDialog>
    </div>
  );
}
