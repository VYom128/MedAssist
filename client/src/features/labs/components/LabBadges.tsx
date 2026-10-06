import StatusPill from '../../../components/ui/StatusPill';
import type { LabFlag, LabPriority } from '../../../constants/catalog';
import { PATIENT_CRITICAL_TEXT } from '../format';

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

/**
 * A result's flag with icon and text, never colour alone (nothing for 'not applicable').
 * `audience="patient"` words critical values for patients.
 */
export function LabFlagPill({
  flag,
  audience = 'staff',
}: {
  flag: LabFlag | null;
  audience?: 'staff' | 'patient';
}) {
  if (!flag || flag === 'na') return null;
  const patientCritical =
    audience === 'patient' && (flag === 'critical_low' || flag === 'critical_high');
  return (
    <StatusPill domain="labFlag" status={flag} size="sm">
      {patientCritical ? PATIENT_CRITICAL_TEXT : undefined}
    </StatusPill>
  );
}
