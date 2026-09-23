/** Loading placeholder for a list or form (spec §13.3: every list has a loading skeleton). */
export default function ListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-2" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  );
}
