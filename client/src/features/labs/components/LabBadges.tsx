import StatusPill from '../../../components/ui/StatusPill';
import type { LabFlag, LabPriority } from '../../../constants/catalog';

/** A red "Urgent" pill (routine orders show nothing). */
export function UrgentPill({ priority }: { priority: LabPriority }) {
  if (priority !== 'urgent') return null;
  return <StatusPill domain="labPriority" status="urgent" size="sm" />;
}

/** "Overdue" when the order passed its turnaround time. */
export function OverdueBadge({ at }: { at: string | null | undefined }) {
  if (!at) return null;
  return <StatusPill domain="labTat" status="overdue" size="sm" />;
}

/** A result flag (nothing for 'not applicable'). */
export function FlagPill({ flag }: { flag: LabFlag | null }) {
  if (!flag || flag === 'na') return null;
  return <StatusPill domain="labFlag" status={flag} size="sm" />;
}
