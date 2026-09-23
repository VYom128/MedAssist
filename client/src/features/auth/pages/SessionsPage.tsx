import { LogOut, MonitorSmartphone } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import { formatDateTime } from '../../../utils/dates';
import { getQueryErrorMessage } from '../../../utils/http';
import { describeUserAgent } from '../../../utils/userAgent';
import {
  useGetSessionsQuery,
  useLogoutAllMutation,
  useRevokeSessionMutation,
  type SessionInfo,
} from '../api';

/** Devices where the user is signed in, with sign-out per device and everywhere. */
export default function SessionsPage() {
  const navigate = useNavigate();
  const { data: sessions, isLoading, isError, error, refetch } = useGetSessionsQuery();
  const [revoke, { isLoading: revoking }] = useRevokeSessionMutation();
  const [logoutAll, { isLoading: loggingOutAll }] = useLogoutAllMutation();
  const [toRevoke, setToRevoke] = useState<SessionInfo | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const onRevoke = async () => {
    if (!toRevoke) return;
    try {
      await revoke(toRevoke.id).unwrap();
      toast.success('That device has been signed out');
    } catch (err) {
      toast.error(getQueryErrorMessage(err));
    } finally {
      setToRevoke(null);
    }
  };

  const onLogoutAll = async () => {
    await logoutAll()
      .unwrap()
      .catch(() => undefined);
    toast.success('You have been signed out of all devices');
    navigate('/login', { replace: true });
  };

  return (
    <section className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Active sessions"
        description="Devices where you are signed in."
        actions={
          <Button variant="danger" onClick={() => setConfirmAll(true)}>
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out of all devices
          </Button>
        }
      />

      {isLoading && (
        <div className="space-y-3" role="status">
          <span className="sr-only">Loading sessions…</span>
          {[1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
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

      {sessions?.length === 0 && <EmptyState icon={MonitorSmartphone} title="No active sessions" />}

      {sessions && sessions.length > 0 && (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <MonitorSmartphone
                  className="mt-0.5 h-5 w-5 shrink-0 text-slate-400"
                  aria-hidden="true"
                />
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {describeUserAgent(s.userAgent)}
                    {s.current && <Badge tone="success">This device</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {s.ip ?? 'Unknown IP'} · Last used {formatDateTime(s.lastUsedAt)}
                  </p>
                </div>
              </div>
              {!s.current && (
                <Button variant="secondary" onClick={() => setToRevoke(s)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toRevoke !== null}
        title="Sign out this device?"
        confirmLabel="Sign out"
        tone="danger"
        loading={revoking}
        onConfirm={() => void onRevoke()}
        onCancel={() => setToRevoke(null)}
      >
        {toRevoke && (
          <p>
            {describeUserAgent(toRevoke.userAgent)} ({toRevoke.ip ?? 'unknown IP'}) will need to
            sign in again.
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAll}
        title="Log out of all devices?"
        confirmLabel="Log out everywhere"
        tone="danger"
        loading={loggingOutAll}
        onConfirm={() => void onLogoutAll()}
        onCancel={() => setConfirmAll(false)}
      >
        <p>Every device, including this one, will be signed out.</p>
      </ConfirmDialog>
    </section>
  );
}
