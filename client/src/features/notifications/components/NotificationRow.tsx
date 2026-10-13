import IconChip from '../../../components/ui/IconChip';
import { formatDateTime } from '../../../utils/dates';
import type { NotificationItem } from '../api';
import { notificationLook, notificationTypeLabel, relativeTime } from '../look';

/**
 * One notification: icon by type, title, body (not in `compact`), relative time and an unread
 * dot. Critical ones (lab critical values) get a red edge and a "Critical" label – never colour
 * alone.
 */
export default function NotificationRow({
  n,
  now,
  compact = false,
}: {
  n: NotificationItem;
  now: number;
  compact?: boolean;
}) {
  const { icon, tone } = notificationLook(n.type);
  const critical = n.priority === 'critical';
  const unread = !n.readAt;
  return (
    <span
      className={`flex items-start gap-3 px-3 py-2.5 ${
        critical ? 'border-l-4 border-danger-500 bg-danger-50' : 'border-l-4 border-transparent'
      }`}
    >
      <IconChip icon={icon} tone={critical ? 'danger' : tone} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`min-w-0 text-sm ${unread ? 'font-semibold text-ink' : 'text-body'}`}>
            {n.title}
          </span>
          {critical && (
            <span className="shrink-0 text-xs font-semibold text-danger-700 uppercase">
              Critical
            </span>
          )}
        </span>
        {!compact && n.body && <span className="mt-0.5 block text-sm text-muted">{n.body}</span>}
        <span className="mt-0.5 block text-xs text-muted">
          {notificationTypeLabel(n.type)} ·{' '}
          <time dateTime={n.createdAt ?? undefined} title={formatDateTime(n.createdAt)}>
            {relativeTime(n.createdAt, now)}
          </time>
        </span>
      </span>
      {unread && (
        <span className="mt-1.5 flex shrink-0 items-center">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-primary-600" />
          <span className="sr-only">Unread</span>
        </span>
      )}
    </span>
  );
}
