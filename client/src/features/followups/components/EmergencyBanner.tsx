import { Siren } from 'lucide-react';
import { EMERGENCY_NOTICE } from '../labels';

/** Always visible on the patient's follow-up pages (spec §4.10). */
export default function EmergencyBanner() {
  return (
    <div
      role="note"
      aria-label="Not for emergencies"
      className="flex items-start gap-3 rounded-card border border-danger-100 bg-danger-50 p-4 text-sm font-semibold text-danger-700"
    >
      <Siren className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p>{EMERGENCY_NOTICE}</p>
    </div>
  );
}
