import { ChevronDown, KeyRound, LogOut, MonitorSmartphone, UserRound } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_LABELS } from '../constants/roles';
import type { CurrentUser } from '../features/auth/authSlice';

/**
 * Top-bar account menu: Profile, Sessions, Change password, Log out. With a pending forced
 * password change only Log out is offered.
 */
export default function UserMenu({
  user,
  onLogout,
  limited,
}: {
  user: CurrentUser;
  onLogout: () => void;
  limited: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 focus-visible:bg-slate-100 focus-visible:outline-none';
  const links = [
    { to: '/profile', label: 'Profile', icon: UserRound },
    { to: '/sessions', label: 'Sessions', icon: MonitorSmartphone },
    { to: '/change-password', label: 'Change password', icon: KeyRound },
  ];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700"
        >
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium">
            {user.firstName} {user.lastName}
          </span>
          <span className="block text-xs text-slate-500">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden="true" />
        <span className="sr-only">Account menu</span>
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          <div className="border-b border-slate-100 px-3 py-2 sm:hidden">
            <p className="text-sm font-medium">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
          </div>
          {!limited &&
            links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                role="menuitem"
                className={item}
                onClick={() => setOpen(false)}
              >
                <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" /> {label}
              </Link>
            ))}
          <button
            type="button"
            role="menuitem"
            className={`${item} border-t border-slate-100 text-rose-700`}
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}
