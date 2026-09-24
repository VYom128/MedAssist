import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from '@headlessui/react';
import { ChevronDown, LogOut } from 'lucide-react';
import { Link } from 'react-router-dom';
import Avatar from '../components/ui/Avatar';
import { ROLE_LABELS } from '../constants/roles';
import type { CurrentUser } from '../features/auth/authSlice';
import { ACCOUNT_LINKS } from './accountLinks';

/**
 * Top-bar account menu (Headless UI Menu: arrow keys, Escape, typeahead): Profile, Sessions,
 * Change password, Log out. With a pending forced password change only Log out is offered.
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
  const name = `${user.firstName} ${user.lastName}`;
  const item =
    'flex min-h-11 w-full items-center gap-2.5 rounded-control px-3 py-2 text-left md:min-h-10 text-sm text-body data-focus:bg-surface-muted data-focus:text-ink focus:outline-none';

  return (
    <Menu>
      <MenuButton className="flex min-h-11 items-center gap-2.5 rounded-control p-1.5 pr-2 transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary-600 data-open:bg-surface-muted">
        <Avatar name={name} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold text-ink">{name}</span>
          <span className="block text-xs text-muted">{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-muted" aria-hidden="true" />
        <span className="sr-only">Account menu</span>
      </MenuButton>

      <MenuItems
        transition
        anchor="bottom end"
        aria-label="Account"
        className="z-40 w-60 origin-top-right rounded-card border border-line bg-surface p-1.5 shadow-overlay transition duration-200 ease-standard [--anchor-gap:8px] focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
      >
        <div className="px-3 pt-1.5 pb-2 sm:hidden">
          <p className="text-sm font-semibold text-ink">{name}</p>
          <p className="text-xs text-muted">{ROLE_LABELS[user.role]}</p>
        </div>
        {!limited &&
          ACCOUNT_LINKS.map(({ to, label, icon: Icon }) => (
            <MenuItem key={to}>
              <Link to={to} className={item}>
                <Icon className="h-4 w-4 text-subtle" aria-hidden="true" /> {label}
              </Link>
            </MenuItem>
          ))}
        {!limited && <MenuSeparator className="my-1 h-px bg-line" />}
        <MenuItem>
          <button
            type="button"
            className={`${item} text-danger-700 data-focus:bg-danger-50 data-focus:text-danger-700`}
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" /> Log out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}
