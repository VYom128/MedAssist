import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../app/hooks';
import Button from '../components/ui/Button';
import { ROLE_HOME, ROLE_LABELS } from '../constants/roles';
import { useLogoutMutation } from '../features/auth/api';
import { selectCurrentUser } from '../features/auth/authSlice';
import { ACCOUNT_NAV, navItemsFor, type NavItem } from '../routes/routeConfig';
import { env } from '../utils/env';

function NavList({ items, title }: { items: NavItem[]; title?: string }) {
  return (
    <div>
      {title && (
        <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          {title}
        </p>
      )}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Logged-in shell: role-based sidebar (drawer on mobile) and a top bar with the user menu. */
export default function AppLayout() {
  const user = useAppSelector(selectCurrentUser);
  // The mobile drawer remembers the path it was opened on, so navigating closes it.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null);
  const [logout, { isLoading: loggingOut }] = useLogoutMutation();
  const navigate = useNavigate();
  const location = useLocation();

  const menuOpen = menuOpenedAt === location.pathname;
  const closeMenu = () => setMenuOpenedAt(null);

  if (!user) return null;
  // While a password change is pending, only the change-password page is reachable.
  const locked = user.mustChangePassword;

  const onLogout = async () => {
    await logout()
      .unwrap()
      .catch(() => undefined);
    navigate('/login', { replace: true });
  };

  const sidebar = (
    <nav aria-label="Main" className="space-y-6 p-4">
      {!locked && <NavList items={navItemsFor(user.role)} />}
      {!locked && <NavList title="Account" items={ACCOUNT_NAV} />}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-3 px-4">
          <button
            type="button"
            className="-ml-2 rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpenedAt(menuOpen ? null : location.pathname)}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                d={menuOpen ? 'M6 6l12 12M18 6L6 18' : 'M4 7h16M4 12h16M4 17h16'}
              />
            </svg>
          </button>
          <Link to={ROLE_HOME[user.role]} className="text-lg font-semibold text-brand-700">
            {env.appName}
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
            </div>
            <Button variant="secondary" onClick={() => void onLogout()} loading={loggingOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:block">
          {sidebar}
        </aside>

        {menuOpen && (
          <div className="fixed inset-0 z-20 md:hidden">
            <button
              type="button"
              aria-label="Close menu"
              className="absolute inset-0 bg-slate-900/30"
              onClick={closeMenu}
            />
            <aside
              id="mobile-nav"
              className="absolute inset-y-0 left-0 mt-14 w-64 bg-white shadow-lg"
            >
              {sidebar}
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
