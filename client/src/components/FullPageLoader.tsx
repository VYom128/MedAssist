import Spinner from './ui/Spinner';

/** Shown while the session is being restored on page load. */
export default function FullPageLoader() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-3 text-brand-600"
      role="status"
    >
      <Spinner className="h-8 w-8" />
      <span className="text-sm text-slate-500">Loading MedAssist…</span>
    </div>
  );
}
