import { useNavigate } from 'react-router-dom';
import PageHeader from '../../../components/PageHeader';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import { getQueryErrorMessage } from '../../../utils/http';
import { describeUserAgent } from '../../../utils/userAgent';
import { useGetSessionsQuery, useLogoutAllMutation, useRevokeSessionMutation } from '../api';

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Active sessions (devices) with sign-out per device and everywhere. */
export default function SessionsPage() {
  const navigate = useNavigate();
  const { data: sessions, isLoading, isError, error, refetch } = useGetSessionsQuery();
  const [revoke, { isLoading: revoking, originalArgs: revokingId }] = useRevokeSessionMutation();
  const [logoutAll, { isLoading: loggingOutAll }] = useLogoutAllMutation();

  const onLogoutAll = async () => {
    await logoutAll()
      .unwrap()
      .catch(() => undefined);
    navigate('/login', {
      replace: true,
      state: { notice: 'You have been signed out everywhere.' },
    });
  };

  return (
    <section className="mx-auto w-full max-w-3xl">
      <PageHeader
        title="Active sessions"
        description="Devices where you are signed in."
        actions={
          <Button variant="danger" onClick={() => void onLogoutAll()} loading={loggingOutAll}>
            Sign out everywhere
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

      {sessions?.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No active sessions.
        </div>
      )}

      {sessions && sessions.length > 0 && (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-medium">
                  {describeUserAgent(s.userAgent)}
                  {s.current && (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      This device
                    </span>
                  )}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {s.ip ?? 'Unknown IP'} · Last active {formatDate(s.lastUsedAt)}
                </p>
              </div>
              {!s.current && (
                <Button
                  variant="secondary"
                  onClick={() => void revoke(s.id)}
                  loading={revoking && revokingId === s.id}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
