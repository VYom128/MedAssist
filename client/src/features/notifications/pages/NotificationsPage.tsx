import { BellOff, CheckCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../../../components/ui/Button';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import ListSkeleton from '../../../components/ui/ListSkeleton';
import PageHeader from '../../../components/ui/PageHeader';
import Pagination from '../../../components/ui/Pagination';
import Tabs from '../../../components/ui/Tabs';
import { useListParams } from '../../../hooks/useListParams';
import { getQueryErrorMessage } from '../../../utils/http';
import {
  formatUnread,
  useGetUnreadCountQuery,
  useListNotificationsQuery,
  useMarkAllNotificationsReadMutation,
} from '../api';
import NotificationRow from '../components/NotificationRow';
import { useOpenNotification } from '../useOpenNotification';

const PAGE_SIZE = 20;
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
];

/**
 * /notifications (spec §7.17, Phase 10) – every role's own notifications, newest first, All or
 * Unread (tab and page in the URL). Opening one marks it read and goes to its page.
 */
export default function NotificationsPage() {
  const params = useListParams();
  const tab = params.get('tab') === 'unread' ? 'unread' : 'all';
  const { data, isLoading, isFetching, isError, error, refetch, fulfilledTimeStamp } =
    useListNotificationsQuery({
      page: params.page,
      limit: PAGE_SIZE,
      unread: tab === 'unread',
    });
  const { data: unread = 0 } = useGetUnreadCountQuery();
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();
  const open = useOpenNotification();
  // Relative times are measured from when the page arrived (keeps render pure).
  const now = fulfilledTimeStamp ?? 0;

  const onMarkAll = () =>
    markAll()
      .unwrap()
      .then(() => toast.success('All notifications marked as read'))
      .catch((err: unknown) => toast.error(getQueryErrorMessage(err)));

  return (
    <section>
      <PageHeader
        title="Notifications"
        description={
          unread > 0
            ? `${formatUnread(unread)} unread`
            : 'Appointments, results, invoices and requests that concern you.'
        }
        actions={
          <Button
            variant="secondary"
            onClick={() => void onMarkAll()}
            loading={marking}
            disabled={unread === 0}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" /> Mark all as read
          </Button>
        }
      />
      <Tabs
        tabs={TABS.map((t) =>
          t.id === 'unread' && unread > 0 ? { ...t, label: `Unread (${formatUnread(unread)})` } : t,
        )}
        value={tab}
        onChange={(id) => params.update({ tab: id === 'unread' ? 'unread' : '' })}
        label="Notification filter"
      >
        {isLoading ? (
          <ListSkeleton label="Loading notifications…" rows={6} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description={
              tab === 'unread'
                ? 'You are all caught up.'
                : 'Updates about your appointments, results and requests will appear here.'
            }
          />
        ) : (
          <>
            <ul
              aria-label="Notifications"
              className={`divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card transition-opacity duration-150 ease-standard ${isFetching ? 'opacity-70' : ''}`}
            >
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className="block w-full text-left transition-colors duration-150 ease-standard hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-600"
                  >
                    <NotificationRow n={n} now={now} />
                  </button>
                </li>
              ))}
            </ul>
            <Pagination
              meta={data.meta}
              onPageChange={(page) => params.update({ page: String(page) })}
            />
          </>
        )}
      </Tabs>
    </section>
  );
}
