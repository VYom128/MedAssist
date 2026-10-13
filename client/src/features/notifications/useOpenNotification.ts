import { useNavigate } from 'react-router-dom';
import { useMarkNotificationReadMutation, type NotificationItem } from './api';

/**
 * Opening a notification marks it read (if it isn't) and goes to its link. The read is sent in
 * the background: a failure only leaves the dot, never blocks the navigation.
 */
export function useOpenNotification() {
  const navigate = useNavigate();
  const [markRead] = useMarkNotificationReadMutation();
  return (n: Pick<NotificationItem, 'id' | 'readAt' | 'link'>) => {
    if (!n.readAt) void markRead(n.id);
    if (n.link) navigate(n.link);
  };
}
