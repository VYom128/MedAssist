import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from '@headlessui/react';
import { Bell, CheckCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import Skeleton from '../../../components/ui/Skeleton';
import {
  formatUnread,
  useGetUnreadCountQuery,
  useListNotificationsQuery,
  useMarkAllNotificationsReadMutation,
} from '../api';
import { useOpenNotification } from '../useOpenNotification';
import NotificationRow from './NotificationRow';

const LATEST = 10;

const itemClass =
  'flex min-h-11 w-full items-center justify-center gap-2 rounded-control px-3 py-2 text-sm font-semibold text-primary-700 data-focus:bg-primary-50 focus:outline-none md:min-h-10';

/** The latest notifications – fetched only while the menu is open. */
function LatestList() {
  const { data, isLoading, isError, refetch, fulfilledTimeStamp } = useListNotificationsQuery({
    limit: LATEST,
  });
  const open = useOpenNotification();
  if (isLoading) {
    return (
      <div role="status" className="space-y-2 p-2">
        <span className="sr-only">Loading notifications…</span>
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-4 text-center text-sm text-muted">
        <p role="alert">Notifications could not be loaded.</p>
        <MenuItem>
          <button
            type="button"
            className={`${itemClass} mt-2`}
            onClick={(e) => {
              e.preventDefault();
              void refetch();
            }}
          >
            Try again
          </button>
        </MenuItem>
      </div>
    );
  }
  const items = data?.items ?? [];
  if (items.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted">You have no notifications.</p>;
  }
  // Relative times are measured from when the list arrived (keeps render pure).
  const now = fulfilledTimeStamp ?? 0;
  return (
    <ul aria-label="Latest notifications" className="max-h-[min(26rem,60vh)] overflow-y-auto">
      {items.map((n) => (
        <li key={n.id}>
          <MenuItem>
            <button
              type="button"
              onClick={() => open(n)}
              className="w-full rounded-control text-left focus:outline-none data-focus:bg-surface-muted"
            >
              <NotificationRow n={n} now={now} compact />
            </button>
          </MenuItem>
        </li>
      ))}
    </ul>
  );
}

/**
 * Top-bar bell (Phase 10): the unread count (99+ cap) and a menu with the latest 10 (Headless UI
 * Menu: arrow keys, Home/End, Escape), "Mark all as read" and "View all". The count updates live
 * from `notification.new` / `notification.read` (socketInvalidation.ts).
 */
export default function NotificationBell() {
  const { data: unread = 0 } = useGetUnreadCountQuery();
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();
  const label = unread > 0 ? `Notifications, ${formatUnread(unread)} unread` : 'Notifications';
  return (
    <Menu>
      <MenuButton
        aria-label={label}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-control text-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600 data-open:bg-surface-muted data-open:text-ink"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span
            aria-hidden="true"
            data-testid="unread-badge"
            className="tabular absolute top-1 right-0.5 min-w-5 rounded-full bg-danger-600 px-1 text-center text-[11px] leading-5 font-semibold text-white ring-2 ring-surface"
          >
            {formatUnread(unread)}
          </span>
        )}
      </MenuButton>
      <MenuItems
        transition
        anchor="bottom end"
        aria-label="Notifications"
        className="z-40 w-[min(24rem,calc(100vw-1rem))] origin-top-right rounded-card border border-line bg-surface p-1.5 shadow-overlay transition duration-200 ease-standard [--anchor-gap:8px] focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
      >
        <div className="flex items-center justify-between px-3 pt-1.5 pb-2">
          <p className="text-sm font-semibold text-ink">Notifications</p>
          {unread > 0 && (
            <span className="tabular text-xs text-muted">{formatUnread(unread)} unread</span>
          )}
        </div>
        <LatestList />
        <MenuSeparator className="my-1 h-px bg-line" />
        <div className="grid grid-cols-2 gap-1">
          <MenuItem disabled={unread === 0 || marking}>
            <button
              type="button"
              className={`${itemClass} data-disabled:text-subtle`}
              onClick={() => void markAll()}
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all as read
            </button>
          </MenuItem>
          <MenuItem>
            <Link to="/notifications" className={itemClass}>
              View all
            </Link>
          </MenuItem>
        </div>
      </MenuItems>
    </Menu>
  );
}
