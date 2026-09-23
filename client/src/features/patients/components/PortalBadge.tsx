import Badge, { type BadgeTone } from '../../../components/ui/Badge';
import type { PortalState } from '../portal';

const LOOK: Record<PortalState, { tone: BadgeTone; label: string }> = {
  none: { tone: 'neutral', label: 'No portal' },
  invited: { tone: 'info', label: 'Portal invited' },
  linked: { tone: 'success', label: 'Portal active' },
  pending: { tone: 'warning', label: 'Portal: ID check pending' },
};

export default function PortalBadge({ state }: { state: PortalState }) {
  return <Badge tone={LOOK[state].tone}>{LOOK[state].label}</Badge>;
}
