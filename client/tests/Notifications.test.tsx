import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { Toaster } from 'react-hot-toast';
import { attachInvalidation } from '../src/app/socketInvalidation';
import { formatUnread } from '../src/features/notifications/api';
import { showNotificationToast } from '../src/features/notifications/components/showNotificationToast';
import { relativeTime } from '../src/features/notifications/look';
import { routes } from '../src/routes/routes';
import { notification } from './dashboards.fixtures';
import { authState, makeUser, renderRoutes } from './helpers';
import { ok, server, url } from './msw/server';

/** The notification centre (Phase 10): bell, list page, live updates and toasts. */

const patient = makeUser('patient', { patientId: 'p1', patientLinkStatus: 'linked' });
const doctor = makeUser('doctor', { id: 'dr1' });
const pageMeta = (total: number, unreadCount: number) => ({
  page: 1,
  limit: 20,
  total,
  totalPages: total ? 1 : 0,
  unreadCount,
});

/** Socket events delivered by hand (sockets are off in tests). */
function fakeSocket(dispatch: Parameters<typeof attachInvalidation>[1], onNew?: () => void) {
  const handlers = new Map<string, (p: unknown) => void>();
  attachInvalidation(
    {
      on: (e: string, h: (p: unknown) => void) => handlers.set(e, h),
      off: () => undefined,
    } as never,
    dispatch,
    onNew,
  );
  return (event: string, payload: unknown) => act(() => handlers.get(event)!(payload));
}

const bell = () => screen.findByRole('button', { name: /^Notifications/ });

