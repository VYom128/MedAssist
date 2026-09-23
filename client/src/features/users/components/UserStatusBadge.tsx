import Badge from '../../../components/ui/Badge';
import type { AdminUser } from '../api';

export default function UserStatusBadge({ user }: { user: AdminUser }) {
  if (!user.isActive) return <Badge tone="neutral">Inactive</Badge>;
  if (user.isLocked) return <Badge tone="danger">Locked</Badge>;
  return <Badge tone="success">Active</Badge>;
}
