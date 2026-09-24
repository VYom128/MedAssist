import { Menu } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CurrentUser } from '../features/auth/authSlice';
import UserMenu from './UserMenu';
import Wordmark from './Wordmark';

/**
 * Sticky top bar: menu button + wordmark below 768 px (and while a password change is forced),
 * the current section's name from 768 px, and the account menu.
 */
export default function TopBar({
  user,
  home,
  forced,
  section,
  menuOpen,
  onOpenMenu,
  onLogout,
}: {
  user: CurrentUser;
  home: string;
  forced: boolean;
  section: { label: string; icon: LucideIcon } | null;
  menuOpen: boolean;
  onOpenMenu: () => void;
  onLogout: () => void;
}) {
  const SectionIcon = section?.icon;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md print:hidden">
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6 xl:px-8">
        {!forced && (
          <button
            type="button"
            className="-ml-2 inline-flex h-11 w-11 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-primary-600 md:hidden"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={onOpenMenu}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <div className={forced ? '' : 'md:hidden'}>
          <Wordmark to={home} textClassName="max-[359px]:sr-only" />
        </div>
        {!forced && section && SectionIcon && (
          <p className="hidden items-center gap-2 text-sm font-semibold text-ink md:flex">
            <SectionIcon className="h-4.5 w-4.5 text-primary-600" aria-hidden="true" />
            {section.label}
          </p>
        )}
        <div className="ml-auto">
          <UserMenu user={user} limited={forced} onLogout={onLogout} />
        </div>
      </div>
    </header>
  );
}
