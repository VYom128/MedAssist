import StatusPill from '../../../components/ui/StatusPill';
import type { AppointmentPriority } from '../../../constants/catalog';

/** Queue priority (spec §8.4). Normal priority is not shown unless `showNormal`. */
export default function PriorityPill({
  priority,
  showNormal = false,
  size,
}: {
  priority: AppointmentPriority | undefined;
  showNormal?: boolean;
  size?: 'sm' | 'md';
}) {
  if (!priority || (priority === 'normal' && !showNormal)) return null;
  return <StatusPill domain="priority" status={priority} size={size} />;
}
