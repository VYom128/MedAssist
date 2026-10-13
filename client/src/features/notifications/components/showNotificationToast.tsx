import toast from 'react-hot-toast';
import type { Role } from '../../../constants/roles';
import type { NotificationItem } from '../api';
import NotificationToast from './NotificationToast';

/** Shows the toast for `n`; `onOpen` marks it read and navigates. */
export function showNotificationToast(
  n: NotificationItem,
  role: Role | undefined,
  onOpen: () => void,
) {
  const critical = role === 'doctor' && n.type === 'lab.critical_value';
  toast.custom((t) => <NotificationToast t={t} n={n} critical={critical} onOpen={onOpen} />, {
    id: `notification-${n.id}`,
    duration: critical ? Infinity : 6000,
  });
}
