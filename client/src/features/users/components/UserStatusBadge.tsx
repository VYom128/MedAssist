import StatusPill from '../../../components/ui/StatusPill';
import type { AdminUser } from '../api';

export default function UserStatusBadge({ user }: { user: AdminUser }) {
  if (!user.isActive) return <StatusPill domain="account" status="inactive" />;
  if (user.isLocked) return <StatusPill domain="account" status="locked" />;
  return <StatusPill domain="account" status="active" />;
}
