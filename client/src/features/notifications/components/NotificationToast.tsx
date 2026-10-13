import { X } from 'lucide-react';
import toast, { type Toast } from 'react-hot-toast';
import IconChip from '../../../components/ui/IconChip';
import type { NotificationItem } from '../api';
import { notificationLook } from '../look';

/**
 * A toast for a new notification (Phase 10). Clicking it opens the notification (marks it read,
 * goes to its link). Critical lab values for doctors stay on screen, in red, until clicked or
 * closed; everything else fades after the usual few seconds.
 */
export default function NotificationToast({
  t,
  n,
  critical,
  onOpen,
}: {
  t: Toast;
  n: NotificationItem;
  critical: boolean;
  onOpen: () => void;
}) {
  const { icon, tone } = notificationLook(n.type);
  return (
    <div
      role={critical ? 'alert' : 'status'}
      aria-live={critical ? 'assertive' : 'polite'}
      data-testid={critical ? 'critical-toast' : 'notification-toast'}
      className={`pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-card border p-3 shadow-overlay transition duration-200 ease-standard ${
        critical ? 'border-danger-100 bg-danger-50 text-danger-700' : 'border-line bg-surface'
      } ${t.visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <button
        type="button"
        onClick={() => {
          toast.dismiss(t.id);
          onOpen();
        }}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-control text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
      >
        <IconChip icon={icon} tone={critical ? 'danger' : tone} size="sm" />
        <span className="min-w-0">
          <span className={`block text-sm font-semibold ${critical ? '' : 'text-ink'}`}>
            {n.title}
          </span>
          {n.body && (
            <span className={`mt-0.5 block text-sm ${critical ? '' : 'text-muted'}`}>{n.body}</span>
          )}
        </span>
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => toast.dismiss(t.id)}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
