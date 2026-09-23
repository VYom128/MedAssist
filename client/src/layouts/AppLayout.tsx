import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import { ROLE_HOME } from '../constants/roles';
import { useLogoutMutation } from '../features/auth/api';
import { selectCurrentUser } from '../features/auth/authSlice';
import { navItemsFor } from '../routes/routeConfig';
import { env } from '../utils/env';
import NavBadge from './NavBadge';
import UserMenu from './UserMenu';

/**
 * Logged-in shell: sidebar built from routeConfig for the user's role (a drawer below 768 px) and
 * a top bar with the account menu. While a password change is forced, only that page is shown.
 */
export default function AppLayout() {
  const user = useAppSelector(selectCurrentUser);
  const [logout] = useLogoutMutation();
  const navigate = useNavigate();
  const location = useLocation();
  // The drawer remembers the path it was opened on, so navigating closes it.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const menuOpen = menuOpenedAt === location.pathname;

  if (!user) return null;
  const forced = user.mustChangePassword;

  const onLogout = async () => {
    await logout()
      .unwrap()
      .catch(() => undefined);
    navigate('/login', { replace: true });
  };

  const nav = (
    <nav aria-label="Main" className="p-3">
      <ul className="space-y-1">
        {navItemsFor(user.role).map(({ to, label, icon: Icon, badge }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-brand-600 ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
              {badge && <NavBadge kind={badge} />}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-2 px-4">
          {!forced && (
            <button
              type="button"
              className="-ml-2 rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600 md:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpenedAt(menuOpen ? null : location.pathname)}
            >
              {menuOpen ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
          )}
          <Link
            to={forced ? '/change-password' : ROLE_HOME[user.role]}
            className="text-lg font-semibold text-brand-700"
          >
            {env.appName}
          </Link>
          <div className="ml-auto">
            <UserMenu user={user} limited={forced} onLogout={() => void onLogout()} />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        {!forced && (
          <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
            {nav}
          </aside>
        )}

        {!forced && menuOpen && (
          <div className="fixed inset-0 z-20 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-slate-900/30"
              onClick={() => setMenuOpenedAt(null)}
            />
            <aside
              id="mobile-nav"
              className="absolute inset-y-0 left-0 mt-14 w-64 bg-white shadow-lg"
            >
              {nav}
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
