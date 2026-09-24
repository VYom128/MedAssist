import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Allergy } from '../../patients/api';

/**
 * The red allergy banner of the consult workspace (spec §13.3: always visible). Announced to
 * screen readers once, when the workspace opens (role="alert" on the first render only, so
 * later re-renders do not interrupt). "No known allergies" when none are recorded.
 */
export default function AllergyBanner({ allergies }: { allergies: Allergy[] }) {
  const [announce, setAnnounce] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(false), 1500);
    return () => clearTimeout(t);
  }, []);

  if (allergies.length === 0) {
    return (
      <p
        role={announce ? 'status' : undefined}
        className="inline-flex items-center gap-1.5 rounded-control bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 ring-1 ring-line ring-inset"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> No known allergies
      </p>
    );
  }
  return (
    <div
      role={announce ? 'alert' : undefined}
      aria-label="Allergies"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control bg-danger-600 px-3 py-1.5 text-sm text-white"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <TriangleAlert className="h-4 w-4" aria-hidden="true" /> Allergies:
      </span>
      {allergies.map((a, i) => (
        <span key={a.id} title={a.reaction ?? undefined}>
          <span className="font-semibold">{a.substance}</span>{' '}
          <span className="opacity-90">({a.severity})</span>
          {i < allergies.length - 1 ? ',' : ''}
        </span>
      ))}
    </div>
  );
}
