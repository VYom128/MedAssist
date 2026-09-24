import { TriangleAlert } from 'lucide-react';
import type { Allergy } from '../api';

/** Allergies as red chips (safety information, spec §13.3). */
export default function AllergyChips({ allergies }: { allergies: Allergy[] }) {
  if (allergies.length === 0) {
    return <p className="text-sm text-muted">No known allergies recorded.</p>;
  }
  return (
    <ul aria-label="Allergies" className="flex flex-wrap gap-1.5">
      {allergies.map((a) => (
        <li
          key={a.id}
          className="inline-flex items-center gap-1 rounded-full bg-danger-50 px-2.5 py-1 text-xs font-semibold text-danger-700 ring-1 ring-danger-100 ring-inset"
          title={a.reaction ?? undefined}
        >
          <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
          {a.substance} <span className="font-normal">({a.severity})</span>
        </li>
      ))}
    </ul>
  );
}
