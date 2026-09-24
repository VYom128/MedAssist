import { Globe, LogOut, MonitorSmartphone } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import IconChip from '../../../components/ui/IconChip';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
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
    <section className="mx-auto w-full max-w-form">
      <PageHeader title="Active sessions" description="Devices where you are signed in." />

      {isLoading && <ListSkeleton label="Loading sessions…" rows={2} />}

      {isError && <ErrorState error={error} onRetry={() => void refetch()} />}

      {sessions?.length === 0 && <EmptyState icon={MonitorSmartphone} title="No active sessions" />}

      {sessions && sessions.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className={`flex flex-col gap-4 rounded-card border bg-surface p-5 shadow-card ${
                s.current ? 'border-primary-200' : 'border-line'
              }`}
            >
              <div className="flex items-start gap-3">
                <IconChip icon={MonitorSmartphone} tone={s.current ? 'primary' : 'neutral'} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                    {describeUserAgent(s.userAgent)}
                    {s.current && <Badge tone="success">This device</Badge>}
                  </p>
                  <dl className="mt-2 space-y-1 text-sm text-muted">
                    <div className="flex items-center gap-1.5">
                      <dt>
                        <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                        <span className="sr-only">IP address</span>
                      </dt>
                      <dd className="tabular break-all">{s.ip ?? 'Unknown IP'}</dd>
                    </div>
                    <div className="flex flex-wrap gap-x-1.5">
                      <dt>Last used</dt>
                      <dd className="tabular text-body">{formatDateTime(s.lastUsedAt)}</dd>
                    </div>
                  </dl>
                </div>
              </div>
              {!s.current && (
                <div className="mt-auto border-t border-line pt-4">
                  <Button variant="secondary" size="sm" onClick={() => setToRevoke(s)}>
                    <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <section
        aria-labelledby="danger-zone-title"
        className="mt-8 flex flex-col gap-4 rounded-card border border-danger-100 bg-danger-50/40 p-5 sm:flex-row sm:items-center sm:justify-between lg:p-6"
      >
        <div>
          <h2 id="danger-zone-title" className="text-card text-danger-700">
            Log out everywhere
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Signs out every device, including this one. You will need to sign in again.
          </p>
        </div>
        <Button variant="danger" onClick={() => setConfirmAll(true)} className="shrink-0">
          <LogOut className="h-4 w-4" aria-hidden="true" /> Log out of all devices
        </Button>
      </section>

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