describe('Notification bell', () => {
  it('shows the unread count in its label (99+ cap) and updates on notification.new', async () => {
    server.use(http.get(url('/notifications/unread-count'), () => ok({ unreadCount: 3 })));
    const onNew = vi.fn();
    const { store } = renderRoutes(routes, '/patient/dashboard', authState(patient));
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeVisible();
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('3');

    const emit = fakeSocket(store.dispatch, onNew);
    const n = notification({ id: 'n9', title: 'Lab report ready' });
    emit('notification.new', { notification: n, unreadCount: 150 });
    expect(await screen.findByRole('button', { name: 'Notifications, 99+ unread' })).toBeVisible();
    expect(screen.getByTestId('unread-badge')).toHaveTextContent('99+');
    expect(onNew).toHaveBeenCalledWith({ notification: n, unreadCount: 150 });

    // Read in another tab: the badge follows.
    emit('notification.read', { ids: 'all', unreadCount: 0 });
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
    expect(screen.queryByTestId('unread-badge')).not.toBeInTheDocument();
    expect(formatUnread(99)).toBe('99');
  });

  it('opens the latest 10 with the keyboard; "Mark all as read" resets the count', async () => {
    let unread = 2;
    let listParams: URLSearchParams | null = null;
    let readAll = 0;
    server.use(
      http.get(url('/notifications/unread-count'), () => ok({ unreadCount: unread })),
      http.get(url('/notifications'), ({ request }) => {
        listParams = new URL(request.url).searchParams;
        return ok(
          [
            notification({ id: 'n1', title: 'Appointment booked' }),
            notification({
              id: 'n2',
              type: 'lab.critical_value',
              priority: 'critical',
              title: 'Critical lab result',
              link: '/doctor/lab-orders/lo1',
            }),
          ],
          { meta: pageMeta(2, unread) },
        );
      }),
      http.post(url('/notifications/read-all'), () => {
        readAll += 1;
        unread = 0;
        return ok({ updated: 2, unreadCount: 0 });
      }),
    );
    renderRoutes(routes, '/doctor/dashboard', authState(doctor));
    const user = userEvent.setup({ delay: null });
    const button = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    button.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(listParams!.get('limit')).toBe('10');
    expect(await within(menu).findByText('Appointment booked')).toBeVisible();
    // Critical ones say so in words, not only in red.
    expect(within(menu).getByText('Critical')).toBeVisible();
    expect(within(menu).getAllByText('Unread')).toHaveLength(2);

    // Arrow keys move the active item (Headless UI Menu: aria-activedescendant).
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Mark all as read'), 'View all']),
    );
    const activeIndex = () =>
      items.findIndex((i) => i.id === menu.getAttribute('aria-activedescendant'));
    await user.keyboard('{Home}');
    expect(activeIndex()).toBe(0);
    await user.keyboard('{ArrowDown}');
    expect(activeIndex()).toBe(1);
    await user.keyboard('{End}');
    expect(activeIndex()).toBe(items.length - 1);

    await user.click(within(menu).getByRole('menuitem', { name: /Mark all as read/ }));
    expect(readAll).toBe(1);
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
  });

  it('"View all" goes to /notifications', async () => {
    const { router } = renderRoutes(routes, '/patient/dashboard', authState(patient));
    const user = userEvent.setup({ delay: null });
    await user.click(await bell());
    await user.click(await screen.findByRole('menuitem', { name: 'View all' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notifications'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    expect(await screen.findByText('No notifications yet')).toBeVisible();
  });
});

describe('/notifications', () => {
  it('clicking a notification marks it read and opens its link', async () => {
    const read: string[] = [];
    server.use(
      http.get(url('/notifications/unread-count'), () => ok({ unreadCount: 1 })),
      http.get(url('/notifications'), () =>
        ok(
          [
            notification({
              id: 'n7',
              type: 'lab.result_released',
              title: 'Your lab report is ready',
              link: '/patient/invoices',
            }),
          ],
          { meta: pageMeta(1, 1) },
        ),
      ),
      http.post(url('/notifications/:id/read'), ({ params }) => {
        read.push(params.id as string);
        return ok({ notification: {}, unreadCount: 0 });
      }),
    );
    const { router } = renderRoutes(routes, '/notifications', authState(patient));
    const user = userEvent.setup({ delay: null });
    await user.click(await screen.findByRole('button', { name: /Your lab report is ready/ }));
    await waitFor(() => expect(read).toEqual(['n7']));
    await waitFor(() => expect(router.state.location.pathname).toBe('/patient/invoices'));
  });

  it('the Unread tab asks for unread ones only (tab and page in the URL)', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(url('/notifications'), ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('unread'));
        return ok([], { meta: pageMeta(0, 0) });
      }),
    );
    const { router } = renderRoutes(routes, '/notifications', authState(patient));
    const user = userEvent.setup({ delay: null });
    await screen.findByText('No notifications yet');
    await user.click(screen.getByRole('tab', { name: 'Unread' }));
    expect(await screen.findByText('No unread notifications')).toBeVisible();
    expect(seen).toContain('true');
    expect(router.state.location.search).toBe('?tab=unread');
  });

  it('shows an error with a retry', async () => {
    server.use(
      http.get(url('/notifications'), () =>
        Response.json(
          { success: false, message: 'Server down', error: { code: 'INTERNAL_ERROR' } },
          { status: 500 },
        ),
      ),
    );
    renderRoutes(routes, '/notifications', authState(patient));
    expect(await screen.findByText('Server down')).toBeVisible();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeVisible();
  });
});

describe('Notification toasts', () => {
  // react-hot-toast reads prefers-reduced-motion.
  beforeAll(() => {
    window.matchMedia ??= ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    })) as never;
  });

  it('critical lab values stay as a red alert for doctors until clicked', async () => {
    render(<Toaster />);
    const open = vi.fn();
    act(() =>
      showNotificationToast(
        notification({
          id: 'c1',
          type: 'lab.critical_value',
          priority: 'critical',
          title: 'Critical lab result',
        }),
        'doctor',
        open,
      ),
    );
    const toast = await screen.findByTestId('critical-toast');
    expect(toast).toHaveAttribute('role', 'alert');
    expect(toast.className).toContain('bg-danger-50');
    await userEvent.click(within(toast).getByRole('button', { name: /Critical lab result/ }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('other notifications are polite toasts', async () => {
    render(<Toaster />);
    act(() => showNotificationToast(notification({ id: 'o1' }), 'patient', vi.fn()));
    expect(await screen.findByTestId('notification-toast')).toHaveAttribute('role', 'status');
  });

  it('relative times', () => {
    const now = Date.parse('2026-10-13T10:00:00Z');
    expect(relativeTime('2026-10-13T09:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-13T09:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-10-13T07:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-12T09:00:00Z', now)).toBe('yesterday');
  });
});
