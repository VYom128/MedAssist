import { useEffect, useState } from 'react';
import { getErrorMessage } from '../../../utils/http';
import { fetchHealth, type HealthStatus } from '../api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: HealthStatus };

function StatusRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="font-medium text-slate-700">{label}</dt>
      <dd
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
          ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`}
        />
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
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">System status</h1>
        <p className="mt-1 text-sm text-slate-500">Checks the API and its database connection.</p>

        <div className="mt-4" aria-live="polite">
          {state.status === 'loading' && (
            <div className="space-y-3 py-2" role="status">
              <span className="sr-only">Checking status…</span>
              <div className="h-8 animate-pulse rounded bg-slate-100" />
              <div className="h-8 animate-pulse rounded bg-slate-100" />
            </div>
          )}

          {state.status === 'error' && (
            <div className="rounded-lg bg-rose-50 p-4 text-sm text-rose-700" role="alert">
              <p className="font-semibold">API: unreachable</p>
              <p className="mt-1">{state.message}</p>
            </div>
          )}

          {state.status === 'success' && (
            <dl className="divide-y divide-slate-100">
              <StatusRow label="API" value={state.data.status} ok />
              <StatusRow label="DB" value={state.data.db} ok={state.data.db === 'connected'} />
            </dl>
          )}
        </div>

        <button
          type="button"
          onClick={refresh}
          disabled={state.status === 'loading'}
          className="mt-6 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
        >
          Refresh
        </button>
      </div>
    </section>
  );
}
