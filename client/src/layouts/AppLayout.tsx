import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import { ROLE_HOME } from '../constants/roles';
import { useLogoutMutation } from '../features/auth/api';
import { selectCurrentUser } from '../features/auth/authSlice';
import { navItemsFor, type NavItem } from '../routes/routeConfig';
import { ACCOUNT_LINKS } from './accountLinks';
import MobileNav from './MobileNav';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import { usePageTransition } from './usePageTransition';
import { useSidebarCollapsed } from './useSidebarCollapsed';

/** The menu entry (or account page) the current path belongs to, for the top-bar title. */
function sectionFor(pathname: string, items: NavItem[]) {
  const all = [...items, ...ACCOUNT_LINKS];
  return (
    all
      .filter(({ to }) => pathname === to || pathname.startsWith(`${to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0] ?? null
  );
}

/**
 * Logged-in shell: sidebar built from routeConfig for the user's role (full from 1280 px,
 * icon-only from 768 px, a bottom sheet below that) and a top bar with the account menu. While a
 * password change is forced, only that page is shown.
 */
export default function AppLayout() {
  const user = useAppSelector(selectCurrentUser);
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  // The menu remembers the path it was opened on, so navigating closes it.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const menuOpen = menuOpenedAt === location.pathname;
  const pageRef = usePageTransition<HTMLDivElement>();

  if (!user) return null;
  const forced = user.mustChangePassword;
  const home = forced ? '/change-password' : ROLE_HOME[user.role];
  const items = navItemsFor(user.role);

  const onLogout = async () => {
    await logout()
      .unwrap()
      .catch(() => undefined);
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-control focus:bg-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-primary-700 focus:shadow-overlay"
      >
        Skip to main content
      </a>
      <div className="flex">
        {!forced && (
          <Sidebar
            user={user}
            items={items}
            home={home}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onLogout={() => void onLogout()}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            user={user}
            home={home}
            forced={forced}
            section={forced ? null : sectionFor(location.pathname, items)}
            menuOpen={menuOpen}
            onOpenMenu={() => setMenuOpenedAt(location.pathname)}
            onLogout={() => void onLogout()}
          />
          <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
            <div
              ref={pageRef}
              className="mx-auto w-full max-w-content px-4 py-6 sm:px-6 lg:py-8 xl:px-8"
            >
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {!forced && (
        <MobileNav
          open={menuOpen}
          onClose={() => setMenuOpenedAt(null)}
          user={user}
          items={items}
        />
      )}
    </div>
  );
}
