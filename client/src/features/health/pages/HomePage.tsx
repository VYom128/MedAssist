import { CircleCheck, CircleX, RotateCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import Alert from '../../../components/ui/Alert';
import Button from '../../../components/ui/Button';
import Skeleton from '../../../components/ui/Skeleton';
import { getErrorMessage } from '../../../utils/http';
import { fetchHealth, type HealthStatus } from '../api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: HealthStatus };

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="font-medium text-ink">{label}</dt>
      <dd
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${
          ok
            ? 'bg-success-50 text-success-700 ring-success-100'
            : 'bg-danger-50 text-danger-700 ring-danger-100'
        }`}
      >
        {ok ? (
          <CircleCheck className="h-4 w-4" aria-hidden="true" />
        ) : (
          <CircleX className="h-4 w-4" aria-hidden="true" />
        )}
        {value}
      </dd>
    </div>
  );
}

export default function HomePage() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: getErrorMessage(err) });
      });
    return () => controller.abort();
  }, [reloadKey]);

  const refresh = () => {
    setState({ status: 'loading' });
    setReloadKey((k) => k + 1);
  };

  return (
    <section className="mx-auto w-full max-w-md">
      <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
        <h1 className="text-page">System status</h1>
        <p className="mt-1.5 text-sm text-muted">Checks the API and its database connection.</p>

        <div className="mt-4" aria-live="polite">
          {state.status === 'loading' && (
            <div className="space-y-3 py-2" role="status">
              <span className="sr-only">Checking status…</span>
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          )}

          {state.status === 'error' && (
            <Alert tone="error" title="API: unreachable">
              {state.message}
            </Alert>
          )}

          {state.status === 'success' && (
            <dl className="divide-y divide-line">
              <StatusRow label="API" value={state.data.status} ok />
              <StatusRow label="DB" value={state.data.db} ok={state.data.db === 'connected'} />
            </dl>
          )}
        </div>

        <Button
          variant="secondary"
          onClick={refresh}
          disabled={state.status === 'loading'}
          className="mt-6 w-full"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>
    </section>
  );
}
