import StatusPill from '../../../components/ui/StatusPill';
import type { PortalState } from '../portal';

export default function PortalBadge({ state }: { state: PortalState }) {
  return <StatusPill domain="portal" status={state} />;
}
