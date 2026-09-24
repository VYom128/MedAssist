import Skeleton from './Skeleton';

/** Loading placeholder for a list or form (spec §13.3: every list has a loading skeleton). */
export default function ListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div
      className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card"
      role="status"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-9 w-9 shrink-0" rounded="rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="hidden h-6 w-20 sm:block" rounded="rounded-full" />
        </div>
      ))}
    </div>
  );
}
